import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import Foundation
import ScreenCaptureKit
import Vision

struct MacWindowDisposition: Equatable {
    let minimized: Bool
    let hidden: Bool
    let fullscreen: Bool
    let otherDesktop: Bool
    let windowID: CGWindowID?
    let errorCode: String?
    let errorMessage: String?
}

func classifyMacWindowState(
    hasScreenCapturePermission: Bool,
    minimized: Bool,
    hidden: Bool,
    fullscreen: Bool,
    onCurrentSpace: Bool,
    onAnySpace: Bool,
    windowID: CGWindowID? = nil
) -> MacWindowDisposition {
    let isOtherDesktop = !minimized && !hidden && !fullscreen && !onCurrentSpace && onAnySpace
    if !hasScreenCapturePermission {
        return MacWindowDisposition(
            minimized: minimized, hidden: hidden, fullscreen: fullscreen, otherDesktop: isOtherDesktop, windowID: windowID,
            errorCode: "mac_permissions_required",
            errorMessage: "Screen Recording permission needs human setup in System Settings > Privacy & Security."
        )
    }
    if minimized {
        return MacWindowDisposition(
            minimized: true, hidden: hidden, fullscreen: fullscreen, otherDesktop: false, windowID: windowID,
            errorCode: "window_minimized",
            errorMessage: "The approved window is minimized. Focus it once to restore it on the current Space, then observe again."
        )
    }
    if hidden {
        return MacWindowDisposition(
            minimized: false, hidden: true, fullscreen: fullscreen, otherDesktop: false, windowID: windowID,
            errorCode: "window_hidden",
            errorMessage: "The approved application is hidden. Focus it once to unhide it on the current Space, then observe again."
        )
    }
    if fullscreen {
        return MacWindowDisposition(
            minimized: false, hidden: false, fullscreen: true, otherDesktop: !onCurrentSpace, windowID: windowID,
            errorCode: "window_fullscreen",
            errorMessage: "The approved window is in macOS full-screen mode (a separate full-screen Space). Exit full-screen mode yourself to return the window to the normal Space, then observe again; no Space was switched."
        )
    }
    if isOtherDesktop {
        return MacWindowDisposition(
            minimized: false, hidden: false, fullscreen: false, otherDesktop: true, windowID: windowID,
            errorCode: "other_desktop",
            errorMessage: "The approved window is on another macOS Mission Control Space. Move it to the current Space yourself, then observe again; no Space was switched."
        )
    }
    if !onCurrentSpace {
        return MacWindowDisposition(
            minimized: false, hidden: false, fullscreen: false, otherDesktop: false, windowID: windowID,
            errorCode: "window_capture_unavailable",
            errorMessage: "The approved window is not unambiguously available on the current Space. No desktop fallback was captured."
        )
    }
    return MacWindowDisposition(
        minimized: false, hidden: false, fullscreen: false, otherDesktop: false, windowID: windowID,
        errorCode: nil,
        errorMessage: nil
    )
}

func macInspectWindowState(
    window: AXUIElement,
    pid: pid_t,
    title: String,
    rect: [Int]?,
    app: NSRunningApplication? = nil,
    hasScreenCapturePermission: Bool = CGPreflightScreenCaptureAccess()
) -> MacWindowDisposition {
    let runningApp = app ?? NSRunningApplication(processIdentifier: pid)
    let minimized = axBool(window, kAXMinimizedAttribute as String) ?? false
    let hidden = runningApp?.isHidden ?? (axBool(AXUIElementCreateApplication(pid), kAXHiddenAttribute as String) ?? false)
    let fullscreen = (axBool(window, "AXFullScreen") ?? false) || (axString(window, kAXSubroleAttribute as String) == "AXFullScreenWindow")
    let onScreenID = windowNumber(window: window, pid: pid, title: title, rect: rect, onScreenOnly: true)
    let anySpaceID = onScreenID ?? windowNumber(window: window, pid: pid, title: title, rect: rect, onScreenOnly: false)
    let axDirectID = axWindowID(window)
    let onAny = anySpaceID != nil || (axDirectID != 0 && rect != nil)
    return classifyMacWindowState(
        hasScreenCapturePermission: hasScreenCapturePermission,
        minimized: minimized,
        hidden: hidden,
        fullscreen: fullscreen,
        onCurrentSpace: onScreenID != nil,
        onAnySpace: onAny,
        windowID: onScreenID ?? anySpaceID ?? (axDirectID != 0 ? axDirectID : nil)
    )
}

func macWindowIdentity(_ args: [String: Any]) throws -> [String: Any] {
    let (window, pid, title, handle) = try resolveWindow(args)
    var result = try macIdentity(pid)
    guard let rect = axRect(window) else { throw AxonError("window_rect_failed", "Window geometry is unavailable.") }
    let state = macInspectWindowState(window: window, pid: pid, title: title, rect: rect)
    result.merge([
        "hwnd": handle,
        "title": title,
        "rect": rect,
        "root": handle,
        "owner": 0,
        "class": axString(window, kAXRoleAttribute as String) ?? "AXWindow",
        "visible": !state.minimized && !state.hidden && !state.otherDesktop,
        "overlay": false,
        "minimized": state.minimized,
        "hidden": state.hidden,
        "fullscreen": state.fullscreen,
        "other_desktop": state.otherDesktop,
    ]) { _, new in new }
    return result
}

func macDisplayRects() -> [CGRect] {
    var displays = [CGDirectDisplayID](repeating: 0, count: 32); var count: UInt32 = 0
    guard CGGetActiveDisplayList(32, &displays, &count) == .success else { return [] }
    return displays.prefix(Int(count)).map { CGDisplayBounds($0) }
}
func macCheckPoint(_ point: CGPoint) throws {
    guard point.x.isFinite, point.y.isFinite, macDisplayRects().contains(where: { $0.contains(point) }) else {
        throw AxonError("point_off_desktop", "Point is outside the active displays. No input was sent.")
    }
}
func macCheckTargetPoint(_ point: CGPoint, _ args: [String: Any]) throws {
    try macCheckPoint(point)
    let (window, pid, title, _) = try resolveWindow(args)
    guard let rect = axRect(window), CGRect(x: rect[0], y: rect[1], width: rect[2], height: rect[3]).contains(point) else {
        throw AxonError("bad_point", "Point is outside the approved window.")
    }
    guard let expected = windowNumber(window: window, pid: pid, title: title, rect: rect),
          let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { throw AxonError("obscured", "The target point cannot be verified.") }
    let guardianRecord = (try? String(contentsOfFile: MacFence.file + ".guardian", encoding: .utf8).split(separator:"|")) ?? []
    let guardian = guardianRecord.count == 2 ? Int32(guardianRecord[0]) : nil
    let guardianAlive = guardian != nil && (try? macProcessStart(guardian!)) == String(guardianRecord.last ?? "")
    for candidate in windows {
        let owner = (candidate[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? -1
        if guardianAlive && owner == guardian { continue } // only this runtime's native click-through chrome
        let ownerName = candidate[kCGWindowOwnerName as String] as? String ?? ""
        if ownerName == "Dock" || ownerName == "Window Server" { continue }
        let layer = (candidate[kCGWindowLayer as String] as? NSNumber)?.int32Value ?? 0
        if owner == pid && layer > 0 { continue } // same-app context menu, popup, or popover layer
        guard (candidate[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0 > 0,
              let bounds = candidate[kCGWindowBounds as String] as? [String:Any],
              let boundsRect = CGRect(dictionaryRepresentation: bounds as CFDictionary), boundsRect.contains(point) else { continue }
        guard (candidate[kCGWindowNumber as String] as? NSNumber)?.uint32Value == expected else {
            throw AxonError("obscured", "Another window covers this point. No click was sent.")
        }
        return
    }
    throw AxonError("obscured", "The target point has no verifiable owning window.")
}

func macBringToFront(_ args: [String: Any]) throws {
    let (window, pid, title, _) = try resolveWindow(args)
    let state = macInspectWindowState(window: window, pid: pid, title: title, rect: axRect(window))
    if state.fullscreen {
        throw AxonError("window_fullscreen", state.errorMessage ?? "The approved window is in macOS full-screen mode. Exit full-screen mode yourself; no Space was switched.")
    }
    if state.otherDesktop {
        throw AxonError("other_desktop", state.errorMessage ?? "Bring the approved window onto the current Space yourself. No Space was switched.")
    }
    let app = NSRunningApplication(processIdentifier: pid)
    let needsRestore = state.minimized || state.hidden
    let needsFront = NSWorkspace.shared.frontmostApplication?.processIdentifier != pid || axBool(window, kAXMainAttribute as String) != true
    if needsRestore || needsFront {
        try MacFence.dispatched()
        if state.hidden { _ = app?.unhide() }
        if state.minimized { _ = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse) }
        guard app?.activate(options: []) == true else {
            throw AxonError("input_outcome_unknown", "Window activation was not confirmed. Observe before continuing.")
        }
        _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
        _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        let deadline = Date().addingTimeInterval(0.35)
        while Date() < deadline {
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
               axBool(window, kAXMinimizedAttribute as String) != true,
               app?.isHidden != true {
                break
            }
            Thread.sleep(forTimeInterval: 0.03)
        }
    }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { throw AxonError("focus_changed", "The approved app did not become foreground.") }
    guard windowNumber(window: window, pid: pid, title: title, rect: axRect(window), onScreenOnly: true) != nil else {
        throw AxonError("other_desktop", "The approved window is not on the current Space after activation. Move it to the current Space yourself; no Space was switched.")
    }
}

func macRole(_ role: String) -> String {
    return ["AXWindow":"Window", "AXSheet":"Window", "AXDialog":"Window", "AXButton":"Button", "AXTextField":"Edit",
            "AXTextArea":"Edit", "AXSearchField":"Edit", "AXCheckBox":"CheckBox", "AXRadioButton":"RadioButton",
            "AXPopUpButton":"ComboBox", "AXComboBox":"ComboBox", "AXStaticText":"Text", "AXGroup":"Group",
            "AXWebArea":"Document", "AXScrollArea":"Pane", "AXSplitGroup":"Pane", "AXMenu":"Menu",
            "AXMenuItem":"MenuItem", "AXSlider":"Slider", "AXValueIndicator":"Slider", "AXProgressIndicator":"ProgressBar",
            "AXLink":"Hyperlink", "AXTabGroup":"Tab", "AXTab":"TabItem", "AXList":"List", "AXOutline":"Tree",
            "AXRow":"ListItem", "AXCell":"DataItem", "AXTable":"Table", "AXImage":"Image", "AXToolbar":"ToolBar",
            "AXHeading":"HeaderItem", "AXScrollBar":"ScrollBar"][role] ?? role
}

func macOpen(_ args: [String: Any]) throws -> [String: Any] {
    let path = str(args["path"]) ?? ""
    guard path.hasPrefix("/"), !path.contains("\0"), URL(fileURLWithPath: path).pathExtension != "app" else {
        throw AxonError("invalid_path", "Use an absolute local document path; use launch for applications.")
    }
    try MacFence.dispatched()
    guard NSWorkspace.shared.open(URL(fileURLWithPath: path)) else { throw AxonError("input_outcome_unknown", "Document opening was submitted but not confirmed.") }
    return ["opened": path, "refresh_apps": true]
}

func macSetup() {
    _ = NSApplication.shared; NSApp.setActivationPolicy(.accessory)
    let alert = NSAlert(); alert.messageText = "Set up Antigravity Computer Use"
    alert.informativeText = "macOS requires your approval for Accessibility, Screen Recording and Input Monitoring. These permissions let the native helper observe and operate your desktop and stop on Esc. Approvals must be completed by you in macOS. This setup sends no clicks or keystrokes."
    alert.addButton(withTitle: "Request Mac Permissions"); alert.addButton(withTitle: "Cancel")
    if alert.runModal() == .alertFirstButtonReturn {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        _ = CGRequestScreenCaptureAccess(); _ = CGRequestListenEventAccess(); _ = CGRequestPostEventAccess()
    }
    emit(["accessibility": AXIsProcessTrusted(), "screen_capture": CGPreflightScreenCaptureAccess(),
          "input_monitoring": CGPreflightListenEventAccess(), "input_posting": CGPreflightPostEventAccess()])
}

func macContractTest() throws {
    try MacContract.load()
    guard macStopNonceValid(String(repeating:"a",count:32)),
          !macStopNonceValid(String(repeating:"a",count:32)+"\n"),
          !macStopNonceValid(String(repeating:"a",count:31)),
          !macStopNonceValid(String(repeating:"G",count:32)) else {
        throw AxonError("contract_test_failed", "Stop acknowledgement nonce validation differs.")
    }
    let oldText = "old" as CFString, newText = "new" as CFString
    let zero = NSNumber(value: 0), one = NSNumber(value: 1)
    guard axValueDisposition(oldText, newText, newText) == "exact",
          axValueDisposition(oldText, oldText, newText) == nil,
          axValueDisposition(oldText, nil, newText) == nil,
          axValueDisposition(zero, one, one) == "exact" else {
        throw AxonError("contract_test_failed", "Value read-back classification differs.")
    }
    let token = "native-contract-test", grant = "123:birth:/app"
    guard MacFence.resolvedState("idle", latched: true) == "stopped",
          MacFence.resolvedState("active", latched: true) == "stopped",
          MacFence.resolvedState("idle", latched: false) == "idle" else {
        throw AxonError("contract_test_failed", "Latched Stop was lost during state resolution.")
    }
    guard macWindowTitleMatches(axTitle: "AGCU Test Page - Google Chrome - Profile 1", cgName: "AGCU Test Page"),
          macWindowTitleMatches(axTitle: "Document — Edited", cgName: "Document"),
          !macWindowTitleMatches(axTitle: "Window Alpha", cgName: "Window Beta") else {
        throw AxonError("contract_test_failed", "Browser/document window title matching differs.")
    }
    let twinList: [[String: Any]] = [
        [
            kCGWindowNumber as String: NSNumber(value: 1001),
            kCGWindowOwnerPID as String: NSNumber(value: 777),
            kCGWindowLayer as String: NSNumber(value: 0),
            kCGWindowName as String: "Report Draft",
            kCGWindowBounds as String: ["X": NSNumber(value: 10), "Y": NSNumber(value: 20), "Width": NSNumber(value: 800), "Height": NSNumber(value: 600)],
        ],
        [
            kCGWindowNumber as String: NSNumber(value: 1002),
            kCGWindowOwnerPID as String: NSNumber(value: 777),
            kCGWindowLayer as String: NSNumber(value: 0),
            kCGWindowName as String: "Report Draft",
            kCGWindowBounds as String: ["X": NSNumber(value: 10), "Y": NSNumber(value: 20), "Width": NSNumber(value: 800), "Height": NSNumber(value: 600)],
        ],
    ]
    guard matchCGWindow(list: twinList, pid: 777, title: "Report Draft - Google Chrome - Profile", rect: [10, 20, 800, 600], directWindowID: 1002) == 1002,
          matchCGWindow(list: twinList, pid: 777, title: "Report Draft", rect: [10, 20, 800, 600], directWindowID: 0) == nil,
          matchCGWindow(list: [twinList[0]], pid: 777, title: "Report Draft - Google Chrome - Profile", rect: [10, 20, 800, 600], directWindowID: 0) == 1001 else {
        throw AxonError("contract_test_failed", "Direct CGWindowID or browser-title disambiguation differs.")
    }
    guard classifyMacWindowState(hasScreenCapturePermission: false, minimized: false, hidden: false, fullscreen: false, onCurrentSpace: true, onAnySpace: true).errorCode == "mac_permissions_required",
          classifyMacWindowState(hasScreenCapturePermission: true, minimized: true, hidden: false, fullscreen: false, onCurrentSpace: false, onAnySpace: true).errorCode == "window_minimized",
          classifyMacWindowState(hasScreenCapturePermission: true, minimized: false, hidden: true, fullscreen: false, onCurrentSpace: false, onAnySpace: true).errorCode == "window_hidden",
          classifyMacWindowState(hasScreenCapturePermission: true, minimized: false, hidden: false, fullscreen: true, onCurrentSpace: false, onAnySpace: true).errorCode == "window_fullscreen",
          classifyMacWindowState(hasScreenCapturePermission: true, minimized: false, hidden: false, fullscreen: false, onCurrentSpace: false, onAnySpace: true).errorCode == "other_desktop",
          classifyMacWindowState(hasScreenCapturePermission: true, minimized: false, hidden: false, fullscreen: false, onCurrentSpace: false, onAnySpace: false).errorCode == "window_capture_unavailable",
          classifyMacWindowState(hasScreenCapturePermission: true, minimized: false, hidden: false, fullscreen: false, onCurrentSpace: true, onAnySpace: true).errorCode == nil else {
        throw AxonError("contract_test_failed", "macOS Space and window capture failure classification differs.")
    }
    let activeHud = MacVisuals.statePresentation(for: "active", latched: false)
    let pausedHud = MacVisuals.statePresentation(for: "paused", latched: false)
    let stoppedHud = MacVisuals.statePresentation(for: "stopped", latched: false)
    let latchedHud = MacVisuals.statePresentation(for: "active", latched: true)
    guard activeHud.title.contains("Working"), !activeHud.isEmergency,
          pausedHud.title.contains("Paused"), !pausedHud.isEmergency,
          stoppedHud.title == "Stopped · Re-arm required", stoppedHud.isEmergency, stoppedHud.minimumContrast >= 8.5,
          latchedHud.resolvedState == "stopped", latchedHud.title == "Stopped · Re-arm required", latchedHud.isEmergency else {
        throw AxonError("contract_test_failed", "Mac HUD state presentation or emergency contrast contract differs.")
    }
    guard macRole("AXWebArea") == "Document",
          macRole("AXLink") == "Hyperlink",
          macRole("AXTextArea") == "Edit",
          macPatterns(role: "AXButton", actions: ["AXPress"], hasNameOrId: false).contains("Invoke"),
          macPatterns(role: "AXTextArea", actions: [], hasNameOrId: true).contains("Value"),
          !macPatterns(role: "AXGroup", actions: ["AXPress"], hasNameOrId: false).contains("Invoke") else {
        throw AxonError("contract_test_failed", "macOS web/accessibility role and pattern mapping differs.")
    }
    let latchProbe = MacFence.file + ".latch-probe-" + UUID().uuidString
    defer { try? FileManager.default.removeItem(atPath: latchProbe) }
    guard MacFence.latchBlocks(""), !MacFence.latchBlocks(latchProbe) else { throw AxonError("contract_test_failed", "Missing latch classification differs.") }
    try Data("x".utf8).write(to:URL(fileURLWithPath:latchProbe));
    guard MacFence.latchBlocks(latchProbe + "/child") else { throw AxonError("contract_test_failed", "Unreadable latch was treated as absent.") }
    try FileManager.default.removeItem(atPath:latchProbe)
    guard symlink(latchProbe + ".missing", latchProbe) == 0 else { throw AxonError("contract_test_failed", "Cannot create latch-link fixture.") }
    guard MacFence.latchBlocks(latchProbe) else { throw AxonError("contract_test_failed", "Dangling latch link was treated as absent.") }
    guard unlink(latchProbe) == 0 else { throw AxonError("contract_test_failed", "Cannot remove latch-link fixture.") }
    guard MacFence.latchStop(latchProbe), try String(contentsOfFile:latchProbe,encoding:.utf8) == "stopped" else {
        throw AxonError("contract_test_failed", "Native Stop marker creation failed.")
    }
    try Data("unconfirmed:native-regression".utf8).write(to:URL(fileURLWithPath:latchProbe))
    guard MacFence.latchStop(latchProbe), MacFence.latchStop(latchProbe),
          try String(contentsOfFile:latchProbe,encoding:.utf8) == "unconfirmed:native-regression" else {
        throw AxonError("contract_test_failed", "Native Stop downgraded uncertain delivery.")
    }
    guard unlink(latchProbe) == 0, symlink(latchProbe + ".missing", latchProbe) == 0,
          MacFence.latchStop(latchProbe), MacFence.latchBlocks(latchProbe),
          unlink(latchProbe) == 0 else {
        throw AxonError("contract_test_failed", "Native Stop replaced or followed a latch link.")
    }
    try Data("unconfirmed:companion".utf8).write(to:URL(fileURLWithPath:latchProbe + ".unconfirmed"))
    guard MacFence.latchBlocks(latchProbe), unlink(latchProbe + ".unconfirmed") == 0 else {
        throw AxonError("contract_test_failed", "Native Stop ignored a companion-only fence.")
    }
    guard !MacDeadline.walkBudgetExceeded(start: 100, now: 200, budgetMs: 100),
          MacDeadline.walkBudgetExceeded(start: 100, now: 201, budgetMs: 100),
          MacDeadline.walkBudgetExceeded(start: 100, now: 0, budgetMs: 100),
          MacDeadline.walkBudgetExceeded(start: 100, now: 99, budgetMs: 100),
          MacDeadline.walkBudgetExceeded(start: 0, now: 100, budgetMs: 100),
          MacDeadline.walkBudgetExceeded(start: 100, now: 100, budgetMs: -1) else {
        throw AxonError("native_contract_mismatch", "Snapshot walk budget did not fail closed.")
    }
    let bounded = MacDeadline.create(requested: 100_000_000, wallNow: 0, bootNow: 1000, maximumMs: 500)
    guard bounded == 1500, MacDeadline.valid(bounded, now: 1499), !MacDeadline.valid(bounded, now: 1500),
          !MacDeadline.valid(bounded, now: 0),
          MacDeadline.create(requested: 100_000_000, wallNow: 0, bootNow: 0, maximumMs: 500) == 0,
          MacDeadline.create(requested: 100, wallNow: 100, bootNow: 10, maximumMs: 500) == 0,
          MacDeadline.create(requested: 100_000_000, wallNow: 0, bootNow: UInt64.max - 1, maximumMs: 500) == 0 else {
        throw AxonError("contract_test_failed", "Monotonic deadline arithmetic differs.")
    }
    guard !MacPanicMonitor.deadlineGraceElapsed(since: 100, now: 5099),
          MacPanicMonitor.deadlineGraceElapsed(since: 100, now: 5100),
          !MacPanicMonitor.deadlineGraceElapsed(since: 100, now: 99) else {
        throw AxonError("contract_test_failed", "Watchdog expiry grace differs.")
    }
    let pendingCleanup = try MacFenceState("idle||0||0|1"), cleanIdle = try MacFenceState("idle||0||0|0")
    guard pendingCleanup.cleanupPending, !cleanIdle.cleanupPending,
          MacPanicMonitor.deadlineProblem(pendingCleanup, now: 100) == "cleanup",
          MacPanicMonitor.deadlineProblem(cleanIdle, now: 100) == nil else {
        throw AxonError("contract_test_failed", "Cleanup acknowledgement classification differs.")
    }
    do { _ = try MacFenceState("idle||0||0|invalid"); throw AxonError("contract_test_failed", "Malformed cleanup state accepted.") }
    catch let error as AxonError { if error.code == "contract_test_failed" { throw error } }
    let readyPipe = Pipe()
    DispatchQueue.global().async {
        readyPipe.fileHandleForWriting.write(Data("{\"watchdog_".utf8))
        Thread.sleep(forTimeInterval: 0.02)
        readyPipe.fileHandleForWriting.write(Data("ready\":true}\n".utf8))
        try? readyPipe.fileHandleForWriting.close()
    }
    guard MacWorkers.readReadyLine(readyPipe.fileHandleForReading) == "{\"watchdog_ready\":true}" else {
        throw AxonError("contract_test_failed", "Fragmented watchdog readiness was not reassembled.")
    }
    guard MacWorkers.readyAcknowledged("{\"watchdog_ready\":true}"),
          !MacWorkers.readyAcknowledged("{\"watchdog_ready\":false}"),
          !MacWorkers.readyAcknowledged("{\"watchdog_ready\":1}"),
          !MacWorkers.readyAcknowledged("{\"message\":\"watchdog_ready\"}"),
          !MacWorkers.readyAcknowledged("not-json") else {
        throw AxonError("contract_test_failed", "Invalid watchdog readiness was accepted.")
    }
    let oversizedReady = Pipe()
    DispatchQueue.global().async {
        oversizedReady.fileHandleForWriting.write(Data(repeating: 65, count: 8193))
        try? oversizedReady.fileHandleForWriting.close()
    }
    guard MacWorkers.readReadyLine(oversizedReady.fileHandleForReading) == nil else {
        throw AxonError("contract_test_failed", "Oversized watchdog readiness was accepted.")
    }
    let text = "active|\(token)|\(MacFenceState.now + 10_000_000)|\(Data(grant.utf8).base64EncodedString())|\(MacDeadline.now + 1000)"
    let state = try MacFenceState(text)
    guard state.state == "active", state.token == token, state.grants.contains(grant), state.until > MacFenceState.now else {
        throw AxonError("contract_test_failed", "Shared state decoding differs.")
    }
    do { _ = try MacFenceState("active|broken|NaN|"); throw AxonError("contract_test_failed", "Malformed state accepted.") }
    catch let error as AxonError { if error.code == "contract_test_failed" { throw error } }
    for invalid in ["active|fixture|999|", "active|fixture|999||0", "active|fixture|999||invalid"] {
        do { _ = try MacFenceState(invalid); throw AxonError("contract_test_failed", "Unbounded active state accepted.") }
        catch let error as AxonError { if error.code == "contract_test_failed" { throw error } }
    }
    let a = try macFingerprint("click", ["index": 1, "__session": "one"], "Button")
    let b = try macFingerprint("click", ["__session": "two", "index": 1], "Button")
    let c = try macFingerprint("click", ["index": 2], "Button")
    guard a == b, a != c, MacFence.sensitive("click", ["__risk":"routine"], label: "Delete file"),
          MacFence.sensitive("click", ["__risk":"routine"], label: "de\u{200D}lete file"),
          MacFence.sensitive("click", ["__risk":"routine"], label: "  \u{200D}"),
          MacFence.sensitive("drag", ["__risk":"routine"], label: ""),
          !MacFence.sensitive("move", ["__risk":"routine"], label: ""),
          !MacFence.sensitive("click", ["__risk":"routine"], label: "Open settings Button"),
          try macProcessStart(getpid()) == macProcessStart(getpid()) else { throw AxonError("contract_test_failed", "Approval fingerprint or classification differs.") }
    // Exercise the actual native fence in isolated project-local storage.
    // Refusals only: no fake live permission, application grant or input event.
    try MacFence.initialize()
    MacFence.current = ["__session": token]
    let live = "active|\(token)|\(MacFenceState.now + 10_000_000)||\(MacDeadline.now + 1000)"
    func refused(_ state: String, _ description: String) throws {
        try MacFence.write(state)
        do { try MacFence.check(); throw AxonError("contract_test_failed", "Fence accepted \(description).") }
        catch let error as AxonError { if error.code != "control_stopped" { throw error } }
    }
    for mode in ["idle", "paused", "stopped"] { try refused("\(mode)|\(token)|\(MacFenceState.now + 10_000_000)|", mode) }
    try refused("active|\(token)|1|", "expired control")
    try refused("active|another-session|\(MacFenceState.now + 10_000_000)|", "wrong session")
    try refused(live, "missing independent Stop monitor")
    try Data("stopped".utf8).write(to: URL(fileURLWithPath: MacFence.latch))
    defer { try? FileManager.default.removeItem(atPath: MacFence.latch); try? MacFence.write("idle||0|") }
    try refused(live, "latched emergency Stop")
    if !FileManager.default.fileExists(atPath: MacInputLedger.path) {
        guard !MacInputLedger.recover() else { throw AxonError("contract_test_failed","Missing input journal was accepted.") }
    }
    try MacInputLedger.save(["keys":[Int](),"buttons":[Int]()])
    guard MacInputLedger.recover() else { throw AxonError("contract_test_failed","Empty input cleanup failed.") }
    try MacInputLedger.save(["keys":[42],"buttons":[0]])
    guard !MacInputLedger.recover(location: { nil }),
          let retainedKeys = try MacInputLedger.read()["keys"] as? [Int], retainedKeys == [42],
          let retainedButtons = try MacInputLedger.read()["buttons"] as? [Int], retainedButtons == [0] else {
        throw AxonError("contract_test_failed", "Missing cursor location did not retain the complete input journal.")
    }
    try MacInputLedger.save(["keys":[Int](),"buttons":[Int]()])
    // Only test denial when the OS really reports it; do not synthesize
    // permission or post desktop events from a headless qualification run.
    if !CGPreflightPostEventAccess() {
        try MacInputLedger.save(["keys":[Int](),"buttons":[0]])
        guard !MacInputLedger.recover(), let buttons = try MacInputLedger.read()["buttons"] as? [Int], buttons == [0] else {
            throw AxonError("contract_test_failed","Denied cleanup lost the held-button journal.")
        }
        try MacInputLedger.save(["keys":[Int](),"buttons":[Int]()])
    }
    try MacInputLedger.withLock {
        guard !MacInputLedger.recover() else { throw AxonError("contract_test_failed","Concurrent input cleanup bypassed the held lock.") }
    }
    guard MacInputLedger.recover() else { throw AxonError("contract_test_failed","Input lock was not released.") }
    // Exercise the kernel lock across actual native processes, including owner
    // death. The child posts no desktop events and holds the lock until killed.
    let holder = Process(), output = Pipe(), input = Pipe()
    holder.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    holder.arguments = ["--contract-lock-holder"]
    holder.environment = ProcessInfo.processInfo.environment
    holder.standardOutput = output; holder.standardInput = input; holder.standardError = FileHandle.standardError
    try holder.run()
    defer { if holder.isRunning { holder.terminate(); holder.waitUntilExit() } }
    let ready = DispatchSemaphore(value: 0); var message: String?
    DispatchQueue.global().async { message = String(data: output.fileHandleForReading.availableData, encoding: .utf8); ready.signal() }
    guard ready.wait(timeout: .now() + 5) == .success, message?.contains("lock_held") == true else {
        throw AxonError("contract_test_failed", "Native input-lock holder did not start.")
    }
    guard !MacInputLedger.recover() else { throw AxonError("contract_test_failed", "Cleanup overlapped another process's input lock.") }
    guard MacWorkers.terminateBeforeRetry(holder, expectedBirth: try macProcessStart(holder.processIdentifier)) else { throw AxonError("contract_test_failed", "Lock-holder exit was not confirmed.") }
    guard MacInputLedger.recover() else { throw AxonError("contract_test_failed", "Cleanup did not recover after lock-owner death.") }
    // The guardian's worker registry must also confirm a real child has exited
    // before it can acknowledge cleanup. No desktop event is posted here.
    let worker = Process(), workerOutput = Pipe(), workerInput = Pipe()
    worker.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    worker.arguments = ["--contract-lock-holder"]; worker.environment = ProcessInfo.processInfo.environment
    worker.standardOutput = workerOutput; worker.standardInput = workerInput; worker.standardError = FileHandle.standardError
    try worker.run()
    let workerMarker = MacFence.file + ".worker-\(worker.processIdentifier)"
    defer { if worker.isRunning { worker.terminate(); worker.waitUntilExit() }; try? FileManager.default.removeItem(atPath: workerMarker) }
    let workerReady = DispatchSemaphore(value: 0); var workerMessage: String?
    DispatchQueue.global().async { workerMessage = String(data: workerOutput.fileHandleForReading.availableData, encoding: .utf8); workerReady.signal() }
    guard workerReady.wait(timeout: .now() + 5) == .success, workerMessage?.contains("lock_held") == true else { throw AxonError("contract_test_failed", "Worker fixture did not start.") }
    let workerBirth = try macProcessStart(worker.processIdentifier)
    try Data("0.0".utf8).write(to: URL(fileURLWithPath: workerMarker), options: [.atomic]); chmod(workerMarker, 0o600)
    guard macWaitForWorkers(), worker.isRunning else { throw AxonError("contract_test_failed", "A reused PID was killed.") }
    try Data(workerBirth.utf8).write(to: URL(fileURLWithPath: workerMarker), options: [.atomic])
    guard chmod(workerMarker, 0o600) == 0, !macWaitForWorkers(), worker.isRunning else { throw AxonError("contract_test_failed", "An unresponsive worker was treated as exited or signalled.") }
    guard MacWorkers.terminateBeforeRetry(worker, expectedBirth: workerBirth) else { throw AxonError("contract_test_failed", "Fixture termination was not confirmed.") }
    try FileManager.default.removeItem(atPath: workerMarker)
    guard MacInputLedger.recover() else { throw AxonError("contract_test_failed", "Cleanup failed after confirmed worker exit.") }
    try FileManager.default.removeItem(atPath: MacFence.latch)
    try MacFence.write("active|fixture|\(MacFenceState.now + 100_000_000)||\(MacDeadline.now + 10_000)|0")
    let cooperative = Process(), cooperativeOutput = Pipe()
    cooperative.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    cooperative.arguments = ["--contract-cooperative-worker"]; cooperative.environment = ProcessInfo.processInfo.environment
    cooperative.standardOutput = cooperativeOutput; cooperative.standardError = FileHandle.standardError
    try cooperative.run()
    let cooperativeMarker = MacFence.file + ".worker-\(cooperative.processIdentifier)"
    defer { if cooperative.isRunning { cooperative.terminate(); cooperative.waitUntilExit() }; try? FileManager.default.removeItem(atPath: cooperativeMarker) }
    let cooperativeReady = DispatchSemaphore(value: 0); var cooperativeMessage: String?
    DispatchQueue.global().async { cooperativeMessage = String(data: cooperativeOutput.fileHandleForReading.availableData, encoding: .utf8); cooperativeReady.signal() }
    guard cooperativeReady.wait(timeout: .now() + 5) == .success, cooperativeMessage?.contains("cooperative_ready") == true else { throw AxonError("contract_test_failed", "Cooperative worker did not start.") }
    try Data("stopped".utf8).write(to: URL(fileURLWithPath: MacFence.latch), options: [.atomic])
    try MacFence.write("stopped||0||0|1")
    guard macWaitForWorkers() else { throw AxonError("contract_test_failed", "Cooperative worker did not exit after Stop.") }
    cooperative.waitUntilExit(); try FileManager.default.removeItem(atPath: cooperativeMarker)
    let invalidWorker = MacFence.file + ".worker-invalid"
    try Data("invalid".utf8).write(to: URL(fileURLWithPath: invalidWorker), options: [.atomic]); chmod(invalidWorker, 0o600)
    defer { try? FileManager.default.removeItem(atPath: invalidWorker) }
    guard !macWaitForWorkers() else { throw AxonError("contract_test_failed", "Malformed worker registry was accepted.") }
    try FileManager.default.removeItem(atPath: invalidWorker)
    // Replacing the private root while its original inode is locked must not
    // let a contender acquire a different directory lock and claim cleanup.
    let root = URL(fileURLWithPath: MacFence.file).deletingLastPathComponent().path
    let backup = root + ".contract-backup"
    try MacInputLedger.withLock {
        guard rename(root, backup) == 0 else { throw AxonError("contract_test_failed", "Cannot move lock directory fixture.") }
        var replaced = false
        defer {
            if replaced { _ = rmdir(root) }
            _ = rename(backup, root)
        }
        guard mkdir(root, 0o700) == 0 else { throw AxonError("contract_test_failed", "Cannot replace lock directory fixture.") }
        replaced = true
        guard !MacInputLedger.recover() else { throw AxonError("contract_test_failed", "Cleanup accepted a replaced lock directory.") }
    }
    guard MacInputLedger.recover() else { throw AxonError("contract_test_failed", "Restored lock directory is unavailable.") }
    try Data("invalid journal".utf8).write(to:URL(fileURLWithPath:MacInputLedger.path))
    guard !MacInputLedger.recover() else { throw AxonError("contract_test_failed","Malformed input journal was accepted.") }
    try MacInputLedger.save(["keys":[Int](),"buttons":[Int]()])
    emit(["ok": true, "control_contract": 1, "checks": ["shared state codec", "malformed state refusal", "canonical approval fingerprint", "sensitive action classification", "kernel process birth identity", "native idle/paused/stopped/expired/session/monitor/Stop refusals", "empty cleanup and malformed input-journal refusal"], "desktop_input_sent": false])
}

func macMoveCursor(_ point: CGPoint, _ args: [String: Any]) throws -> [String: Any] {
    try macCheckTargetPoint(point, args)
    let from = CGEvent(source: nil)?.location ?? point
    let distance = hypot(point.x - from.x, point.y - from.y)
    let duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || distance < 3 ? 0 : max(120, min(600, 100 + 10 * sqrt(distance)))
    let start = ProcessInfo.processInfo.systemUptime; var frames = 0
    while duration > 0 && (ProcessInfo.processInfo.systemUptime - start) * 1000 < duration {
        try MacFence.check()
        let t = min(1, (ProcessInfo.processInfo.systemUptime - start) * 1000 / duration)
        let eased = t*t*t*(10+t*(-15+6*t))
        let p = CGPoint(x: from.x + (point.x-from.x)*eased, y: from.y + (point.y-from.y)*eased)
        // Travel may cross display gaps without emitting input there. The end
        // point and every button transition still require exact display/window ownership.
        if !macDisplayRects().contains(where: { $0.contains(p) }) { Thread.sleep(forTimeInterval: 0.016); continue }
        try post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
        frames += 1; Thread.sleep(forTimeInterval: 0.016)
    }
    try macCheckTargetPoint(point, args)
    try post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left))
    return ["frames": frames + 1, "duration_ms": Int(duration), "animated": duration > 0]
}

func macScroll(_ args: [String:Any]) throws -> [String:Any] {
    try macBringToFront(args)
    let point: CGPoint
    if let pixels = pair(args["point"]) { point = CGPoint(x:pixels[0],y:pixels[1]) }
    else {
        let (element, _) = try snapshotElement(args)
        if bool(args["into_view"],false) {
            guard axActions(element).contains("AXScrollToVisible") else { throw AxonError("unsupported_action","This control has no ScrollToVisible accessibility action.") }
            try MacFence.dispatched()
            guard AXUIElementPerformAction(element,"AXScrollToVisible" as CFString) == .success else { throw AxonError("input_outcome_unknown","The provider did not confirm scrolling. Observe before continuing.") }
            return ["method":"ax_scroll_to_visible"]
        }
        guard let r = axRect(element) else { throw AxonError("no_click_point","The observed scroll target has no rectangle.") }
        point = CGPoint(x:r[0]+r[2]/2,y:r[1]+r[3]/2)
    }
    _ = try macMoveCursor(point,args)
    try macCheckTargetPoint(point,args)
    let amount=Int32(int(args["amount"],-3)), horizontal=bool(args["horizontal"],false)
    try post(CGEvent(scrollWheelEvent2Source:nil,units:.line,wheelCount:2,wheel1:horizontal ? 0 : amount,wheel2:horizontal ? amount : 0,wheel3:0))
    return ["method":"wheel","delta":amount]
}

func macElementInWindow(_ element: AXUIElement, _ window: AXUIElement) -> Bool {
    if CFEqual(element, window) { return true }
    if let winAttr = axAttr(element, kAXWindowAttribute as String),
       CFGetTypeID(winAttr) == AXUIElementGetTypeID(),
       CFEqual(winAttr, window) {
        return true
    }
    var cursor: AXUIElement? = element
    for _ in 0..<256 {
        guard let node = cursor else { break }
        if CFEqual(node, window) { return true }
        if let parent = axAttr(node, kAXParentAttribute as String), CFGetTypeID(parent) == AXUIElementGetTypeID() {
            cursor = (parent as! AXUIElement)
        } else {
            break
        }
    }
    return false
}

func macEnsureTyping(_ args: [String: Any]) throws {
    let (window, pid, _, _) = try resolveWindow(args)
    guard !IsSecureEventInputEnabled(), NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
        throw AxonError("focus_changed", "Keyboard input requires the foreground approved app and nonsecure input.")
    }
    macEnableWebAccessibility(pid)
    let axApp = AXUIElementCreateApplication(pid)
    var requestedTarget: AXUIElement? = nil
    if args["index"] != nil {
        let (target, _) = try snapshotElement(args)
        requestedTarget = target
        try MacFence.dispatched()
        let outcome = AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, true as CFTypeRef)
        if outcome != .success || axBool(target, kAXFocusedAttribute as String) != true {
            Thread.sleep(forTimeInterval: 0.04)
        }
        if outcome != .success && axBool(target, kAXFocusedAttribute as String) != true {
            if let r = axRect(target), r[2] > 0, r[3] > 0 {
                let pt = CGPoint(x: Double(r[0] + r[2] / 2), y: Double(r[1] + r[3] / 2))
                _ = try macMoveCursor(pt, args)
                try macCheckTargetPoint(pt, args)
                let src = CGEventSource(stateID: .hidSystemState)
                try post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: pt, mouseButton: .left))
                Thread.sleep(forTimeInterval: 0.012)
                try post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: pt, mouseButton: .left))
                Thread.sleep(forTimeInterval: 0.06)
            } else {
                throw AxonError("input_outcome_unknown", "The accessibility provider did not confirm focus. Observe before continuing.")
            }
        }
    } else if let pixels = pair(args["point"]) {
        let pt = CGPoint(x: Double(pixels[0]), y: Double(pixels[1]))
        _ = try macMoveCursor(pt, args)
        try macCheckTargetPoint(pt, args)
        let src = CGEventSource(stateID: .hidSystemState)
        try post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: pt, mouseButton: .left))
        Thread.sleep(forTimeInterval: 0.012)
        try post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: pt, mouseButton: .left))
        Thread.sleep(forTimeInterval: 0.06)
    }
    if let value = axAttr(axApp, kAXFocusedUIElementAttribute as String),
       CFGetTypeID(value) == AXUIElementGetTypeID() {
        let focused = value as! AXUIElement
        let role = (axString(focused, kAXRoleAttribute as String) ?? "") + (axString(focused, kAXSubroleAttribute as String) ?? "")
        guard !role.lowercased().contains("secure") else { throw AxonError("protected_app", "Secure fields require a human.") }
        let contained = CFEqual(focused, axApp) || macElementInWindow(focused, window)
        guard contained else { throw AxonError("focus_failed", "Keyboard focus is outside the approved window.") }
        if let target = requestedTarget {
            let matched = CFEqual(focused, target) || macElementInWindow(focused, target) || (axBool(target, kAXFocusedAttribute as String) == true)
            guard matched else { throw AxonError("focus_failed", "The requested editor did not acquire focus.") }
        }
    } else {
        if let target = requestedTarget {
            let role = (axString(target, kAXRoleAttribute as String) ?? "") + (axString(target, kAXSubroleAttribute as String) ?? "")
            guard !role.lowercased().contains("secure") else { throw AxonError("protected_app", "Secure fields require a human.") }
            guard axBool(target, kAXFocusedAttribute as String) == true || macElementInWindow(target, window) else {
                throw AxonError("focus_failed", "No actual editable focus was observed.")
            }
        } else {
            let isMainOrFocused = (axBool(window, kAXMainAttribute as String) == true)
                || (axBool(window, kAXFocusedAttribute as String) == true)
                || {
                    if let fw = axAttr(axApp, kAXFocusedWindowAttribute as String), CFGetTypeID(fw) == AXUIElementGetTypeID() {
                        return CFEqual(fw, window)
                    }
                    return false
                }()
            guard isMainOrFocused else { throw AxonError("focus_failed", "No actual editable focus was observed.") }
        }
    }
    MacFence.keyboardPID = pid
    MacFence.keyboardWindow = window
}

func macChord(_ code: CGKeyCode, _ flags: CGEventFlags = []) throws {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else { throw AxonError("event_creation_failed", "Cannot construct the keyboard event.") }
    down.flags = flags; up.flags = flags
    try post(down); try post(up)
}

func macPaste(_ args: [String: Any]) throws -> [String: Any] {
    try macBringToFront(args)
    try macEnsureTyping(args)
    let pasteboard = NSPasteboard.general
    let before = pasteboard.changeCount
    var saved: [[(NSPasteboard.PasteboardType, Data)]] = []
    for item in pasteboard.pasteboardItems ?? [] {
        var formats: [(NSPasteboard.PasteboardType, Data)] = []
        for type in item.types {
            guard let bytes = item.data(forType: type) else { throw AxonError("clipboard_preservation_failed", "A clipboard format cannot be preserved. Nothing was pasted.") }
            formats.append((type, bytes))
        }
        saved.append(formats)
    }
    guard before == pasteboard.changeCount else { throw AxonError("clipboard_changed", "The clipboard changed before preservation.") }
    try MacFence.dispatched(); pasteboard.clearContents()
    guard pasteboard.setString(str(args["text"]) ?? "", forType: .string) else { throw AxonError("clipboard_failed", "Cannot set temporary text.") }
    let ours = pasteboard.changeCount
    func restore() throws -> Bool {
        if pasteboard.changeCount == ours {
            let items = saved.map { formats -> NSPasteboardItem in let item = NSPasteboardItem(); for (type, data) in formats { item.setData(data, forType: type) }; return item }
            pasteboard.clearContents()
            guard items.isEmpty || pasteboard.writeObjects(items) else { throw AxonError("input_cleanup_failed", "The clipboard could not be restored. Inspect before continuing.") }
            return true
        }
        return false
    }
    do { try macChord(9, .maskCommand); Thread.sleep(forTimeInterval: 0.12) }
    catch { _ = try? restore(); throw error }
    return ["method": "clipboard_paste", "clipboard_restored": try restore(), "verification_required": true]
}

func macFitWindow(_ args: [String: Any]) throws -> [String: Any] {
    let (window, pid, title, _) = try resolveWindow(args)
    let state = macInspectWindowState(window: window, pid: pid, title: title, rect: axRect(window))
    if state.fullscreen {
        throw AxonError("window_fullscreen", state.errorMessage ?? "Exit macOS full-screen mode yourself before fitting the window. No Space was switched.")
    }
    if state.otherDesktop {
        throw AxonError("other_desktop", state.errorMessage ?? "Restore the app on the current Space yourself before fitting it. No Space was switched.")
    }
    if state.minimized || state.hidden {
        try MacFence.dispatched()
        if state.hidden { _ = NSRunningApplication(processIdentifier: pid)?.unhide() }
        if state.minimized { _ = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse) }
        Thread.sleep(forTimeInterval: 0.15)
    }
    guard let r = axRect(window),
          windowNumber(window: window, pid: pid, title: title, rect: r) != nil else {
        throw AxonError("other_desktop", "Restore the app on the current Space yourself before fitting it. No Space was switched.")
    }
    let current = CGRect(x: r[0], y: r[1], width: r[2], height: r[3])
    guard let screen = macDisplayRects().max(by: { $0.intersection(current).width * $0.intersection(current).height < $1.intersection(current).width * $1.intersection(current).height }) else {
        throw AxonError("display_unavailable", "No display is available.")
    }
    var size = CGSize(width: min(current.width, screen.width), height: min(current.height, screen.height))
    var point = CGPoint(x: max(screen.minX, min(current.minX, screen.maxX-size.width)), y: max(screen.minY, min(current.minY, screen.maxY-size.height)))
    guard let sizeValue = AXValueCreate(.cgSize, &size), let pointValue = AXValueCreate(.cgPoint, &point) else { throw AxonError("window_geometry_failed", "Cannot represent window bounds.") }
    if !MacFence.didDispatch { try MacFence.dispatched() }
    guard AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue) == .success,
          AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, pointValue) == .success else {
        throw AxonError("input_outcome_unknown", "The app did not confirm its new geometry. Observe before retrying.")
    }
    let deadline = Date().addingTimeInterval(0.4)
    repeat {
        try MacFence.check()
        if let actual = axRect(window), screen.contains(CGRect(x:actual[0],y:actual[1],width:actual[2],height:actual[3])) {
            return ["rect":actual,"fully_visible":true]
        }
        Thread.sleep(forTimeInterval:0.02)
    } while Date() < deadline
    throw AxonError("input_outcome_unknown", "The app acknowledged fitting but its bounds are not fully visible. Observe before continuing; do not replay input.")
}

func macLaunch(_ args: [String: Any]) throws -> [String: Any] {
    let url = URL(fileURLWithPath: str(args["app"]) ?? "").standardizedFileURL
    guard url.pathExtension == "app", let bundle = Bundle(url: url), bundle.executableURL != nil else {
        throw AxonError("invalid_application", "Select an existing GUI application bundle.")
    }
    let signal = DispatchSemaphore(value: 0); var running: NSRunningApplication?; var failure: Error?
    let configuration = NSWorkspace.OpenConfiguration(); configuration.arguments = args["args"] as? [String] ?? []
    try MacFence.dispatched()
    NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in running = app; failure = error; signal.signal() }
    guard signal.wait(timeout: .now()+15) == .success, let app = running else {
        throw AxonError("input_outcome_unknown", "Launch was submitted but not confirmed: \(String(describing: failure)). Discover apps; do not relaunch.")
    }
    return ["pid": Int(app.processIdentifier), "path": url.path]
}

func macCapture(_ args: [String: Any]) throws -> [String: Any] {
    let hasPermission = CGPreflightScreenCaptureAccess()
    guard hasPermission else { throw AxonError("mac_permissions_required", "Screen Recording permission needs human setup in System Settings > Privacy & Security.") }
    let (window, pid, title, _) = try resolveWindow(args)
    let r = axRect(window)
    let state = macInspectWindowState(window: window, pid: pid, title: title, rect: r, hasScreenCapturePermission: hasPermission)
    if let code = state.errorCode, let message = state.errorMessage {
        throw AxonError(code, message)
    }
    guard let r = r, let number = state.windowID else {
        throw AxonError("window_capture_unavailable", "The approved window is not unambiguously available on the current Space. No desktop fallback was captured.")
    }
    let signal = DispatchSemaphore(value: 0); var captured: CGImage?; var failure: Error?
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
        guard let target = content?.windows.first(where: { $0.windowID == number && $0.owningApplication?.processID == pid }) else {
            failure = error; signal.signal(); return
        }
        let configuration = SCStreamConfiguration()
        let maxWidth = min(1400, max(100, int(args["max_width"], 1400)))
        let ratio = min(1, Double(maxWidth)/Double(max(1, r[2])))
        configuration.width = max(1, Int(Double(r[2])*ratio)); configuration.height = max(1, Int(Double(r[3])*ratio))
        configuration.showsCursor = false
        SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: target), configuration: configuration) { image, error in
            captured = image; failure = error; signal.signal()
        }
    }
    guard signal.wait(timeout: .now()+10) == .success, let image = captured else {
        throw AxonError("window_capture_unavailable", "Window capture failed: \(String(describing: failure)). No covering-app pixels were returned.")
    }
    try MacFence.check()
    guard axRect(window) == r else { throw AxonError("window_moved", "The window moved during capture. Discard this observation.") }
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let bytes = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else { throw AxonError("encode_failed", "Screenshot encoding failed.") }
    var out: [String: Any] = ["mime": "image/jpeg", "width": image.width, "height": image.height, "source": r,
                              "capture": "window", "data": bytes.base64EncodedString()]
    if bool(args["ocr"], false) {
        out["screen_text"] = macRecognizeText(image)
    }
    return out
}

func macRecognizeText(_ image: CGImage) -> [[String: Any]] {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .fast
    req.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([req]) } catch { return [] }
    guard let observations = req.results else { return [] }
    var items: [[String: Any]] = []
    let w = Double(image.width), h = Double(image.height)
    for obs in observations.prefix(80) {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { continue }
        let b = obs.boundingBox
        let cx = max(0, min(image.width - 1, Int(((b.minX + b.width / 2.0) * w).rounded())))
        let cy = max(0, min(image.height - 1, Int(((1.0 - (b.minY + b.height / 2.0)) * h).rounded())))
        items.append(["text": text, "x": cx, "y": cy])
    }
    return items
}

func macFileDialog(_ args: [String: Any]) throws -> [String: Any] {
    // Fail closed until a real AppKit picker can be identified and read back.
    // Implemented below through AX sheets; never use blind Enter or shell paths.
    let (owner, pid, _, _) = try resolveWindow(args)
    let sheets = axChildren(owner).filter { axString($0, kAXRoleAttribute as String) == "AXSheet" }
    let ownRole = axString(owner, kAXRoleAttribute as String) ?? ""
    let ownSubrole = axString(owner, kAXSubroleAttribute as String) ?? ""
    let ownId = axString(owner, kAXIdentifierAttribute as String) ?? ""
    let candidates = sheets + ((ownRole == "AXSheet" || ownSubrole == "AXDialog" || ownId == "open-panel" || ownId == "save-panel") ? [owner] : [])
    guard candidates.count == 1, NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
        throw AxonError("file_dialog_not_found", "Observe an already-open native file picker attached to this owner.")
    }
    let dialog = candidates[0], path = str(args["path"]) ?? ""
    guard path.hasPrefix("/"), !path.contains("\n"), !path.contains("\r"), !path.contains("\0") else {
        throw AxonError("invalid_path", "The picker needs an exact absolute local path.")
    }
    MacFence.keyboardPID = pid
    MacFence.keyboardWindow = dialog
    try macChord(5, [.maskCommand, .maskShift]); Thread.sleep(forTimeInterval: 0.2)
    func descendants(_ root: AXUIElement) -> [AXUIElement] {
        var pending = [root], result: [AXUIElement] = []
        while !pending.isEmpty && result.count < 500 { let el = pending.removeLast(); result.append(el); pending.append(contentsOf: axChildren(el)) }
        return result
    }
    let started = MacDeadline.now
    var fields: [AXUIElement] = []
    while true {
        fields = descendants(dialog).filter { (axString($0, kAXRoleAttribute as String) == "AXTextField" || axString($0, kAXRoleAttribute as String) == "AXComboBox") && axBool($0, kAXFocusedAttribute as String) == true }
        if fields.count == 1 { break }
        let now = MacDeadline.now
        if now == 0 || now < started || now - started >= 2000 { break }
        Thread.sleep(forTimeInterval: 0.05)
    }
    guard fields.count == 1 else { throw AxonError("file_dialog_field_not_found", "The Go to Folder field was not unambiguously observed. No filename was submitted.") }
    try MacFence.dispatched()
    guard AXUIElementSetAttributeValue(fields[0], kAXValueAttribute as CFString, path as CFTypeRef) == .success,
          axString(fields[0], kAXValueAttribute as String) == path else {
        throw AxonError("file_dialog_path_mismatch", "Exact path readback failed. The picker was not confirmed.")
    }
    try macChord(36); Thread.sleep(forTimeInterval: 0.2)
    if !axAlive(dialog) { return ["dialog_closed": true, "path_verified": true, "verification_required": true] }
    let expectedURL = URL(fileURLWithPath: path).standardizedFileURL
    let selectionVerified = descendants(dialog).contains { element in
        guard axBool(element, kAXSelectedAttribute as String) == true,
              let selectedURL = axAttr(element, kAXURLAttribute as String) as? URL else { return false }
        return selectedURL.standardizedFileURL == expectedURL
    }
    guard selectionVerified else {
        throw AxonError("file_dialog_path_mismatch", "The picker did not expose an exact selected-file URL after navigation. It was not confirmed; inspect it without replaying input.")
    }
    guard let value = axAttr(dialog, kAXDefaultButtonAttribute as String), CFGetTypeID(value) == AXUIElementGetTypeID() else {
        throw AxonError("file_dialog_confirmation_required", "The original picker has no observed default button. Inspect it without replay.")
    }
    try MacFence.dispatched()
    guard AXUIElementPerformAction(value as! AXUIElement, kAXPressAction as CFString) == .success else {
        throw AxonError("input_outcome_unknown", "Picker confirmation was not acknowledged. Inspect before continuing.")
    }
    return ["path_verified": true, "verification_required": true, "method": "accessibility_picker"]
}
