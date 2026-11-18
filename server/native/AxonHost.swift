// Axon host for macOS.
//
// Same line-delimited JSON protocol as the Windows host, so the Node driver
// above it is platform-agnostic. Reads and drives apps through the macOS
// Accessibility API (AXUIElement) rather than pixels, matching the Windows
// side's tree-first design.
//
// The attributed AX foundation is reused by the shared Antigravity runtime.
// Platform-specific permission, Stop, capture and input adapters live in macos/.
//
// Compilation, native contracts and real interactive qualification are separate
// gates. A successful build is not a claim of tested macOS desktop behavior.
//
// What the second review (Sep 2026) changed: window handles are stable now
// (a registry keyed on the AX element, not the app's window order, which
// shifts every time the user raises a window); Escape stops a run; clicks
// honour button, clicks and point; key chords go to the named window or
// refuse; drag, clipboard, describe, busy and banner ops exist; screenshots
// capture the window itself rather than whatever is drawn over it; typed
// newlines and tabs are keys; the snapshot walk has a time budget.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Marks every event Axon posts. Real hardware input carries 0 here, so the
// presence tracker can tell the user apart from Axon - the macOS counterpart of
// the injected-event flag Windows sets in the kernel.
let AXON_EVENT_MARKER: Int64 = 0x41584F4E  // "AXON"

// MARK: - JSON plumbing

let emitLock = NSLock()

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let line = String(data: data, encoding: .utf8) else { return }
    emitLock.lock()
    print(line)
    fflush(stdout)
    emitLock.unlock()
}

struct AxonError: Error {
    let code: String
    let message: String
    let hint: String?
    init(_ code: String, _ message: String, _ hint: String? = nil) {
        self.code = code; self.message = message; self.hint = hint
    }
}

func str(_ v: Any?) -> String? { return v as? String }
func int(_ v: Any?, _ fallback: Int) -> Int {
    if let n = v as? Int { return n }
    if let n = v as? Double { return Int(n) }
    if let s = v as? String, let n = Int(s) { return n }
    return fallback
}
func bool(_ v: Any?, _ fallback: Bool) -> Bool { return (v as? Bool) ?? fallback }
func pair(_ v: Any?) -> [Int]? {
    guard let arr = v as? [Any], arr.count >= 2 else { return nil }
    return [int(arr[0], 0), int(arr[1], 0)]
}

// MARK: - Presence

final class Presence {
    static let shared = Presence()
    private var tap: CFMachPort?
    private var lastAny = Date()
    private var lastCommit = Date()
    private var lastKind = "none"
    private var realEvents: Int = 0
    private var injectedEvents: Int = 0
    private var commitWindowPid: pid_t = 0
    // Escape while Axon is acting (or between the steps of a run, while the
    // server has it marked busy) is the user taking the machine back.
    private var stopRequested = false
    private var acting = 0
    private var taskActive = false
    private let lock = NSLock()
    private(set) var monitoring = false

    func start() {
        let mask: CGEventMask =
            (1 << CGEventType.mouseMoved.rawValue) |
            (1 << CGEventType.leftMouseDown.rawValue) |
            (1 << CGEventType.rightMouseDown.rawValue) |
            (1 << CGEventType.scrollWheel.rawValue) |
            (1 << CGEventType.keyDown.rawValue) |
            (1 << CGEventType.flagsChanged.rawValue)

        // Listen-only: this tap never modifies or swallows input, it only
        // observes, so it cannot interfere with the user's typing.
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: { _, type, event, _ in
                Presence.shared.observe(type: type, event: event)
                return Unmanaged.passUnretained(event)
            },
            userInfo: nil
        ) else { return }

        self.tap = tap
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        monitoring = true
    }

    fileprivate func observe(type: CGEventType, event: CGEvent) {
        let marker = event.getIntegerValueField(.eventSourceUserData)
        lock.lock()
        defer { lock.unlock() }
        if marker == AXON_EVENT_MARKER {
            injectedEvents += 1
            return
        }
        let now = Date()
        lastAny = now
        realEvents += 1
        lastKind = (type == .keyDown || type == .flagsChanged) ? "keyboard" : "mouse"
        if type != .mouseMoved {
            lastCommit = now
            // The window server, not the cached workspace value, and no
            // accessibility round trip inside the event tap.
            commitWindowPid = macWindowServerFrontPid() ?? 0
        }
        if type == .keyDown && event.getIntegerValueField(.keyboardEventKeycode) == 53 && (acting > 0 || taskActive) {
            stopRequested = true
        }
    }

    var idleMs: Int {
        lock.lock(); defer { lock.unlock() }
        return Int(Date().timeIntervalSince(lastAny) * 1000)
    }
    var commitIdleMs: Int {
        lock.lock(); defer { lock.unlock() }
        return Int(Date().timeIntervalSince(lastCommit) * 1000)
    }
    var userPid: pid_t {
        lock.lock(); defer { lock.unlock() }
        return commitWindowPid
    }

    func beginAct() { lock.lock(); acting += 1; lock.unlock() }
    func endAct() { lock.lock(); acting = max(0, acting - 1); lock.unlock() }
    func setTask(_ on: Bool) {
        lock.lock()
        taskActive = on
        if !on && acting == 0 { stopRequested = false }
        lock.unlock()
    }
    var stopPending: Bool { lock.lock(); defer { lock.unlock() }; return stopRequested }
    func consumeStop() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let s = stopRequested
        stopRequested = false
        return s
    }

    func active(_ thresholdMs: Int) -> Bool { return monitoring && idleMs < thresholdMs }
    func busy(_ thresholdMs: Int) -> Bool { return monitoring && commitIdleMs < thresholdMs }

    func waitForQuiet(idleMs wanted: Int, budgetMs budget: Int) -> Bool {
        if !monitoring { return true }
        var waited = 0
        while waited < budget {
            if idleMs >= wanted { return true }
            if stopPending { return false }
            Thread.sleep(forTimeInterval: 0.1)
            waited += 100
        }
        return idleMs >= wanted
    }

    func report() -> [String: Any] {
        lock.lock()
        let real = realEvents, inj = injectedEvents, kind = lastKind, stop = stopRequested
        lock.unlock()
        return [
            "monitoring": monitoring,
            "idle_ms": idleMs,
            "commit_idle_ms": commitIdleMs,
            "last_input": kind,
            "real_events": real,
            "injected_events": inj,
            "user_window": Int(userPid),
            "stop_requested": stop,
        ]
    }
}

func checkStop() throws { try MacFence.check() }

// MARK: - Accessibility helpers

func axAttr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(el, name as CFString, &value)
    return err == .success ? value : nil
}

func axString(_ el: AXUIElement, _ name: String) -> String? {
    return axAttr(el, name) as? String
}

func axBool(_ el: AXUIElement, _ name: String) -> Bool? {
    return axAttr(el, name) as? Bool
}

func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    guard let raw = axAttr(el, kAXChildrenAttribute as String) else { return [] }
    return (raw as? [AXUIElement]) ?? []
}

func axActions(_ el: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success else { return [] }
    return (names as? [String]) ?? []
}

func axRect(_ el: AXUIElement) -> [Int]? {
    guard let posRaw = axAttr(el, kAXPositionAttribute as String),
          let sizeRaw = axAttr(el, kAXSizeAttribute as String) else { return nil }
    // These attributes are normally AXValue, but a misbehaving provider can
    // return something else. A force-cast there would crash the whole host and
    // take the session down, so the type is checked before casting.
    guard CFGetTypeID(posRaw) == AXValueGetTypeID(),
          CFGetTypeID(sizeRaw) == AXValueGetTypeID() else { return nil }
    var origin = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posRaw as! AXValue, .cgPoint, &origin)
    AXValueGetValue(sizeRaw as! AXValue, .cgSize, &size)
    if size.width <= 0 || size.height <= 0 { return nil }
    return [Int(origin.x), Int(origin.y), Int(size.width), Int(size.height)]
}

func axValueText(_ el: AXUIElement) -> String? {
    if let s = axAttr(el, kAXValueAttribute as String) as? String, !s.isEmpty { return s }
    return nil
}

func axAlive(_ el: AXUIElement) -> Bool {
    return axAttr(el, kAXRoleAttribute as String) != nil
}

// The element under a screen point, for point clicks and describe.
// The name a snapshot lists for an element. A pixel click's approval label
// uses the same rule (MacFence.preview), so a target is named the same way.
func macSnapshotName(_ el: AXUIElement) -> String? {
    axString(el, kAXTitleAttribute as String)
        ?? axString(el, kAXDescriptionAttribute as String)
        ?? axString(el, "AXPlaceholderValue")
}

// The label of the element under a pixel click, for the approval rule only:
// hit-tested through the target app, which must own the element, inside the
// target window. Any failure, a secure field or no name gives "", which the
// ambiguous-target rule treats as sensitive. There is no fallback to the role
// (as on Windows, AxonHost.cs PreviewLabel).
func macPointLabel(_ point: [Int], _ a: [String: Any]) -> String {
    guard let (win, pid, _, _) = try? resolveWindow(a) else { return "" }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.25)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(app, Float(point[0]), Float(point[1]), &hit) == .success, let el = hit else { return "" }
    var owner: pid_t = 0
    guard AXUIElementGetPid(el, &owner) == .success, owner == pid, macElementInWindow(el, win) else { return "" }
    let role = (axString(el, kAXRoleAttribute as String) ?? "") + (axString(el, kAXSubroleAttribute as String) ?? "")
    if role.lowercased().contains("secure") { return "" }
    return macSnapshotName(el)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

func elementAt(_ x: Int, _ y: Int) -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    var el: AXUIElement?
    let err = AXUIElementCopyElementAtPosition(system, Float(x), Float(y), &el)
    return err == .success ? el : nil
}

// MARK: - Window registry
//
// The app's window array is ordered by z-order and reorders every time the
// user raises a window, so "pid * 1000 + index" named a different window a
// moment later. A handle here is minted once per AX element and stays with
// it for as long as the window exists - the same promise the Windows host
// makes with a real HWND.

final class WindowRegistry {
    private var entries: [Int: (el: AXUIElement, pid: pid_t)] = [:]
    private var retired: Set<Int> = []
    // Seeded from this process's pid rather than starting at 1, so a handle
    // number minted by a host that has since restarted (a client's cached
    // hwnd, from before the restart) cannot coincide with one this process
    // mints - see resolveWindow, which refuses a handle it never minted
    // rather than matching whatever a fresh enumeration numbers the same.
    private var next = Int(ProcessInfo.processInfo.processIdentifier) << 16
    private let lock = NSLock()

    func handle(for el: AXUIElement, pid: pid_t) -> Int {
        lock.lock(); defer { lock.unlock() }
        let directID = Int(axWindowID(el))
        if directID > 0 {
            entries[directID] = (el, pid)
            retired.remove(directID)
            return directID
        }
        for (h, e) in entries where e.pid == pid && CFEqual(e.el, el) { return h }
        let h = next
        next += 1
        entries[h] = (el, pid)
        return h
    }

    func lookup(_ h: Int) -> (AXUIElement, pid_t)? {
        lock.lock(); defer { lock.unlock() }
        guard let e = entries[h] else { return nil }
        if !axAlive(e.el) {
            entries.removeValue(forKey: h)
            retired.insert(h)
            return nil
        }
        return (e.el, e.pid)
    }

    func isRetired(_ h: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return retired.contains(h)
    }

    func prune() {
        lock.lock(); defer { lock.unlock() }
        for (h, e) in entries where !axAlive(e.el) {
            entries.removeValue(forKey: h)
            retired.insert(h)
        }
    }

    func liveEntries() -> [(handle: Int, el: AXUIElement, pid: pid_t)] {
        lock.lock(); defer { lock.unlock() }
        var result: [(handle: Int, el: AXUIElement, pid: pid_t)] = []
        for (h, e) in entries {
            if axAlive(e.el) {
                result.append((h, e.el, e.pid))
            } else {
                entries.removeValue(forKey: h)
                retired.insert(h)
            }
        }
        return result.sorted { $0.handle < $1.handle }
    }
}

let registry = WindowRegistry()

struct WindowInfo {
    let el: AXUIElement
    let pid: pid_t
    let title: String
    let handle: Int
    let app: NSRunningApplication
    let focused: Bool
}

func enumerateWindows() -> [WindowInfo] {
    var out: [WindowInfo] = []
    var seenHandles: Set<Int> = []
    var appsByPid: [pid_t: NSRunningApplication] = [:]
    for app in NSWorkspace.shared.runningApplications {
        guard app.activationPolicy == .regular, app.localizedName != nil else { continue }
        let pid = app.processIdentifier
        appsByPid[pid] = app
        let axApp = AXUIElementCreateApplication(pid)
        guard let wins = axAttr(axApp, kAXWindowsAttribute as String) as? [AXUIElement] else { continue }
        let focusedRaw = axAttr(axApp, kAXFocusedWindowAttribute as String)
        for win in wins {
            let title = axString(win, kAXTitleAttribute as String) ?? ""
            let handle = registry.handle(for: win, pid: pid)
            seenHandles.insert(handle)
            var focused = false
            if let f = focusedRaw, CFGetTypeID(f) == AXUIElementGetTypeID() { focused = CFEqual(f, win) }
            out.append(WindowInfo(el: win, pid: pid, title: title, handle: handle, app: app, focused: focused))
        }
    }
    // macOS kAXWindowsAttribute omits windows that are on an inactive Mission Control Space
    // even while their AXUIElement handles remain alive. Include live registered windows so
    // off-Space windows stay discoverable and classify as other_desktop instead of closed.
    for entry in registry.liveEntries() where !seenHandles.contains(entry.handle) {
        guard let app = appsByPid[entry.pid] ?? NSRunningApplication(processIdentifier: entry.pid),
              !app.isTerminated,
              axRect(entry.el) != nil else { continue }
        let title = axString(entry.el, kAXTitleAttribute as String) ?? ""
        out.append(WindowInfo(el: entry.el, pid: entry.pid, title: title, handle: entry.handle, app: app, focused: false))
    }
    return out
}

// MARK: - Session state

final class Snapshot {
    var elements: [AXUIElement] = []
    var pid: pid_t = 0
    var title: String = ""
    var taken = Date()
    // The window this snapshot was taken of, so snapshotElement can refuse to
    // hand out an element from some other window - see there.
    var handle: Int = 0
}

var snapshots: [String: Snapshot] = [:]
var snapSeq = 0
let maxSnapshots = 8

var idleThresholdMs = 1200
var waitBudgetMs = 6000
var defaultMode = "share"

func modeOf(_ a: [String: Any]) -> String {
    return str(a["mode"]) ?? defaultMode
}

func guardSameWindow(_ a: [String: Any], _ targetPid: pid_t) throws {
    // take and exclusive both mean "go now", matching the Windows host.
    let m = modeOf(a)
    if m == "take" || m == "exclusive" { return }
    if !Presence.shared.monitoring || targetPid == 0 { return }
    if !Presence.shared.busy(idleThresholdMs) { return }
    if Presence.shared.userPid != targetPid { return }
    if macFrontmostPid() != targetPid { return }
    throw AxonError("user_in_window", "The user is working in that app right now.",
                    "Work somewhere else, wait for them to stop, or pass mode:\"take\".")
}

func guardDisturb(_ a: [String: Any]) throws -> Int {
    let mode = modeOf(a)
    if mode == "take" || mode == "exclusive" { return -1 }
    if !Presence.shared.monitoring { return -1 }
    if !Presence.shared.active(idleThresholdMs) { return -1 }
    if mode == "yield" {
        throw AxonError("user_busy",
                        "The user is using the mouse or keyboard, and this step needs the cursor or the foreground.",
                        "Reading and AX actions still work while they are busy.")
    }
    let start = Date()
    if !Presence.shared.waitForQuiet(idleMs: idleThresholdMs, budgetMs: waitBudgetMs) {
        try checkStop()
        throw AxonError("user_busy",
                        "Waited \(waitBudgetMs)ms but the user is still active.",
                        "Reading and AX actions still work. Retry later, or pass mode:\"take\".")
    }
    return Int(Date().timeIntervalSince(start) * 1000)
}

// MARK: - Ops

func trusted() -> Bool {
    return AXIsProcessTrusted()
}

func requireTrust() throws {
    if !trusted() {
        throw AxonError("accessibility_denied",
                        "Axon does not have Accessibility permission.",
                        "Grant it in System Settings > Privacy & Security > Accessibility for the terminal or app running Claude Code, then restart it.")
    }
}

func opListApps(_ a: [String: Any]) throws -> [String: Any] {
    try requireTrust()
    registry.prune()
    var out: [[String: Any]] = []
    let front = macFrontmostPid()
    for w in enumerateWindows() {
        let rect = axRect(w.el)
        let state = macInspectWindowState(window: w.el, pid: w.pid, title: w.title, rect: rect, app: w.app)
        out.append([
            "hwnd": w.handle,
            "pid": Int(w.pid),
            "title": w.title,
            "class": axString(w.el, kAXRoleAttribute as String) ?? "AXWindow",
            "process": w.app.localizedName ?? "",
            "path": (try macProcessPath(w.pid)),
            "rect": rect as Any,
            "minimized": state.minimized,
            "hidden": state.hidden,
            "fullscreen": state.fullscreen,
            "other_desktop": state.otherDesktop,
            "foreground": w.focused && w.pid == front && !state.minimized && !state.hidden && !state.otherDesktop,
        ])
    }
    return ["windows": out, "dpi_mode": "native", "platform": "darwin"]
}

func resolveWindow(_ a: [String: Any]) throws -> (AXUIElement, pid_t, String, Int) {
    try requireTrust()
    let wantHandle = int(a["hwnd"], -1)
    if wantHandle > 0 {
        if let hit = registry.lookup(wantHandle) {
            return (hit.0, hit.1, axString(hit.0, kAXTitleAttribute as String) ?? "", wantHandle)
        }
        if !registry.isRetired(wantHandle) {
            _ = enumerateWindows()
            if let hit = registry.lookup(wantHandle) {
                return (hit.0, hit.1, axString(hit.0, kAXTitleAttribute as String) ?? "", wantHandle)
            }
        }
        if registry.isRetired(wantHandle) || a["__pid"] != nil || a["__started"] != nil {
            throw AxonError("identity_changed", "The target window handle is stale because the window closed or its identity changed. Run apps once to discover current windows; do not poll the stale handle.")
        }
        throw AxonError("window_not_found", "No window matched hwnd/title.",
                        "Call list_apps and pass an hwnd from its result.")
    }
    // A handle is only ever minted by enumerateWindows(), so any hwnd the
    // caller could legitimately know about was already in the registry
    // above; never fall back from an explicit hwnd to a title search.
    if let wantTitle = str(a["title"]), !wantTitle.isEmpty {
        let all = enumerateWindows()
        let exact = all.filter { $0.title == wantTitle }
        if exact.count == 1 {
            let w = exact[0]
            return (w.el, w.pid, w.title, w.handle)
        }
        if exact.count > 1 {
            throw AxonError("ambiguous_selector", "Multiple windows share that exact title. Select a specific hwnd from apps.")
        }
        let lowered = wantTitle.lowercased()
        let partial = all.filter { $0.title.lowercased().contains(lowered) }
        if partial.count == 1 {
            let w = partial[0]
            return (w.el, w.pid, w.title, w.handle)
        }
        if partial.count > 1 {
            throw AxonError("ambiguous_selector", "Multiple windows match that title. Select a specific hwnd from apps.")
        }
    }
    throw AxonError("window_not_found", "No window matched hwnd/title.",
                    "Call list_apps and pass an hwnd from its result.")
}

let interestingActions: Set<String> = ["AXPress", "AXIncrement", "AXDecrement", "AXShowMenu", "AXPick", "AXConfirm"]
let toggleRoles: Set<String> = ["AXCheckBox", "AXRadioButton", "AXToggle", "AXSwitch"]

func macEnableWebAccessibility(_ pid: pid_t) {
    let axApp = AXUIElementCreateApplication(pid)
    _ = AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    _ = AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
}

func macHasWebArea(_ root: AXUIElement, maxVisit: Int = 250) -> Bool {
    var stack: [AXUIElement] = [root]
    var visited = 0
    while !stack.isEmpty && visited < maxVisit {
        let el = stack.removeLast()
        visited += 1
        if axString(el, kAXRoleAttribute as String) == "AXWebArea" { return true }
        for kid in axChildren(el).reversed() { stack.append(kid) }
    }
    return false
}

func macIsWebOrElectronApp(pid: pid_t, window: AXUIElement) -> Bool {
    if let app = NSRunningApplication(processIdentifier: pid) {
        let bid = (app.bundleIdentifier ?? "").lowercased()
        let name = (app.localizedName ?? "").lowercased()
        let webIds = ["chrome", "chromium", "safari", "webkit", "firefox", "brave", "edgemac", "arc", "vivaldi", "opera", "slack", "vscode", "cursor", "electron", "discord", "notion", "obsidian", "teams", "whatsapp"]
        if webIds.contains(where: { bid.contains($0) || name.contains($0) }) { return true }
    }
    return macHasWebArea(window, maxVisit: 80)
}

func macPatterns(role: String, actions: [String], hasNameOrId: Bool) -> [String] {
    var out: [String] = []
    func add(_ p: String) { if !out.contains(p) { out.append(p) } }
    if toggleRoles.contains(role) { add("Toggle") }
    if role == "AXTextField" || role == "AXTextArea" || role == "AXComboBox" || role == "AXSearchField" { add("Value") }
    if role == "AXSlider" || role == "AXValueIndicator" || role == "AXProgressIndicator" || actions.contains("AXIncrement") || actions.contains("AXDecrement") { add("RangeValue") }
    if role == "AXPopUpButton" || role == "AXComboBox" || actions.contains("AXShowMenu") { add("ExpandCollapse") }
    if role == "AXRadioButton" || role == "AXTab" { add("SelectionItem") }
    if role == "AXScrollArea" || role == "AXScrollBar" { add("Scroll") }
    let layoutRoles: Set<String> = ["AXGroup", "AXUnknown", "AXSplitGroup", "AXLayoutArea", "AXWebArea", "AXWindow", "AXScrollArea"]
    if (actions.contains("AXPress") || actions.contains("AXConfirm") || actions.contains("AXPick")) && (!layoutRoles.contains(role) || hasNameOrId) {
        add("Invoke")
    }
    for raw in actions {
        let stripped = raw.replacingOccurrences(of: "AX", with: "")
        if !stripped.isEmpty && (!layoutRoles.contains(role) || hasNameOrId || stripped != "Press") {
            add(stripped)
        }
    }
    return out
}

func opSnapshot(_ a: [String: Any]) throws -> [String: Any] {
    let (win, pid, title, handle) = try resolveWindow(a)
    let budgetMs = int(a["time_budget_ms"], 4000)
    let started = MacDeadline.now

    macEnableWebAccessibility(pid)
    let isWebCandidate = macIsWebOrElectronApp(pid: pid, window: win)
    if isWebCandidate && !macHasWebArea(win, maxVisit: 120) {
        let waitCapMs = min(450, max(0, budgetMs / 3))
        var waitedMs = 0
        while waitedMs < waitCapMs {
            if MacDeadline.walkBudgetExceeded(start: started, now: MacDeadline.now, budgetMs: budgetMs) { break }
            Thread.sleep(forTimeInterval: 0.05)
            waitedMs += 50
            if macHasWebArea(win, maxVisit: 160) { break }
        }
    }

    let requestedNodes = int(a["max_nodes"], 1500)
    let walkMaxNodes = isWebCandidate ? max(requestedNodes, 1200) : max(requestedNodes, 600)
    let maxDepth = int(a["max_depth"], isWebCandidate ? 42 : 28)
    let interactiveOnly = bool(a["interactive_only"], false)

    var nodes: [[String: Any]] = []
    var elements: [AXUIElement] = []
    var truncated = false
    var overBudget = false
    var foundWebArea = false

    var stack: [(AXUIElement, Int)] = [(win, 0)]
    while !stack.isEmpty {
        if nodes.count >= walkMaxNodes { truncated = true; break }
        if MacDeadline.walkBudgetExceeded(start: started, now: MacDeadline.now, budgetMs: budgetMs) { overBudget = true; break }
        let (el, depth) = stack.removeLast()

        let rect = axRect(el)
        let actions = axActions(el)
        let role = axString(el, kAXRoleAttribute as String) ?? "AXUnknown"
        let subrole = axString(el, kAXSubroleAttribute as String) ?? ""
        let isSecure = role.lowercased().contains("secure") || subrole.lowercased().contains("secure")
        if role == "AXWebArea" { foundWebArea = true }
        let name = macSnapshotName(el)
        let ident = axString(el, kAXIdentifierAttribute as String)
        let textVal = !isSecure ? axValueText(el) : nil
        let hasNameOrId = !(name?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            || !(ident?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        let hasText = !(textVal?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        let patterns = macPatterns(role: role, actions: actions, hasNameOrId: hasNameOrId)
        let interactive = !patterns.isEmpty || actions.contains { interestingActions.contains($0) }

        var include = true
        if interactiveOnly && depth > 0 && !interactive { include = false }
        if rect == nil && depth > 0 { include = false }
        if depth > 0 && (role == "AXGroup" || role == "AXSplitGroup" || role == "AXUnknown" || role == "AXLayoutArea") && !hasNameOrId && !hasText {
            include = false
        }

        if include {
            var node: [String: Any] = ["i": nodes.count, "role": macRole(role), "depth": depth]
            if let n = name, !n.isEmpty { node["name"] = n }
            if let id = ident, !id.isEmpty { node["id"] = id; node["aid"] = id }
            if let r = rect { node["rect"] = r }
            if !patterns.isEmpty { node["patterns"] = patterns }
            if let t = textVal {
                node["text"] = t.count > 4000 ? String(t.prefix(4000)) + "...[truncated]" : t
            }
            var state: [String: Any] = [:]
            if let enabled = axBool(el, kAXEnabledAttribute as String), !enabled { state["disabled"] = true }
            if let focused = axBool(el, kAXFocusedAttribute as String), focused { state["focused"] = true }
            if let selected = axBool(el, kAXSelectedAttribute as String), selected { state["selected"] = true }
            if let expanded = axBool(el, kAXExpandedAttribute as String) { state["expanded"] = expanded }
            if toggleRoles.contains(role), let v = axAttr(el, kAXValueAttribute as String) as? Int {
                state["toggle"] = v == 1 ? "on" : (v == 2 ? "mixed" : "off")
            }
            if !state.isEmpty { node["state"] = state }
            nodes.append(node)
            elements.append(el)
        }

        if depth < maxDepth && !isSecure {
            let kids = axChildren(el)
            for kid in kids.reversed() { stack.append((kid, depth + 1)) }
        }
    }

    // A poll (wait_for) reads without keeping, so it neither bumps the
    // sequence nor evicts a snapshot the model is still acting on.
    let register = bool(a["register"], true)
    var sid: String? = nil
    if register {
        snapSeq += 1
        sid = "s\(snapSeq)"
        let snap = Snapshot()
        snap.elements = elements
        snap.pid = pid
        snap.title = title
        snap.handle = handle
        snapshots[sid!] = snap
    }
    while snapshots.count > maxSnapshots {
        if let oldest = snapshots.min(by: { $0.value.taken < $1.value.taken })?.key {
            snapshots.removeValue(forKey: oldest)
        } else { break }
    }

    var out: [String: Any] = [
        "snapshot_id": sid as Any,
        "hwnd": handle,
        "title": title,
        "rect": axRect(win) as Any,
        "node_count": nodes.count,
        "truncated": truncated || overBudget,
        "nodes": nodes,
    ]
    if foundWebArea { out["web"] = true }
    if overBudget { out["time_budget_ms"] = budgetMs }
    return out
}

// Selector targeting, so the macOS surface matches the Windows one instead of
// forcing every caller to take a snapshot first.
func findBySelector(_ a: [String: Any]) throws -> (AXUIElement, pid_t) {
    guard let sel = a["selector"] as? [String: Any] else {
        throw AxonError("bad_selector", "Selector must be an object.", nil)
    }
    let wantName = str(sel["name"])
    let wantRole = str(sel["role"])
    let wantId = str(sel["automation_id"])
    if wantName == nil && wantRole == nil && wantId == nil {
        throw AxonError("bad_selector", "Selector needs at least one of automation_id, name, or role.", nil)
    }
    let (win, pid, _, _) = try resolveWindow(a)

    var stack: [AXUIElement] = [win]
    var seen = 0
    while !stack.isEmpty && seen < 4000 {
        let el = stack.removeLast()
        seen += 1
        let role = axString(el, kAXRoleAttribute as String) ?? ""
        let name = axString(el, kAXTitleAttribute as String)
            ?? axString(el, kAXDescriptionAttribute as String)
        let ident = axString(el, kAXIdentifierAttribute as String)
        var ok = true
        if let w = wantName, name != w { ok = false }
        if let w = wantRole, role != w && role != "AX" + w { ok = false }
        if let w = wantId, ident != w { ok = false }
        if ok { return (el, pid) }
        for kid in axChildren(el) { stack.append(kid) }
    }
    throw AxonError("element_not_found", "No element matched the selector.",
                    "Take a snapshot to see what the window actually exposes.")
}

// One entry point for every way an action can name its target.
func resolveTarget(_ a: [String: Any]) throws -> (AXUIElement, pid_t) {
    if a["index"] != nil { return try snapshotElement(a) }
    if a["selector"] != nil { return try findBySelector(a) }
    if let p = pair(a["point"]) {
        let (_, pid, _, _) = try resolveWindow(a)
        guard let el = elementAt(p[0], p[1]) else {
            throw AxonError("no_element_at_point", "Nothing is at that point.", "Check the coordinates against with_rects:true.")
        }
        return (el, pid)
    }
    throw AxonError("no_target", "Provide index, selector or point.",
                    "Prefer an index from a snapshot.")
}

func snapshotElement(_ a: [String: Any]) throws -> (AXUIElement, pid_t) {
    var sid = str(a["snapshot_id"]) ?? ""
    guard !sid.isEmpty else { throw AxonError("stale_observation", "A native snapshot ID is required.") }
    if sid.isEmpty {
        if snapSeq == 0 {
            throw AxonError("no_snapshot", "No snapshot has been taken yet.",
                            "Call snapshot on the target window first.")
        }
        sid = "s\(snapSeq)"
    }
    guard let snap = snapshots[sid] else {
        throw AxonError("snapshot_expired", "Snapshot \(sid) is no longer held.", "Take a fresh snapshot.")
    }
    // The caller's window wins. An index resolved with no snapshot_id falls
    // back to the newest snapshot taken of ANY window - if the model read a
    // dialog or a second window after reading the one it means to act on,
    // that snapshot, not the target's, would otherwise supply the element
    // (the Windows host guards the same way in SnapshotElement). When the
    // caller named a window, only a snapshot of that window may answer.
    let wantHandle = int(a["hwnd"], -1)
    guard wantHandle > 0, snap.handle == wantHandle, Date().timeIntervalSince(snap.taken) * 1000 <= Double(MacContract.value["frame_ms"] as? Int ?? 90000) else {
        throw AxonError("stale_observation", "The native snapshot belongs to another window or has expired.")
    }
    let idx = int(a["index"], -1)
    guard idx >= 0 && idx < snap.elements.count else {
        throw AxonError("index_out_of_range",
                        "Index \(idx) is outside snapshot \(sid) (0..\(snap.elements.count - 1)).",
                        "Re-read the snapshot listing.")
    }
    let el = snap.elements[idx]
    if !axAlive(el) {
        throw AxonError("element_stale", "Element \(idx) from \(sid) no longer exists.",
                        "The UI changed. Take a fresh snapshot.")
    }
    return (el, snap.pid)
}

func markedEvent(_ e: CGEvent?) -> CGEvent? {
    e?.setIntegerValueField(.eventSourceUserData, value: AXON_EVENT_MARKER)
    return e
}

func post(_ e: CGEvent?) throws {
    try MacFence.check()
    guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
        throw AxonError("mac_permissions_required", "Native input permission was revoked. No further input was sent.")
    }
    guard let event = markedEvent(e) else { throw AxonError("event_creation_failed", "Cannot construct native input.") }
    if [.leftMouseDown,.rightMouseDown,.otherMouseDown,.leftMouseDragged,.rightMouseDragged,.otherMouseDragged,.scrollWheel].contains(event.type) {
        if let stroke = macStrokeTarget, [.leftMouseDragged,.rightMouseDragged,.otherMouseDragged].contains(event.type) { try macCheckStrokePoint(event.location, stroke) }
        else { try macCheckTargetPoint(event.location,MacFence.current) }
    }
    try MacInputLedger.withLock {
        try MacInputLedger.record(event, before: true)
        try MacFence.dispatched(); event.post(tap: .cghidEventTap)
        try MacInputLedger.record(event, before: false)
    }
}

// What the element looks like now the action has landed, so the caller does not
// need a second read just to confirm - the Windows host does the same.
func nowState(_ el: AXUIElement) -> [String: Any]? {
    var now: [String: Any] = [:]
    if let v = axAttr(el, kAXValueAttribute as String) {
        if let s = v as? String, !s.isEmpty { now["text"] = s.count > 200 ? String(s.prefix(200)) + "..." : s }
        else if let b = v as? Bool { now["value"] = b }
        else if let n = v as? Int { now["value"] = n }
    }
    if let enabled = axBool(el, kAXEnabledAttribute as String), !enabled { now["disabled"] = true }
    return now.isEmpty ? nil : now
}

func mouseTypes(_ button: String) -> (CGEventType, CGEventType, CGEventType, CGMouseButton) {
    if button == "right" { return (.rightMouseDown, .rightMouseUp, .rightMouseDragged, .right) }
    if button == "middle" { return (.otherMouseDown, .otherMouseUp, .otherMouseDragged, .center) }
    return (.leftMouseDown, .leftMouseUp, .leftMouseDragged, .left)
}

func opClick(_ a: [String: Any]) throws -> [String: Any] {
    var res: [String: Any] = [:]
    let button = (str(a["button"]) ?? "left").lowercased()
    let clicks = max(1, min(3, int(a["clicks"], 1)))
    let forcePhysical = bool(a["physical"], false)

    var target: AXUIElement? = nil
    var point = CGPoint.zero
    if let p = pair(a["point"]) {
        // A point click names its window for policy, and its point for the pointer.
        let (_, pid, _, _) = try resolveWindow(a)
        try guardSameWindow(a, pid)
        point = CGPoint(x: Double(p[0]), y: Double(p[1]))
    } else {
        let (el, pid) = try resolveTarget(a)
        try guardSameWindow(a, pid)
        target = el
        if axBool(el, kAXEnabledAttribute as String) == false {
            throw AxonError("element_disabled", "The observed control is disabled. No click was sent.", "Wait for it to become enabled and observe again.")
        }
        // AXPress is the counterpart of the Windows invoke pattern: no cursor
        // movement, nothing the user can feel. Only for a plain left click.
        if !forcePhysical && button == "left" && clicks == 1 && axActions(el).contains("AXPress") {
            try MacFence.dispatched()
            if AXUIElementPerformAction(el, "AXPress" as CFString) == .success {
                res["method"] = "ax_press"
                Thread.sleep(forTimeInterval: 0.04)
                if let now = nowState(el) { res["now"] = now }
                return res
            }
            throw AxonError("input_outcome_unknown", "The provider did not confirm invocation; no physical fallback was sent.")
        }
        guard let rect = axRect(el) else {
            throw AxonError("no_click_point", "Element has no on-screen rectangle.", "Scroll it into view first.")
        }
        point = CGPoint(x: Double(rect[0] + rect[2] / 2), y: Double(rect[1] + rect[3] / 2))
    }

    let waited = try guardDisturb(a)
    if waited > 0 { res["waited_for_user_ms"] = waited }
    try checkStop()
    try macBringToFront(a)
    res["motion"] = try macMoveCursor(point, a)
    try macCheckTargetPoint(point, a)

    let saved = CGEvent(source: nil)?.location
    let src = CGEventSource(stateID: .hidSystemState)
    let (downType, upType, _, cgButton) = mouseTypes(button)

    try post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left))
    Thread.sleep(forTimeInterval: 0.02)
    for n in 1...clicks {
        if let d = CGEvent(mouseEventSource: src, mouseType: downType, mouseCursorPosition: point, mouseButton: cgButton) {
            d.setIntegerValueField(.mouseEventClickState, value: Int64(n))
            try post(d)
        }
        Thread.sleep(forTimeInterval: 0.012)
        if let u = CGEvent(mouseEventSource: src, mouseType: upType, mouseCursorPosition: point, mouseButton: cgButton) {
            u.setIntegerValueField(.mouseEventClickState, value: Int64(n))
            try post(u)
        }
        if n < clicks { Thread.sleep(forTimeInterval: 0.06) }
    }

    // take and exclusive both mean "drive it"; only the courtesy modes put the
    // pointer back where the user left it.
    let m = modeOf(a)
    if m != "take" && m != "exclusive", let back = saved {
        Thread.sleep(forTimeInterval: 0.02)
        try post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: back, mouseButton: .left))
        res["cursor_restored"] = true
    }
    res["method"] = "physical"
    res["button"] = button
    res["clicks"] = clicks
    res["point"] = [Int(point.x), Int(point.y)]
    if let el = target, let now = nowState(el) { res["now"] = now }
    return res
}

let macMaxStrokeHops = 1500
// Hops per segment of a stroke (index 0 unused): steps for a straight drag,
// otherwise about 8 pt per hop (1 to 40), scaled down to macMaxStrokeHops.
func macStrokeHops(_ path: [[Int]], steps: Int) -> [Int] {
    var hops = [Int](repeating: 0, count: path.count), wanted = 0
    for s in 1..<path.count {
        let dx = Double(path[s][0] - path[s - 1][0]), dy = Double(path[s][1] - path[s - 1][1])
        hops[s] = path.count == 2 ? steps : max(1, min(40, Int((dx * dx + dy * dy).squareRoot() / 8)))
        wanted += hops[s]
    }
    if wanted > macMaxStrokeHops { for s in 1..<path.count { hops[s] = max(1, hops[s] * macMaxStrokeHops / wanted) } }
    return hops
}

func opDrag(_ a: [String: Any]) throws -> [String: Any] {
    var res: [String: Any] = [:]
    guard let from = pair(a["from"]), let to = pair(a["to"]) else {
        throw AxonError("bad_points", "drag needs from:[x,y] and to:[x,y] in screen coordinates.",
                        "Read the window with with_rects:true to find the points.")
    }
    // Optional points draw one continuous stroke through every point (curves
    // on a canvas); from/to are its first and last points. Same rule and
    // timing as the Windows host (AxonHost.cs OpDrag).
    var path: [[Int]] = [from, to]
    if let raw = a["points"] as? [Any] {
        path = []
        for p in raw {
            guard let q = pair(p) else { throw AxonError("bad_points", "Every point must be [x,y].") }
            path.append(q)
        }
        guard path.count >= 2 && path.count <= 400 else { throw AxonError("bad_points", "A points drag needs 2 to 400 points.") }
        guard path[0] == from, path[path.count - 1] == to else { throw AxonError("bad_points", "from and to must be the first and last points.") }
    }
    let button = (str(a["button"]) ?? "left").lowercased()
    let steps = max(2, min(200, int(a["steps"], 12)))
    let holdMs = max(0, min(2000, int(a["hold_ms"], 60)))
    let (win, pid, _, _) = try resolveWindow(a)
    try guardSameWindow(a, pid)
    try macBringToFront(a)
    // Validate every point before moving or holding a button.
    for p in path { try macCheckTargetPoint(CGPoint(x: p[0], y: p[1]), a) }
    // About 8 pt per hop, at most macMaxStrokeHops hops in total, whatever the point count.
    let hops = macStrokeHops(path, steps: steps)
    // Resolved once; every dragged event is still checked against it.
    macStrokeTarget = try macStrokeTarget(a)
    defer { macStrokeTarget = nil }
    let waited = try guardDisturb(a)
    if waited > 0 { res["waited_for_user_ms"] = waited }
    try checkStop()
    // A drag is physical and lands wherever the pointer is, so the app has to
    // be in front; a drag into the wrong app is the failure worse than nothing.
    if macFrontmostPid() != pid {
        let m = modeOf(a)
        if m == "take" || m == "exclusive" {
            NSRunningApplication(processIdentifier: pid)?.activate(options: [])
            AXUIElementPerformAction(win, kAXRaiseAction as CFString)
            Thread.sleep(forTimeInterval: 0.15)
        }
        if macFrontmostPid() != pid {
            throw AxonError("window_not_focused", "That window's app is not in front, so the drag would land in whatever is.",
                            "Call focus on it first, or pass mode:\"take\".")
        }
    }
    let saved = CGEvent(source: nil)?.location
    let src = CGEventSource(stateID: .hidSystemState)
    let (downType, upType, dragType, cgButton) = mouseTypes(button)
    let start = CGPoint(x: Double(from[0]), y: Double(from[1]))
    res["approach_motion"] = try macMoveCursor(start, a)
    try post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: start, mouseButton: .left))
    Thread.sleep(forTimeInterval: 0.03)
    try post(CGEvent(mouseEventSource: src, mouseType: downType, mouseCursorPosition: start, mouseButton: cgButton))
    Thread.sleep(forTimeInterval: Double(holdMs) / 1000.0)
    for s in 1..<path.count {
        let p0 = path[s - 1], p1 = path[s], n = hops[s]
        for i in 1...n {
            let p = CGPoint(x: Double(p0[0] + (p1[0] - p0[0]) * i / n),
                            y: Double(p0[1] + (p1[1] - p0[1]) * i / n))
            try post(CGEvent(mouseEventSource: src, mouseType: dragType, mouseCursorPosition: p, mouseButton: cgButton))
            Thread.sleep(forTimeInterval: path.count == 2 ? 0.012 : 0.004)
        }
    }
    Thread.sleep(forTimeInterval: Double(holdMs) / 1000.0)
    let end = CGPoint(x: Double(to[0]), y: Double(to[1]))
    try post(CGEvent(mouseEventSource: src, mouseType: upType, mouseCursorPosition: end, mouseButton: cgButton))
    Thread.sleep(forTimeInterval: 0.03)
    let m = modeOf(a)
    if m != "take" && m != "exclusive", let back = saved {
        try post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: back, mouseButton: .left))
        res["cursor_restored"] = true
    }
    res["from"] = from
    res["to"] = to
    res["button"] = button
    res["steps"] = steps
    if path.count > 2 { res["points"] = path.count }
    return res
}

// A successful AX return is not proof that the provider applied a value.
// Use read-back evidence and never repeat an uncertain write via keyboard.
func axValueDisposition(_ before: CFTypeRef?, _ after: CFTypeRef?, _ expected: CFTypeRef) -> String? {
    guard let after = after else { return nil }
    if CFEqual(after, expected) { return "exact" }
    if let before = before, !CFEqual(after, before) { return "changed" }
    return nil
}

func opSetValue(_ a: [String: Any]) throws -> [String: Any] {
    let (el, pid) = try resolveTarget(a)
    try guardSameWindow(a, pid)
    try checkStop()
    let expected: CFTypeRef
    if let text = a["text"] as? String { expected = text as CFString }
    else if let value = a["value"] as? NSNumber { expected = value as CFTypeRef }
    else { throw AxonError("bad_value", "Set value requires text or a numeric value.") }
    let before = axAttr(el, kAXValueAttribute as String)
    try MacFence.dispatched()
    guard AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, expected) == .success else {
        throw AxonError("input_outcome_unknown", "The provider did not confirm the value. Observe before continuing; do not automatically type a fallback.")
    }
    for _ in 0..<12 {
        try checkStop()
        let after = axAttr(el, kAXValueAttribute as String)
        if let disposition = axValueDisposition(before, after, expected), let after = after {
            var res: [String: Any] = ["method": "ax_value", "value": after]
            if disposition == "changed" { res["normalised_by_app"] = true }
            if let now = nowState(el) { res["now"] = now }
            return res
        }
        Thread.sleep(forTimeInterval: 0.05)
    }
    throw AxonError("input_outcome_unknown", "The provider did not confirm the value after dispatch. Observe before continuing; do not automatically type a fallback.")
}

func opType(_ a: [String: Any]) throws -> [String: Any] {
    try macBringToFront(a)
    try macEnsureTyping(a)
    var res: [String: Any] = [:]
    if a["index"] != nil || a["selector"] != nil {
        let (el, pid) = try resolveTarget(a)
        try guardSameWindow(a, pid)
        let setErr = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, true as CFTypeRef)
        // Keystrokes follow the keyboard focus, not the element we named. If
        // focusing it did not take, typing anyway would put the text into
        // whatever the user has in front - the one failure worse than nothing.
        let landed = axBool(el, kAXFocusedAttribute as String) ?? false
        if setErr != .success && !landed {
            throw AxonError("focus_failed",
                "Could not put the keyboard focus on that element, so the text would have gone to whatever window is in front instead.",
                "Use replace:true, which writes through the element's value attribute and needs no focus at all.")
        }
        // AXFocused is focus *within* its own app. An element in a background
        // app can hold it while the keystrokes below - which go to the system
        // event tap - land in whatever app is actually in front. Windows avoids
        // this by posting straight to the control and reading it back; there is
        // no equivalent here, so refuse rather than type into the wrong app.
        let front = macFrontmostPid()
        if front != pid {
            throw AxonError("background_unavailable",
                "That element is in an app that is not in front, and plain typing goes wherever the keyboard focus is, so the text would land in another app.",
                "Use replace:true, which writes through the element's value attribute without focus and leaves the window where it is, or focus the window first.")
        }
    } else {
        let waited = try guardDisturb(a)
        if waited > 0 { res["waited_for_user_ms"] = waited }
    }
    try checkStop()
    let text = str(a["text"]) ?? ""
    let (_, typingPid, _, _) = try resolveWindow(a)
    let src = CGEventSource(stateID: .hidSystemState)
    for ch in text.unicodeScalars {
        if ch == "\r" { continue }
        // Human input never pauses automation, so the human can bring another
        // app forward while this loop runs. Check before every character, so a
        // switch stops typing instead of sending the rest into the wrong app.
        guard macFrontmostPid() == typingPid else {
            throw AxonError("focus_changed", "Another app came to the front while typing, so typing stopped and the rest was not sent.",
                            "Observe, bring the approved window forward, and type only the missing part.")
        }
        for event in macTypingEvents(source: src, scalar: ch) { try post(event) }
    }
    res["typed"] = text.count
    return res
}

let keyCodes: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
    "forwarddelete": 117, "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "capslock": 57,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32,
    "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25,
    "-": 27, "minus": 27, "=": 24, "equal": 24, "[": 33, "]": 30, ";": 41, "semicolon": 41,
    "'": 39, "quote": 39, ",": 43, "comma": 43, ".": 47, "period": 47, "/": 44, "slash": 44,
    "\\": 42, "backslash": 42, "`": 50, "grave": 50,
]

func opKey(_ a: [String: Any]) throws -> [String: Any] {
    try macBringToFront(a)
    try macEnsureTyping(a)
    var res: [String: Any] = [:]
    let chord = (str(a["keys"]) ?? "").lowercased()
    if chord.isEmpty { throw AxonError("bad_keys", "Empty key chord.", nil) }

    // Keys go wherever the keyboard focus is. When a window is named, its app
    // has to be in front - or be brought forward, in the modes that allow it.
    if a["hwnd"] != nil || a["title"] != nil {
        let (win, pid, _, _) = try resolveWindow(a)
        try guardSameWindow(a, pid)
        if macFrontmostPid() != pid {
            let m = modeOf(a)
            if m == "take" || m == "exclusive" {
                NSRunningApplication(processIdentifier: pid)?.activate(options: [])
                AXUIElementPerformAction(win, kAXRaiseAction as CFString)
                Thread.sleep(forTimeInterval: 0.15)
            }
            if macFrontmostPid() != pid {
                throw AxonError("window_not_focused", "That window's app is not in front, so the keys would go to whatever is.",
                                "Call focus on it first, or pass mode:\"take\" to bring it forward.")
            }
        }
    }
    let waited = try guardDisturb(a)
    if waited > 0 { res["waited_for_user_ms"] = waited }
    try checkStop()

    var parts = chord.split(separator: "+").map { String($0) }
    guard let last = parts.popLast(), let code = keyCodes[last] else {
        throw AxonError("unknown_key", "Unrecognised key in '\(chord)'.",
                        "Use names like cmd+s, alt+f4, enter, tab, f5.")
    }
    var flags: CGEventFlags = []
    for m in parts {
        switch m {
        case "cmd", "command", "meta", "win": flags.insert(.maskCommand)
        case "ctrl", "control": flags.insert(.maskControl)
        case "alt", "option": flags.insert(.maskAlternate)
        case "shift": flags.insert(.maskShift)
        default: throw AxonError("unknown_key", "Unrecognised modifier '\(m)'.", nil)
        }
    }
    let src = CGEventSource(stateID: .hidSystemState)
    if let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true) {
        down.flags = flags
        try post(down)
    }
    if let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false) {
        up.flags = flags
        try post(up)
    }
    res["sent"] = chord
    return res
}

func opScroll(_ a: [String: Any]) throws -> [String: Any] {
    var res: [String: Any] = [:]
    let amount = int(a["amount"], -3)
    let horizontal = bool(a["horizontal"], false)
    let src = CGEventSource(stateID: .hidSystemState)

    // Park the pointer over the target first, since a scroll event goes to
    // whatever is under the cursor.
    if a["index"] != nil || a["selector"] != nil || a["point"] != nil {
        let (el, pid) = try resolveTarget(a)
        try guardSameWindow(a, pid)
        if let r = axRect(el) {
            let waited = try guardDisturb(a)
            if waited > 0 { res["waited_for_user_ms"] = waited }
            let p = CGPoint(x: Double(r[0] + r[2] / 2), y: Double(r[1] + r[3] / 2))
            try post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
        }
    } else {
        let waited = try guardDisturb(a)
        if waited > 0 { res["waited_for_user_ms"] = waited }
    }
    try checkStop()

    // wheelCount tells CGEvent how many wheels to read: with 1, wheel2 is
    // never looked at, so a horizontal scroll silently did nothing. wheel1
    // is still 0 in that case, which is a harmless no-op vertical scroll.
    let ev = CGEvent(scrollWheelEvent2Source: src, units: .line,
                     wheelCount: 2,
                     wheel1: horizontal ? 0 : Int32(amount),
                     wheel2: horizontal ? Int32(amount) : 0,
                     wheel3: 0)
    try post(ev)
    res["method"] = "wheel"
    res["delta"] = amount
    return res
}

func opFocus(_ a: [String: Any]) throws -> [String: Any] {
    var res: [String: Any] = [:]
    let (win, pid, title, handle) = try resolveWindow(a)
    let waited = try guardDisturb(a)
    if waited > 0 { res["waited_for_user_ms"] = waited }
    try checkStop()
    AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, false as CFTypeRef)
    let ok = NSRunningApplication(processIdentifier: pid)?.activate(options: []) ?? false
    AXUIElementPerformAction(win, kAXRaiseAction as CFString)
    res["focused"] = ok
    res["hwnd"] = handle
    res["title"] = title
    return res
}

func opCloseWindow(_ a: [String: Any]) throws -> [String: Any] {
    let (win, pid, title, _) = try resolveWindow(a)
    try guardSameWindow(a, pid)
    try checkStop()
    // Press the window's own close button, so the app can still offer to save.
    // Axon has no way to terminate a process, on either platform.
    if let closeBtn = axAttr(win, kAXCloseButtonAttribute as String),
       CFGetTypeID(closeBtn) == AXUIElementGetTypeID() {
        AXUIElementPerformAction(closeBtn as! AXUIElement, "AXPress" as CFString)
    }
    Thread.sleep(forTimeInterval: 0.25)
    return ["closed": title, "still_open": axAlive(win)]
}

func opWaitFor(_ a: [String: Any]) throws -> [String: Any] {
    let timeout = int(a["timeout_ms"], 5000)
    let selector = a["selector"] as? [String: Any] ?? [:]
    let wantName = str(selector["name"])
    let wantRole = str(selector["role"])
    let wantId = str(selector["automation_id"])
    let deadline = Date().addingTimeInterval(Double(timeout) / 1000.0)
    let started = Date()

    var poll = a
    poll["register"] = false
    while Date() < deadline {
        try checkStop()
        if let snap = try? opSnapshot(poll), let nodes = snap["nodes"] as? [[String: Any]] {
            for n in nodes {
                let name = n["name"] as? String
                let role = n["role"] as? String
                let ident = n["id"] as? String
                if let w = wantName, name != w { continue }
                if let w = wantRole, role != w && role != "AX" + w { continue }
                if let w = wantId, ident != w { continue }
                if wantName == nil && wantRole == nil && wantId == nil { continue }
                return [
                    "found": true,
                    "role": role as Any,
                    "name": name as Any,
                    "rect": n["rect"] as Any,
                    "waited_ms": Int(Date().timeIntervalSince(started) * 1000),
                ]
            }
        }
        Thread.sleep(forTimeInterval: 0.2)
    }
    throw AxonError("wait_timeout", "Element did not appear within \(timeout)ms.",
                    "Take a snapshot to see the current state.")
}

// What a target is, before it is pressed: the server asks this for clicks by
// selector or point, so its consequence gate can read the control's name.
func opDescribe(_ a: [String: Any]) throws -> [String: Any] {
    do {
        let (el, _) = try resolveTarget(a)
        var out: [String: Any] = ["found": true]
        out["role"] = axString(el, kAXRoleAttribute as String) as Any
        out["name"] = (axString(el, kAXTitleAttribute as String) ?? axString(el, kAXDescriptionAttribute as String)) as Any
        out["rect"] = axRect(el) as Any
        return out
    } catch {
        return ["found": false]
    }
}

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowID: UnsafeMutablePointer<CGWindowID>) -> AXError

func axWindowID(_ window: AXUIElement?) -> CGWindowID {
    guard let w = window else { return 0 }
    var wid: CGWindowID = 0
    return _AXUIElementGetWindow(w, &wid) == .success ? wid : 0
}

func macWindowTitleMatches(axTitle: String, cgName: String) -> Bool {
    if cgName.isEmpty || axTitle.isEmpty || cgName == axTitle { return true }
    // Browsers (e.g. Google Chrome) append " - <App> - <Profile>" or " — <App>"
    // to the AXWindow title while setting kCGWindowName to only the tab title.
    if axTitle.hasPrefix(cgName + " - ") || axTitle.hasPrefix(cgName + " — ") { return true }
    if cgName.hasPrefix(axTitle + " - ") || cgName.hasPrefix(axTitle + " — ") { return true }
    return false
}

func matchCGWindow(
    list: [[String: Any]],
    pid: pid_t,
    title: String,
    rect: [Int]?,
    directWindowID: CGWindowID = 0
) -> CGWindowID? {
    if directWindowID != 0 {
        if let hit = list.first(where: {
            ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == directWindowID &&
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid &&
            (($0[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0) == 0
        }) {
            return (hit[kCGWindowNumber as String] as? NSNumber)?.uint32Value
        }
    }
    guard let r = rect, r.count == 4 else { return nil }
    let sameBounds = list.filter { w in
        guard (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (w[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let b = w[kCGWindowBounds as String] as? [String: Any] else { return false }
        let values = ["X", "Y", "Width", "Height"].map { (b[$0] as? NSNumber)?.intValue ?? Int.min }
        return values == r
    }
    let exact = sameBounds.filter { w in
        let name = w[kCGWindowName as String] as? String ?? ""
        return name == title
    }
    if exact.count == 1 {
        return (exact[0][kCGWindowNumber as String] as? NSNumber)?.uint32Value
    }
    let compatible = sameBounds.filter { w in
        let name = w[kCGWindowName as String] as? String ?? ""
        return macWindowTitleMatches(axTitle: title, cgName: name)
    }
    guard compatible.count == 1 else { return nil }
    return (compatible[0][kCGWindowNumber as String] as? NSNumber)?.uint32Value
}

// The CGWindowID that belongs to an AX window, verified by direct AX->CGWindowID
// binding (with owner PID and layer 0 check) or unambiguous bounds+title match.
func windowNumber(window: AXUIElement? = nil, pid: pid_t, title: String, rect: [Int]?, onScreenOnly: Bool = true) -> CGWindowID? {
    let options: CGWindowListOption = onScreenOnly ? [.optionOnScreenOnly, .excludeDesktopElements] : [.excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
    return matchCGWindow(list: list, pid: pid, title: title, rect: rect, directWindowID: axWindowID(window))
}

func opScreenshot(_ a: [String: Any]) throws -> [String: Any] { return try macCapture(a) }

// The clipboard: how text leaves an app that will not expose it any other
// way, and how a long paste goes in without a thousand keystrokes.
func opClipboard(_ a: [String: Any]) throws -> [String: Any] {
    let pb = NSPasteboard.general
    if let text = str(a["text"]) {
        pb.clearContents()
        pb.setString(text, forType: .string)
        return ["set": true, "length": text.count]
    }
    if let s = pb.string(forType: .string) {
        return ["has_text": true, "text": s, "length": s.count]
    }
    return ["has_text": false]
}

// The server marks a run as in flight between its steps, so Escape pressed
// during a sleep still counts as Stop.
func opBusy(_ a: [String: Any]) throws -> [String: Any] {
    let on = bool(a["on"], false)
    Presence.shared.setTask(on)
    return ["task_active": on]
}

// There is no on-screen banner on macOS; the status is accepted and dropped.
func opBanner(_ a: [String: Any]) throws -> [String: Any] {
    return ["status": str(a["text"]) ?? ""]
}

func opPresence(_ a: [String: Any]) throws -> [String: Any] {
    var r = Presence.shared.report()
    r["user_active"] = Presence.shared.active(idleThresholdMs)
    r["user_busy"] = Presence.shared.busy(idleThresholdMs)
    r["idle_threshold_ms"] = idleThresholdMs
    r["mode"] = defaultMode
    // Protocol parity with the Windows host: no BlockInput here.
    r["input_blocked"] = false
    let frontPid = macFrontmostPid()
    let front = frontPid > 0 ? NSRunningApplication(processIdentifier: frontPid) : nil
    r["foreground_hwnd"] = Int(frontPid)
    r["foreground_process"] = front?.localizedName as Any
    r["foreground_title"] = front?.localizedName as Any
    return r
}

// Protocol parity with the Windows host, which uses this to place and label its
// on-screen banner when more than one Claude session is running. macOS has no
// banner, so there is nothing to place - but the op has to exist, or the MCP
// layer would retry a failing call on every action.
func opSession(_ a: [String: Any]) throws -> [String: Any] {
    return ["ok": true, "banner": false]
}

func opPing(_ a: [String: Any]) throws -> [String: Any] {
    return [
        "ok": true,
        "dpi_mode": "native",
        "platform": "darwin",
        "accessibility": trusted(),
        "snapshots": snapshots.count,
    ]
}

// MARK: - Dispatch

let actingOps: Set<String> = ["click", "type", "set_value", "key", "scroll", "focus", "close_window", "drag"]

func dispatch(_ op: String, _ a: [String: Any]) throws -> [String: Any] {
    try MacFence.begin(op, a)
    if actingOps.contains(op) {
        Presence.shared.beginAct()
        defer { Presence.shared.endAct() }
        try checkStop()
        return try dispatchOp(op, a)
    }
    return try dispatchOp(op, a)
}

func dispatchOp(_ op: String, _ a: [String: Any]) throws -> [String: Any] {
    switch op {
    case "identity": return try macWindowIdentity(a)
    case "caller_gate_open": return try MacCallerGate.open()
    case "caller_gate_redeem": return MacCallerGate.redeem(a)
    case "authorize":
        let args = a["action_args"] as? [String: Any] ?? [:]
        let op = str(a["action_op"]) ?? ""
        let label = try MacFence.preview(args)
        return ["sensitive": MacFence.sensitive(op, args, label: label), "label": label]
    case "launch": return try macLaunch(a)
    case "move":
        guard let point = pair(a["point"]) else { throw AxonError("bad_point", "Move needs an observed point.") }
        return ["motion": try macMoveCursor(CGPoint(x: point[0], y: point[1]), a), "clicked": false]
    case "fit_window": return try macFitWindow(a)
    case "paste": return try macPaste(a)
    case "file_dialog": return try macFileDialog(a)
    case "open": return try macOpen(a)
    case "ping": return try opPing(a)
    case "presence": return try opPresence(a)
    case "session": return try opSession(a)
    case "list_apps": return try opListApps(a)
    case "snapshot": return try opSnapshot(a)
    case "click": return try opClick(a)
    case "drag": return try opDrag(a)
    case "type": return try opType(a)
    case "set_value": return try opSetValue(a)
    case "key": return try opKey(a)
    case "scroll": return try macScroll(a)
    case "focus": try macBringToFront(a); return ["focused": true]
    case "close_window": try MacFence.dispatched(); return try opCloseWindow(a)
    case "wait_for": return try opWaitFor(a)
    case "screenshot": return try opScreenshot(a)
    case "clipboard": return try opClipboard(a)
    case "describe": return try opDescribe(a)
    case "busy": return try opBusy(a)
    case "banner": return try opBanner(a)
    // Legacy low-level extension, not exposed by the shared direct tool schema.
    case "paste_files":
        throw AxonError("unsupported_on_macos",
            "'\(op)' is a Windows-only operation; the macOS host has no \(op).",
            "Use the shared file_dialog tool to choose files in an already-open native picker; do not substitute clipboard text for file URLs.")
    default: throw AxonError("unknown_op", "Unknown operation '\(op)'.", nil)
    }
}

func readLoop() {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }
        var reqId: Any = NSNull()
        do {
            guard let data = trimmed.data(using: .utf8),
                  let req = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            reqId = req["id"] ?? NSNull()
            let op = str(req["op"]) ?? ""
            let a = req["args"] as? [String: Any] ?? [:]

            if op == "shutdown" {
                guard MacInputLedger.recover() else { throw AxonError("input_cleanup_failed","Native input cleanup failed; shutdown was not acknowledged.") }
                emit(["id": reqId, "ok": true, "result": ["bye": true]])
                exit(0)
            }
            let started = Date()
            let result = try dispatch(op, a)
            guard MacInputLedger.recover() else { throw AxonError("input_cleanup_failed","Native input cleanup failed; inspect before continuing.") }
            emit(["id": reqId, "ok": true,
                  "ms": Int(Date().timeIntervalSince(started) * 1000),
                  "result": result])
        } catch let e as AxonError {
            let cleaned = MacInputLedger.recover()
            if !cleaned { MacFence.emergency("input_cleanup_failed") }
            var err: [String: Any] = ["code": !cleaned ? "input_cleanup_failed" : MacFence.didDispatch ? "input_outcome_unknown" : e.code, "message": e.message]
            if let h = e.hint { err["hint"] = h }
            emit(["id": reqId, "ok": false, "error": err])
        } catch {
            let cleaned = MacInputLedger.recover()
            if !cleaned { MacFence.emergency("input_cleanup_failed") }
            emit(["id": reqId, "ok": false,
                  "error": ["code": !cleaned ? "input_cleanup_failed" : MacFence.didDispatch ? "input_outcome_unknown" : "host_error", "message": String(describing: error)]])
        }
    }
    // stdin closed: the server is gone, and so is any reason to keep pumping
    // the event tap. Without this a warm-up run would never exit.
    if !MacInputLedger.recover() { MacFence.emergency("input_cleanup_failed") }
    exit(0)
}

// MARK: - Shared-runtime entry
@main enum MacHostMain {
    static func main() {
        do {
            let args = CommandLine.arguments
            if args.contains("--warmup") { emit(["event": "warm"]); return }
            if args.contains("--setup") { macSetup(); return }
            if args.contains("--contract-test") { try macContractTest(); return }
            // Offscreen pictures of the access prompt for review. No window is
            // shown, no permission is requested and no input is sent.
            if let at = args.firstIndex(of: "--glow-preview"), args.count > at + 1 {
                try? MacContract.load(); _ = NSApplication.shared
                let dir = args[at + 1]
                try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                var written: [String] = []
                for (name, size, background) in [("dark-window", CGSize(width: 640, height: 420), NSColor(white: 0.12, alpha: 1)),
                                                 ("light-window", CGSize(width: 640, height: 420), NSColor(white: 0.93, alpha: 1)),
                                                 ("small-window", CGSize(width: 220, height: 160), NSColor(white: 0.12, alpha: 1))] {
                    let path = (dir as NSString).appendingPathComponent("glow-\(name).png")
                    try MacWindowGlow.preview(window: size, to: path, background: background); written.append(path)
                }
                emit(["written": written, "desktop_input_sent": false]); return
            }
            // Lights one on-screen window for a few seconds and reports the
            // process's CPU share at rest. Shows light only; sends no input.
            if let at = args.firstIndex(of: "--glow-trial"), args.count > at + 1, let seconds = Double(args[at + 1]), seconds > 0, seconds <= 60 {
                try? MacContract.load(); _ = NSApplication.shared; NSApp.setActivationPolicy(.accessory)
                let mine = getpid()
                guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
                      let row = list.first(where: { ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 && ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value != mine
                          && (CGRect(dictionaryRepresentation: ($0[kCGWindowBounds as String] as? [String: Any] ?? [:]) as CFDictionary)?.width ?? 0) >= 200 }),
                      let id = (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                      let bounds = CGRect(dictionaryRepresentation: (row[kCGWindowBounds as String] as? [String: Any] ?? [:]) as CFDictionary) else {
                    throw AxonError("no_window", "No on-screen window to light.")
                }
                let glow = MacWindowGlow()
                if let level = args.firstIndex(of: "--level").flatMap({ args.count > $0 + 1 ? MacGlowLevel(rawValue: args[$0 + 1]) : nil }) { glow.level = level }
                glow.show(windowID: id, frame: MacWindowGlow.appKit(bounds), point: nil, pulse: false)
                let tick = Timer(timeInterval: 0.07, repeats: true) { _ in glow.follow() }
                RunLoop.main.add(tick, forMode: .common)
                func cpu() -> Double { var u = rusage(); getrusage(RUSAGE_SELF, &u)
                    return Double(u.ru_utime.tv_sec + u.ru_stime.tv_sec) + Double(u.ru_utime.tv_usec + u.ru_stime.tv_usec) / 1_000_000 }
                // The entrance runs in the render server at the display's rate;
                // only its in-process share is measured here.
                let enterCPU = cpu(), enterWall = Date()
                RunLoop.main.run(until: Date().addingTimeInterval(MacDesign.slow))
                let enterUsed = cpu() - enterCPU, enterSpan = Date().timeIntervalSince(enterWall)
                RunLoop.main.run(until: Date().addingTimeInterval(1.2))   // past the entrance
                glow.resetStats()
                let startCPU = cpu(), startWall = Date()
                RunLoop.main.run(until: Date().addingTimeInterval(seconds))
                let used = cpu() - startCPU, wall = Date().timeIntervalSince(startWall)
                let ticks = max(1, glow.tickCount)
                glow.hide(immediately: true); tick.invalidate()
                emit(["window_size": [bounds.width, bounds.height], "seconds": wall, "cpu_seconds": used,
                      "cpu_percent_of_one_core": wall > 0 ? used / wall * 100 : 0, "reduce_motion": MacDesign.reduceMotion,
                      "rest_frames": glow.tickCount, "rest_frame_interval_ms": glow.intervalSeconds / Double(ticks) * 1000,
                      "rest_frame_work_ms_mean": glow.tickSeconds / Double(ticks) * 1000, "rest_frame_work_ms_worst": glow.tickWorst * 1000,
                      "entrance_cpu_percent_of_one_core": enterSpan > 0 ? enterUsed / enterSpan * 100 : 0,
                      "level": glow.level.rawValue, "desktop_input_sent": false]); return
            }
            if let at = args.firstIndex(of: "--visual-preview"), args.count > at + 1 {
                try? MacContract.load(); _ = NSApplication.shared
                let dir = args[at + 1]
                var written = try MacBarBench.write(to: dir) + (try MacAccessPrompt.preview(to: dir))
                for (name, size, background, full) in [("dark-window", CGSize(width: 640, height: 420), NSColor(white: 0.12, alpha: 1), false),
                                                       ("light-window", CGSize(width: 640, height: 420), NSColor(white: 0.93, alpha: 1), false),
                                                       ("dark-full-screen", CGSize(width: 720, height: 450), NSColor(white: 0.12, alpha: 1), true),
                                                       ("light-full-screen", CGSize(width: 720, height: 450), NSColor(white: 0.93, alpha: 1), true)] {
                    for level in MacGlowLevel.allCases {
                        let path = (dir as NSString).appendingPathComponent("glow-\(name)-\(level.rawValue).png")
                        try MacWindowGlow.preview(window: size, to: path, background: background, level: level, fullScreen: full); written.append(path)
                    }
                }
                // The entrance: the narrow band it widens from, and full width.
                for (name, spread) in [("entrance-start", CGFloat(0.35)), ("entrance-end", CGFloat(1))] {
                    let path = (dir as NSString).appendingPathComponent("glow-\(name).png")
                    try MacWindowGlow.preview(window: CGSize(width: 640, height: 420), to: path, background: NSColor(white: 0.12, alpha: 1), spread: spread); written.append(path)
                }
                emit(["written": written, "desktop_input_sent": false]); return
            }
            if let at = args.firstIndex(of: "--prompt-preview"), args.count > at + 1 {
                try? MacContract.load(); _ = NSApplication.shared
                emit(["written": try MacAccessPrompt.preview(to: args[at + 1]), "desktop_input_sent": false]); return
            }
            if args.contains("--contract-lock-holder") {
                try MacFence.initialize(requireDirectParent: false)
                try MacInputLedger.withLock { emit(["lock_held": true]); _ = readLine() }
                return
            }
            if args.contains("--contract-cooperative-worker") {
                try MacFence.initialize(requireDirectParent: false)
                try macRegisterWorker(); MacWorkerLifetime.start(); MacWorkerLifetime.markActive()
                emit(["cooperative_ready": true]); RunLoop.current.run(); return
            }
            try MacFence.initialize(requireDirectParent: !args.contains("--mac-watchdog"))
            if args.contains("--release-inputs") { exit(MacInputLedger.recover() ? 0 : 1) }
            if let at = args.firstIndex(of: "--mac-watchdog"), args.count > at+2,
               let pid = pid_t(args[at+1]), pid == getppid(), try macProcessStart(pid) == args[at+2] {
                MacPanicMonitor().run(guardian: pid, birth: args[at+2])
            }
            if args.contains("--guardian") { try MacGuardian().run() }
            try macRegisterWorker()
            MacWorkerLifetime.start()
            defaultMode = "take"
            emit(["event": "ready", "pid": Int(getpid()), "platform": "darwin", "dpi_mode": "native",
                  "control_contract": 1, "native_fence": true, "held_input_cleanup": true, "hud_avoidance": true,
                  "accessibility": AXIsProcessTrusted()])
            Thread.detachNewThread { readLoop() }
            RunLoop.current.run()
        } catch {
            emit(["ev": "error", "message": String(describing: error)])
            exit(1)
        }
    }
}
