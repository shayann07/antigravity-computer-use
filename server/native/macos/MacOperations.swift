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
// The events that type one character. Flags are set explicitly: an event
// created from the HID system state otherwise inherits whatever modifiers that
// state last saw (for example Command from an earlier cmd+down chord), and the
// app then runs shortcuts instead of receiving text.
func macTypingEvents(source: CGEventSource?, scalar: Unicode.Scalar) -> [CGEvent] {
    if scalar == "\n" || scalar == "\t" {
        let code: CGKeyCode = scalar == "\n" ? 36 : 48
        return [true, false].compactMap { down in
            let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down); event?.flags = []; return event
        }
    }
    var utf16 = Array(String(scalar).utf16)
    return [true, false].compactMap { down in
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { return nil }
        event.flags = []
        event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        return event
    }
}
// The app that receives keystrokes right now, asked live from the
// accessibility server rather than from a cached workspace notification.
func macFrontmostPid() -> pid_t {
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as CFString, &value) == .success,
       let value, CFGetTypeID(value) == AXUIElementGetTypeID() {
        var pid: pid_t = 0
        if AXUIElementGetPid(value as! AXUIElement, &pid) == .success { return pid }
    }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
}
func macExecutablePath(_ pid: pid_t) -> String? {
    guard pid > 0 else { return nil }
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
}
func macIsOwnChrome(ownerPath: String?, selfPath: String?) -> Bool {
    guard let ownerPath, let selfPath, selfPath.hasSuffix("/Contents/MacOS/AxonHost") else { return false }
    return ownerPath == selfPath
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
    let ownExecutable = macExecutablePath(getpid())
    var chrome: [Int32: Bool] = [:]
    let rows: [MacStackRow] = windows.map { candidate in
        let owner = (candidate[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? -1
        // The bar, glow and access card are drawn by this same AxonHost
        // executable. They are this runtime's own chrome, never the human's
        // window, even when the guardian record cannot be verified.
        var own = guardianAlive && owner == guardian
        if !own {
            if let cached = chrome[owner] { own = cached }
            else { own = macIsOwnChrome(ownerPath: macExecutablePath(owner), selfPath: ownExecutable); chrome[owner] = own }
        }
        let bounds = (candidate[kCGWindowBounds as String] as? [String: Any]).flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) } ?? .zero
        return MacStackRow(number: (candidate[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0, owner: owner,
                           ownerName: candidate[kCGWindowOwnerName as String] as? String ?? "", layer: (candidate[kCGWindowLayer as String] as? NSNumber)?.int32Value ?? 0,
                           alpha: (candidate[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0, bounds: bounds, own: own)
    }
    switch macTopWindowVerdict(rows, point: point, expected: expected, pid: pid) {
    case .target: return
    case .covered: throw AxonError("obscured", "Another window covers this point. No click was sent.")
    case .none: throw AxonError("obscured", "The target point has no verifiable owning window.")
    }
}

// One on-screen window, front to back, as the occlusion check sees it.
struct MacStackRow { let number: CGWindowID; let owner: Int32; let ownerName: String; let layer: Int32; let alpha: Double; let bounds: CGRect; let own: Bool }
enum MacTopWindow { case target, covered, none }
// The frontmost window at the point decides. This runtime's own chrome, the
// Dock and the Window Server are looked through. The approved window wins
// wherever it is, including an alert, sheet or panel the app shows above
// layer 0; another window of the same app above layer 0 (a menu, popup or
// popover) is looked through.
func macTopWindowVerdict(_ rows: [MacStackRow], point: CGPoint, expected: CGWindowID, pid: Int32) -> MacTopWindow {
    for row in rows {
        if row.own || row.ownerName == "Dock" || row.ownerName == "Window Server" { continue }
        guard row.alpha > 0, row.bounds.contains(point) else { continue }
        if row.number == expected { return .target }
        if row.owner == pid && row.layer > 0 { continue }
        return .covered
    }
    return .none
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
    let approvalsPath = NSTemporaryDirectory() + "agcu-approvals-\(getpid()).json"
    defer { unlink(approvalsPath) }
    let day = MacGuardian.rememberedIdleSeconds, nowSeconds = Date().timeIntervalSince1970
    var many: [String: Set<String>] = [:], manySeen: [String: Double] = [:]
    for i in 0..<70 { many["h\(i)"] = ["/Applications/A\(i).app/Contents/MacOS/A"]; manySeen["h\(i)"] = nowSeconds - Double(i) }
    many["old"] = ["/x/Old"]; manySeen["old"] = nowSeconds - day - 1
    let pruned = MacGuardian.pruneRemembered(many, manySeen, now: nowSeconds)
    guard pruned.0.count == 64, pruned.0["h0"] != nil, pruned.0["h69"] == nil, pruned.0["old"] == nil,
          MacGuardian.saveRemembered(approvalsPath, ["h": ["/Applications/T.app/Contents/MacOS/T"]], ["h": nowSeconds]),
          MacGuardian.loadRemembered(approvalsPath, now: nowSeconds).0["h"] == ["/Applications/T.app/Contents/MacOS/T"],
          MacGuardian.loadRemembered(approvalsPath, now: nowSeconds + day + 1).0.isEmpty,
          MacGuardian.loadRemembered(approvalsPath + ".missing", now: nowSeconds).0.isEmpty else {
        throw AxonError("contract_test_failed", "Saved conversation approvals differ.")
    }
    let typingSource = CGEventSource(stateID: .privateState)
    let typed = macTypingEvents(source: typingSource, scalar: "ہ"), newline = macTypingEvents(source: typingSource, scalar: "\n")
    guard typed.count == 2, newline.count == 2, (typed + newline).allSatisfy({ $0.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty }),
          typed.allSatisfy({ event in
              var length = 0; var units = [UniChar](repeating: 0, count: 4)
              event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &length, unicodeString: &units)
              return String(utf16CodeUnits: units, count: length) == "ہ" }),
          newline.first?.getIntegerValueField(.keyboardEventKeycode) == 36 else {
        throw AxonError("contract_test_failed", "Typed characters must carry their text and no modifier flags.")
    }
    guard macIsOwnChrome(ownerPath: "/A/AxonHost.app/Contents/MacOS/AxonHost", selfPath: "/A/AxonHost.app/Contents/MacOS/AxonHost"),
          !macIsOwnChrome(ownerPath: "/B/AxonHost.app/Contents/MacOS/AxonHost", selfPath: "/A/AxonHost.app/Contents/MacOS/AxonHost"),
          !macIsOwnChrome(ownerPath: "/System/Applications/TextEdit.app/Contents/MacOS/TextEdit", selfPath: "/A/AxonHost.app/Contents/MacOS/AxonHost"),
          !macIsOwnChrome(ownerPath: nil, selfPath: "/A/AxonHost.app/Contents/MacOS/AxonHost"),
          !macIsOwnChrome(ownerPath: "/usr/bin/x", selfPath: "/usr/bin/x") else {
        throw AxonError("contract_test_failed", "Own HUD chrome classification differs.")
    }
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
    var hudVisibility = MacHudVisibility()
    guard !hudVisibility.requestedVisible, !hudVisibility.captureHidden,
          hudVisibility.requestShow() else {
        throw AxonError("contract_test_failed", "Passive HUD visibility or first entrance differs.")
    }
    hudVisibility.beginCapture()
    guard hudVisibility.captureHidden, !hudVisibility.requestShow(),
          hudVisibility.endCapture(), !hudVisibility.requestShow() else {
        throw AxonError("contract_test_failed", "Capture restoration must not replay the HUD entrance.")
    }
    hudVisibility.beginCapture()
    hudVisibility.requestHide()
    guard !hudVisibility.endCapture(), !hudVisibility.requestedVisible,
          hudVisibility.requestShow() else {
        throw AxonError("contract_test_failed", "Capture restoration undid Hide or blocked a later explicit show.")
    }
    hudVisibility.requestHide()
    hudVisibility.beginCapture()
    guard !hudVisibility.endCapture() else {
        throw AxonError("contract_test_failed", "Passive capture restoration unexpectedly requested controls.")
    }
    _ = NSApplication.shared
    let dormantHud = MacVisuals(), hudPath = MacFence.file + ".hud"
    var existingHud = stat()
    guard lstat(hudPath, &existingHud) != 0, errno == ENOENT else {
        throw AxonError("contract_test_failed", "HUD fixture path was already occupied.")
    }
    try Data("[0,0,32,32]".utf8).write(to: URL(fileURLWithPath: hudPath), options: [.withoutOverwriting])
    dormantHud.hideForCapture()
    guard !FileManager.default.fileExists(atPath: hudPath) else {
        throw AxonError("contract_test_failed", "Hidden HUD retained its takeover-exemption bounds.")
    }
    try FileManager.default.createDirectory(atPath: hudPath, withIntermediateDirectories: false)
    dormantHud.hide()
    var hudIsDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: hudPath, isDirectory: &hudIsDirectory), hudIsDirectory.boolValue else {
        throw AxonError("contract_test_failed", "HUD cleanup recursively removed a directory.")
    }
    guard rmdir(hudPath) == 0 else { // This exact empty fixture only.
        throw AxonError("contract_test_failed", "HUD fixture cleanup was not an empty directory.")
    }
    let iconAssets = try MacPhosphorIcon.validateAssets()
    guard iconAssets == 5 else { throw AxonError("contract_test_failed", "Official HUD icon inventory differs.") }
    // The bar says what Guardian.cs Model() says, in every state; no Pause,
    // no Resume and no Re-arm anywhere; Stop and Settings sit where Windows has them.
    let working = MacBarModel.make(state: "active", prompting: false, host: "Antigravity", activity: "Clicking", lowTime: true, reason: "", ended: false)
    let asking = MacBarModel.make(state: "active", prompting: true, host: "Antigravity", activity: "", lowTime: false, reason: "", ended: false)
    let stopped = MacBarModel.make(state: "stopped", prompting: false, host: "Antigravity", activity: "", lowTime: false, reason: "button", ended: false)
    let readyBar = MacBarModel.make(state: "idle", prompting: false, host: "", activity: "", lowTime: false, reason: "", ended: false)
    let ran = MacBarModel.make(state: "idle", prompting: false, host: "Antigravity", activity: "", lowTime: false, reason: "", ended: true)
    let all = [working, asking, stopped, readyBar, ran]
    guard working.line1 == "Antigravity is working", working.line2 == "Clicking · 1 min left", working.slot == 1, working.hint,
          asking.state == "asking", asking.line1 == "Waiting for your answer", asking.slot == 1,
          stopped.line1 == "Stopped", stopped.line2 == "You pressed Stop", stopped.slot == 2, !stopped.hint,
          readyBar.line1 == "Computer Use is ready", readyBar.slot == 2, ran.line1 == "Session ended", ran.state == "ended",
          !all.contains(where: { m in ["pause", "resume", "re-arm"].contains(where: { (m.line1 + m.line2).lowercased().contains($0) }) }),
          MacBarArt.stateColor("stopped") == MacDesign.rose, MacBarArt.stateColor("asking") == MacDesign.amber,
          MacBarArt.width == 440, MacBarArt.height == 48, MacBarArt.stopRect == CGRect(x: 345, y: 2, width: 44, height: 44),
          MacBarArt.modeRect == CGRect(x: 394, y: 2, width: 44, height: 44), MacMenuArt.width == 312, MacMenuArt.radius == 12,
          MacBarModel.activityWords("drag") == "Dragging", MacBarModel.activityWords("observe") == "Reading the screen" else {
        throw AxonError("contract_test_failed", "Mac bar words, states or geometry differ from Guardian.cs.")
    }
    var menuItems = [MacMenuItem(kind: "head"), MacMenuItem(id: 1), MacMenuItem(kind: "rule"), MacMenuItem(kind: "foot")]
    let menuTall = MacMenuArt.layout(&menuItems)
    let page = MacMenuArt.pageAt(MacDesign.normal), pageStart = MacMenuArt.pageAt(0)
    guard menuTall == 6 + 30 + 44 + 13 + 58 + 6, menuItems[1].bounds == CGRect(x: 6, y: 36, width: 300, height: 44),
          page.move == 1, page.gone == 0, page.come == 1, pageStart.move == 0, pageStart.gone == 1, pageStart.come == 0,
          MacBarMotion.band(500, low: 0, high: 1000, margin: 12) == 500, MacBarMotion.band(-10_000, low: 0, high: 1000, margin: 12) >= 0,
          MacBarMotion.band(2000, low: 0, high: 1000, margin: 12) <= 1000, (1...11).contains(MacBarMotion.band(-6, low: 0, high: 1000, margin: 12)) else {
        throw AxonError("contract_test_failed", "Menu layout, page timing or the drag's rubber band differ.")
    }
    var spring = MacBarMotion.Spring(x: 0, y: 0, vx: 1500, vy: 0, to: CGPoint(x: 100, y: 0)), springTime = 0.0, overshoot: CGFloat = 0
    while MacBarMotion.advance(&spring, elapsed: 1.0 / 60) && springTime < 3 { springTime += 1.0 / 60; overshoot = max(overshoot, spring.x - 100) }
    guard springTime > 0.2, springTime < 1.0, overshoot > 0, overshoot < 40 else {
        throw AxonError("contract_test_failed", "The bar's settling spring differs from 0.45 s with a gentle bounce.")
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
    // Pure native approval/geometry checks: no modal, consent click or desktop
    // event is fabricated, and no real application is granted here.
    let expectedApproval = try MacFenceState("active|approval|1000||2000|0")
    guard MacFence.approvalStateMatches(expectedApproval, expectedApproval, latched: false, wallNow: 900, bootNow: 1000),
          !MacFence.approvalStateMatches(expectedApproval, expectedApproval, latched: true, wallNow: 900, bootNow: 1000),
          !MacFence.approvalStateMatches(expectedApproval, expectedApproval, latched: false, wallNow: 1000, bootNow: 1000),
          !MacFence.approvalStateMatches(expectedApproval, expectedApproval, latched: false, wallNow: 900, bootNow: 2000) else {
        throw AxonError("contract_test_failed", "Approval deadline/Stop classification differs.")
    }
    for changed in ["paused|approval|1000||0|1", "stopped||0||0|1", "idle||0||0|0",
                    "active|other|1000||2000|0", "active|approval|1001||2000|0",
                    "active|approval|1000||2001|0", "active|approval|1000|eA==|2000|0"] {
        guard !MacFence.approvalStateMatches(expectedApproval, try MacFenceState(changed), latched: false, wallNow: 900, bootNow: 1000) else {
            throw AxonError("contract_test_failed", "A changed native session could complete an old approval.")
        }
    }
    // Access tiers (pure): click-only apps accept a plain left click, moves,
    // scrolling, focus and window sizing; everything else is refused for the
    // target and whenever a click-only app is frontmost.
    let tiered = try MacFenceState("active|tier|1000|\(Data("t:1:/a\nk:2:/b".utf8).base64EncodedString())|2000|0|\(Data("t:1:/a".utf8).base64EncodedString())")
    guard tiered.clickGrants == ["t:1:/a"], tiered.grants.count == 2,
          try MacFenceState("active|tier|1000||2000|0").clickGrants.isEmpty,
          try MacFenceState("idle||0||0|0|").clickGrants.isEmpty else {
        throw AxonError("contract_test_failed", "Access tier state decoding differs.")
    }
    do { _ = try MacFenceState("active|tier|1000||2000|0|%%%"); throw AxonError("contract_test_failed", "Malformed access tier state accepted.") }
    catch let error as AxonError { if error.code == "contract_test_failed" { throw error } }
    for (op, args) in [("click", [:]), ("click", ["button": "left"]), ("click", ["modifiers": [String]()]), ("click", ["button": NSNull()]),
                       ("move", [:]), ("scroll", [:]), ("focus", [:]), ("fit_window", [:]), ("resize_window", [:])] as [(String, [String: Any])] {
        guard MacTier.clickAllows(op, args) else { throw AxonError("contract_test_failed", "Click tier refused \(op).") }
    }
    for (op, args) in [("click", ["button": "right"]), ("click", ["button": "middle"]), ("click", ["modifiers": ["cmd"]]), ("click", ["modifiers": "shift"]),
                       ("click", ["modifiers": 1]), ("type", [:]), ("key", [:]), ("drag", [:]), ("paste", [:]), ("paste_files", [:]), ("set_value", [:]),
                       ("clipboard", [:]), ("open", [:]), ("launch", [:]), ("file_dialog", [:]), ("close_window", [:])] as [(String, [String: Any])] {
        guard !MacTier.clickAllows(op, args) else { throw AxonError("contract_test_failed", "Click tier allowed \(op).") }
    }
    func tierCode(_ op: String, _ args: [String: Any], target: String?, front: String?, click: Set<String> = ["t:1:/a"]) -> String? {
        do { try MacTier.check(op, args, appKey: target, clickGrants: click, frontmostKey: { front }); return nil }
        catch let error as AxonError { return error.code } catch { return "other" }
    }
    guard tierCode("type", [:], target: "t:1:/a", front: nil) == "app_tier_click",
          tierCode("click", ["button": "right"], target: "t:1:/a", front: nil) == "app_tier_click",
          tierCode("click", [:], target: "t:1:/a", front: "t:1:/a") == nil,
          tierCode("scroll", [:], target: "t:1:/a", front: nil) == nil,
          tierCode("type", [:], target: "k:2:/b", front: "t:1:/a") == "app_tier_click",
          tierCode("key", [:], target: nil, front: "t:1:/a") == "app_tier_click",
          tierCode("type", [:], target: "k:2:/b", front: "k:2:/b") == nil,
          tierCode("type", [:], target: "k:2:/b", front: nil) == nil,
          tierCode("snapshot", [:], target: "t:1:/a", front: "t:1:/a") == nil,
          tierCode("type", [:], target: "t:1:/a", front: "t:1:/a", click: []) == nil else {
        throw AxonError("contract_test_failed", "Access tier enforcement for the target or the frontmost app differs.")
    }
    // Approvals last for the conversation: per handle and per executable.
    var table: [String: Set<String>] = [:]
    table = MacGuardian.remember(table, handle: "h1", executable: "/Applications/TextEdit.app/Contents/MacOS/TextEdit")
    guard MacGuardian.rememberedAllows(table, handle: "h1", executable: "/Applications/TextEdit.app/Contents/MacOS/TextEdit"),
          !MacGuardian.rememberedAllows(table, handle: "h2", executable: "/Applications/TextEdit.app/Contents/MacOS/TextEdit"),
          !MacGuardian.rememberedAllows(table, handle: "h1", executable: "/System/Applications/Calculator.app/Contents/MacOS/Calculator"),
          !MacGuardian.rememberedAllows(table, handle: nil, executable: "/Applications/TextEdit.app/Contents/MacOS/TextEdit"),
          !MacGuardian.rememberedAllows(table, handle: "", executable: "/Applications/TextEdit.app/Contents/MacOS/TextEdit"),
          !MacGuardian.rememberedAllows(table, handle: "h1", executable: nil),
          MacGuardian.remember(table, handle: String(repeating: "x", count: 65), executable: "/x") == table,
          MacGuardian.remember(table, handle: "h1", executable: "") == table else {
        throw AxonError("contract_test_failed", "Remembered approval matching differs.")
    }
    var full: [String: Set<String>] = [:]
    for index in 0..<64 { full = MacGuardian.remember(full, handle: "h\(index)", executable: "/x") }
    // The bound is applied by pruneRemembered, which keeps the 64 most recently
    // used conversations rather than clearing them all.
    var fullSeen: [String: Double] = [:]; for index in 0..<65 { fullSeen["h\(index)"] = Double(1_000 + index) }
    let grown = MacGuardian.remember(full, handle: "h64", executable: "/x")
    guard full.count == 64, grown.count == 65, MacGuardian.pruneRemembered(grown, fullSeen, now: 1_100).0.count == 64,
          MacGuardian.pruneRemembered(grown, fullSeen, now: 1_100).0["h0"] == nil,
          MacGuardian.remember(full, handle: "h3", executable: "/y").count == 64 else {
        throw AxonError("contract_test_failed", "Remembered approval bound differs.")
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
    // The shared key rule (control-contract.json) through ICU, as JS reads it
    // (tests/sensitive-keys.test.mjs): Cmd/Ctrl plus exactly S, V or X asks.
    for keys in ["ctrl+s", "cmd+v", "command+x", "ctrl+shift+s", "shift+ctrl+v", "cmd+shift+s", "ctrl+alt+v", "enter", "ctrl+s ctrl+v"]
    where !MacFence.sensitive("key", ["__risk": "routine", "keys": keys], label: keys) {
        throw AxonError("contract_test_failed", "Key chord \(keys) must ask.")
    }
    for keys in ["ctrl+shift+n", "ctrl+shift+t", "cmd+shift+4", "ctrl+space", "cmd+a", "ctrl+shift+esc", "shift+tab"]
    where MacFence.sensitive("key", ["__risk": "routine", "keys": keys], label: keys) {
        throw AxonError("contract_test_failed", "Key chord \(keys) must not ask.")
    }
    // Drags are never named, so they always ask; a click with no reachable
    // target gets no label either.
    guard try MacFence.preview(["from": [1, 1], "to": [9, 9], "point": [1, 1]]) == "",
          try MacFence.preview(["from": [1, 1], "to": [9, 9], "points": [[1, 1], [5, 5], [9, 9]]]) == "",
          try MacFence.preview(["point": [1, 1]]) == "" else {
        throw AxonError("contract_test_failed", "An unnamed pixel target received a label.")
    }
    // A stroke's hops: steps for a straight drag, about 8 pt per hop otherwise,
    // and never more than macMaxStrokeHops in total.
    guard macStrokeHops([[0, 0], [80, 0]], steps: 12) == [0, 12],
          macStrokeHops([[0, 0], [80, 0], [80, 4], [80, 900]], steps: 12) == [0, 10, 1, 40] else {
        throw AxonError("contract_test_failed", "Stroke hops differ from the Windows host.")
    }
    let longStroke = (0..<400).map { [$0 % 2 == 0 ? 0 : 1000, $0] }
    guard macStrokeHops(longStroke, steps: 12).reduce(0, +) <= macMaxStrokeHops else {
        throw AxonError("contract_test_failed", "A long stroke exceeds the hop budget.")
    }
    // Exercise the actual native fence in isolated project-local storage.
    // Refusals only: no fake live permission, application grant or input event.
    try MacFence.initialize()
    let pendingApproval = try MacFenceState("active|approval-fixture|\(MacFenceState.now + 100_000_000)||\(MacDeadline.now + 10_000)|0")
    // A Stop or expiry published while the local dialog was open must win:
    // the old approval cannot complete. Human input never pauses. A legacy
    // "paused" record is refused the same way.
    for changed in ["stopped||0||0|1", "paused|approval-fixture|\(pendingApproval.until)||0|1"] {
    try MacFence.write("active|approval-fixture|\(pendingApproval.until)||\(pendingApproval.bootUntil)|0")
    try MacInputLedger.withLock {
        try MacFence.withTransitionLock { try MacFence.write(changed) }
    }
    do {
        try MacFence.withApprovalFence(pendingApproval) { throw AxonError("contract_test_failed", "An old approval overwrote a pause.") }
        throw AxonError("contract_test_failed", "An old approval was accepted after a pause.")
    } catch let error as AxonError { if error.code != "approval_changed" { throw error } }
    guard try MacFence.read().state == String(changed.prefix(while: { $0 != "|" })), try MacFence.read().cleanupPending else {
        throw AxonError("contract_test_failed", "Approval completion lost native Stop/cleanup state.")
    }
    }
    // clear_stop removes only an exact confirmed marker; uncertain, unreadable,
    // linked or directory entries stay, and nothing is removed recursively.
    let clearProbe = MacFence.file + ".clear-probe-" + UUID().uuidString
    defer { try? FileManager.default.removeItem(atPath: clearProbe + ".unconfirmed"); unlink(clearProbe); rmdir(clearProbe) }
    guard MacFence.clearConfirmedLatch(clearProbe) == .cleared,
          MacFence.clearConfirmedLatch("") == .refused("stop_persistence_failed"),
          MacFence.clearConfirmedLatch("relative/emergency.stop") == .refused("stop_persistence_failed"),
          MacFence.latchStop(clearProbe), MacFence.clearConfirmedLatch(clearProbe) == .cleared, !MacFence.latchBlocks(clearProbe) else {
        throw AxonError("contract_test_failed", "A confirmed Stop marker was not cleared exactly.")
    }
    for (contents, expected) in [("unconfirmed:abc", "guardian_stop_unconfirmed"), ("stoppedx", "stop_persistence_failed"), ("", "stop_persistence_failed")] {
        try Data(contents.utf8).write(to: URL(fileURLWithPath: clearProbe))
        guard MacFence.clearConfirmedLatch(clearProbe) == .refused(expected), MacFence.latchBlocks(clearProbe) else {
            throw AxonError("contract_test_failed", "An uncertain or invalid Stop marker was cleared.")
        }
        unlink(clearProbe)
    }
    guard MacFence.latchStop(clearProbe) else { throw AxonError("contract_test_failed", "Cannot create the clear fixture.") }
    try Data("unconfirmed:companion".utf8).write(to: URL(fileURLWithPath: clearProbe + ".unconfirmed"))
    guard MacFence.clearConfirmedLatch(clearProbe) == .refused("guardian_stop_unconfirmed"), MacFence.latchBlocks(clearProbe) else {
        throw AxonError("contract_test_failed", "A Stop with an unconfirmed companion was cleared.")
    }
    unlink(clearProbe + ".unconfirmed"); unlink(clearProbe)
    guard symlink(clearProbe + ".target", clearProbe) == 0,
          MacFence.clearConfirmedLatch(clearProbe) == .refused("stop_persistence_failed"), unlink(clearProbe) == 0,
          mkdir(clearProbe, 0o700) == 0, MacFence.clearConfirmedLatch(clearProbe) == .refused("stop_persistence_failed") else {
        throw AxonError("contract_test_failed", "A linked or directory Stop marker was cleared.")
    }
    var probeDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: clearProbe, isDirectory: &probeDirectory), probeDirectory.boolValue, rmdir(clearProbe) == 0 else {
        throw AxonError("contract_test_failed", "Clearing a directory marker changed it.")
    }
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
    // Shared motion curves and the access prompt's layout (pure; no window).
    guard MacDesign.easeOut(0) == 0, MacDesign.easeOut(1) == 1, abs(MacDesign.easeOut(0.5) - 0.966) < 0.005,
          MacDesign.easeInOut(0) == 0, MacDesign.easeInOut(1) == 1, abs(MacDesign.easeInOut(0.5) - 0.596) < 0.005,
          MacDesign.easeInOut(0.25) < 0.1, MacDesign.easeOut(.nan) == 0,
          stride(from: 0.0, through: 1.0, by: 0.05).allSatisfy({ MacDesign.easeOut($0) <= MacDesign.easeOut(min(1, $0 + 0.05)) + 1e-9 }) else {
        throw AxonError("contract_test_failed", "Shared easing curves differ.")
    }
    let promptScreen = NSRect(x: 0, y: 0, width: 1440, height: 900), promptCard = NSSize(width: 496, height: 200)
    let barHigh = NSRect(x: 520, y: 840, width: 400, height: 44), barLow = NSRect(x: 520, y: 40, width: 400, height: 44)
    let under = MacPromptCardView.placement(card: promptCard, bar: barHigh, screen: promptScreen)
    let over = MacPromptCardView.placement(card: promptCard, bar: barLow, screen: promptScreen)
    let middle = MacPromptCardView.placement(card: promptCard, bar: nil, screen: promptScreen)
    let corner = MacPromptCardView.placement(card: promptCard, bar: NSRect(x: 1400, y: 850, width: 40, height: 44), screen: promptScreen)
    guard under.maxY == barHigh.minY - 8, under.midX == barHigh.midX,
          over.minY == barLow.maxY + 8, over.midX == barLow.midX,
          middle.midX == promptScreen.midX, middle.midY == promptScreen.midY,
          corner.maxX == promptScreen.maxX - 12, promptScreen.insetBy(dx: 12, dy: 12).contains(corner) else {
        throw AxonError("contract_test_failed", "Access prompt placement differs.")
    }
    let shortCard = MacPromptCardView(message: "Allow this application for this session?\n\nCalculator", fallback: "x")
    let longCard = MacPromptCardView(message: "Approve ONE sensitive operation?\n\n" + String(repeating: "A long request line that wraps.\n", count: 80), fallback: "x")
    let untitled = MacPromptCardView(message: String(repeating: "no newline ", count: 20), fallback: "Allow one sensitive action?")
    // The approved window may be an app's own alert above layer 0 (found on
    // Preview's "couldn't be opened" alert): it is the target, not a popup.
    let at = CGPoint(x: 50, y: 50), box = CGRect(x: 0, y: 0, width: 100, height: 100)
    let glowRow = MacStackRow(number: 1, owner: 9, ownerName: "Computer Use", layer: 25, alpha: 1, bounds: box, own: true)
    let alertRow = MacStackRow(number: 2, owner: 7, ownerName: "Preview", layer: 8, alpha: 1, bounds: box, own: false)
    let behind = MacStackRow(number: 3, owner: 5, ownerName: "Claude", layer: 0, alpha: 1, bounds: box, own: false)
    let menuRow = MacStackRow(number: 4, owner: 7, ownerName: "Preview", layer: 101, alpha: 1, bounds: box, own: false)
    let docWindow = MacStackRow(number: 5, owner: 7, ownerName: "Preview", layer: 0, alpha: 1, bounds: box, own: false)
    guard macTopWindowVerdict([glowRow, alertRow, behind], point: at, expected: 2, pid: 7) == .target,
          macTopWindowVerdict([menuRow, docWindow], point: at, expected: 5, pid: 7) == .target,
          macTopWindowVerdict([behind, docWindow], point: at, expected: 5, pid: 7) == .covered,
          macTopWindowVerdict([glowRow], point: at, expected: 5, pid: 7) == .none else {
        throw AxonError("contract_test_failed", "Occlusion check refuses an app's own alert or lets a covering window through.")
    }
    let cardPanel = MacAccessPrompt.makePanel(NSRect(x: 0, y: 0, width: 100, height: 100))
    guard !cardPanel.hidesOnDeactivate, cardPanel.sharingType == .none, cardPanel.level == .modalPanel,
          cardPanel.collectionBehavior.contains(.canJoinAllSpaces), cardPanel.collectionBehavior.contains(.fullScreenAuxiliary) else {
        throw AxonError("contract_test_failed", "The access card could hide while the helper is inactive, or be captured.")
    }
    guard shortCard.title == "Allow this application for this session?", !shortCard.bodyScrolls, shortCard.body.string == "Calculator",
          longCard.bodyScrolls, longCard.scroll.frame.height == MacDesign.promptBodyMost, longCard.body.frame.height > MacDesign.promptBodyMost,
          longCard.body.string.components(separatedBy: "\n").count == 80,
          untitled.title == "Allow one sensitive action?", untitled.body.string.hasPrefix("no newline"),
          shortCard.card.width == MacDesign.promptWidth, shortCard.deny.keyEquivalent.isEmpty,
          shortCard.deny.nextKeyView === shortCard.allow,
          shortCard.allow.frame.maxX + MacDesign.promptButtonGap - 2 * MacDesign.promptRing <= shortCard.deny.frame.minX + 0.001 else {
        throw AxonError("contract_test_failed", "Access prompt content or layout differs.")
    }
    // The window glow's maths (pure; nothing is shown).
    let glowWindow = CGRect(x: 46, y: 46, width: 300, height: 200)
    guard MacGlowShape.alpha(0) > 0.8, MacGlowShape.alpha(MacGlowShape.reach) == 0, MacGlowShape.alpha(-MacGlowShape.lip * 1.6) == 0, MacGlowShape.alpha(-MacGlowShape.lip) < 0.05,
          MacGlowShape.alpha(10) < MacGlowShape.alpha(5), MacGlowShape.alpha(5) < MacGlowShape.alpha(0),
          abs(MacGlowShape.distance(46, 146, glowWindow, 10)) < 0.001, MacGlowShape.distance(0, 146, glowWindow, 10) == 46,
          MacGlowShape.distance(196, 146, glowWindow, 10) < -50,
          MacGlowShape.distance(36, 36, glowWindow, 10) > hypot(10, 10) else {
        throw AxonError("contract_test_failed", "Glow falloff or rounded-edge distance differs.")
    }
    // A full-screen window has no outside: its edges are lit inside, from the
    // edge inward, and its middle stays clear.
    let fullWindow = CGRect(x: 0, y: 0, width: 400, height: 300)
    let allInside = MacGlowShape.inside(window: fullWindow, screen: fullWindow)
    guard allInside == MacGlowShape.Inside(left: true, right: true, bottom: true, top: true),
          MacGlowShape.inside(window: CGRect(x: 100, y: 100, width: 200, height: 100), screen: fullWindow) == MacGlowShape.Inside(),
          let fullMask = MacGlowShape.mask(size: fullWindow.size, window: fullWindow, inside: allInside),
          let fullData = fullMask.dataProvider?.data, let fullBytes = CFDataGetBytePtr(fullData),
          fullBytes[150 * fullMask.bytesPerRow + 2] > 150, fullBytes[150 * fullMask.bytesPerRow + 200] == 0,
          fullBytes[150 * fullMask.bytesPerRow + 30] < fullBytes[150 * fullMask.bytesPerRow + 2],
          MacGlowShape.alpha(30, spread: 0.35) < MacGlowShape.alpha(30) else {
        throw AxonError("contract_test_failed", "Full-screen edges are not lit inside, or the entrance band does not widen.")
    }
    // The glow reaches past a window at the top of the screen; AppKit must not
    // push its panel down under the menu bar, or the band shifts off its window.
    if let screen = NSScreen.main {
        let reach = NSRect(x: screen.frame.minX + 40, y: screen.frame.maxY - 300, width: 400, height: 346)
        let probe = MacGlowPanel(contentRect: reach, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        probe.level = .normal; probe.alphaValue = 0; probe.ignoresMouseEvents = true
        probe.setFrame(reach, display: false); probe.orderFrontRegardless(); probe.setFrame(reach, display: false)
        let kept = probe.frame; probe.orderOut(nil)
        guard kept == reach else { throw AxonError("contract_test_failed", "The glow panel was moved off its window's frame.") }
    }
    guard let glowMask = MacGlowShape.mask(size: CGSize(width: 392, height: 292), window: glowWindow),
          let glowBytes = glowMask.dataProvider?.data as Data?, glowMask.width == 392, glowMask.height == 292 else {
        throw AxonError("contract_test_failed", "Glow mask was not produced.")
    }
    func glowAlpha(_ x: Int, _ y: Int) -> UInt8 { glowBytes[(glowMask.height - 1 - y) * glowMask.bytesPerRow + x] }
    // Transparent centre and outer corner, a lit edge, and no hard step outward.
    guard glowAlpha(196, 146) == 0, glowAlpha(0, 0) <= 1, glowAlpha(46, 146) > 180,
          // Outward from the edge (the peak sits on the window's edge) it only falls.
          (1..<40).allSatisfy({ Int(glowAlpha(46 - $0, 146)) >= Int(glowAlpha(45 - $0, 146)) - 1 }), glowAlpha(0, 146) == 0, glowAlpha(2, 146) <= 1,
          (0..<40).allSatisfy({ abs(Int(glowAlpha(45 - $0, 146)) - Int(glowAlpha(46 - $0, 146))) <= 24 }) else {
        throw AxonError("contract_test_failed", "Glow mask has a hard edge, a lit centre or a visible rectangle.")
    }
    let glowList: [[String: Any]] = [
        [kCGWindowOwnerPID as String: NSNumber(value: 70), kCGWindowLayer as String: NSNumber(value: 0), kCGWindowNumber as String: NSNumber(value: 11),
         kCGWindowBounds as String: ["X": 100, "Y": 100, "Width": 800, "Height": 600]],
        [kCGWindowOwnerPID as String: NSNumber(value: 70), kCGWindowLayer as String: NSNumber(value: 0), kCGWindowNumber as String: NSNumber(value: 12),
         kCGWindowBounds as String: ["X": 300, "Y": 200, "Width": 400, "Height": 300]],
        [kCGWindowOwnerPID as String: NSNumber(value: 71), kCGWindowLayer as String: NSNumber(value: 0), kCGWindowNumber as String: NSNumber(value: 13),
         kCGWindowBounds as String: ["X": 100, "Y": 100, "Width": 800, "Height": 600]],
        [kCGWindowOwnerPID as String: NSNumber(value: 70), kCGWindowLayer as String: NSNumber(value: 25), kCGWindowNumber as String: NSNumber(value: 14),
         kCGWindowBounds as String: ["X": 300, "Y": 200, "Width": 400, "Height": 300]],
    ]
    guard MacWindowGlow.matchWindow(pid: 70, rect: CGRect(x: 301, y: 199, width: 400, height: 301), list: glowList)?.0 == 12,
          MacWindowGlow.matchWindow(pid: 70, rect: CGRect(x: 100, y: 100, width: 800, height: 600), list: glowList)?.0 == 11,
          MacWindowGlow.matchWindow(pid: 72, rect: CGRect(x: 100, y: 100, width: 800, height: 600), list: glowList) == nil,
          MacWindowGlow.matchWindow(pid: 70, rect: CGRect(x: 600, y: 600, width: 100, height: 100), list: glowList) == nil else {
        throw AxonError("contract_test_failed", "Glow window matching differs.")
    }
    guard MacWindowGlow.appKit(CGPoint(x: 120, y: 100), primaryHeight: 900) == CGPoint(x: 120, y: 800),
          MacWindowGlow.appKit(CGRect(x: 10, y: 20, width: 300, height: 200), primaryHeight: 900) == CGRect(x: 10, y: 680, width: 300, height: 200) else {
        throw AxonError("contract_test_failed", "Glow coordinate conversion differs.")
    }
    guard MacGlowLevel.soft.gain < MacGlowLevel.medium.gain, MacGlowLevel.medium.gain < MacGlowLevel.bright.gain,
          MacGlowLevel(rawValue: "soft") == .soft, MacGlowLevel(rawValue: "loud") == nil else {
        throw AxonError("contract_test_failed", "Glow brightness levels differ.")
    }
    // Bar placement: docks, clamp, settle and avoidance (pure; AppKit coordinates).
    let barWork = CGRect(x: 0, y: 0, width: 1440, height: 875), barSize = MacVisuals.barSize
    guard MacBarPlacement.dockOrigin("top-centre", size: barSize, work: barWork) == CGPoint(x: 500, y: 809),
          MacBarPlacement.dockOrigin("bottom-left", size: barSize, work: barWork) == CGPoint(x: 12, y: 18),
          MacBarPlacement.dockOrigin("top-right", size: barSize, work: barWork) == CGPoint(x: 988, y: 809),
          MacBarPlacement.dockOrigin("middle", size: barSize, work: barWork) == nil,
          MacBarPlacement.clamp(CGPoint(x: -500, y: 5000), size: barSize, work: barWork) == CGPoint(x: 12, y: 815),
          MacBarPlacement.settle(CGPoint(x: 510, y: 803), size: barSize, work: barWork).dock == "top-centre",
          MacBarPlacement.settle(CGPoint(x: 510, y: 803), size: barSize, work: barWork).origin == CGPoint(x: 500, y: 809),
          MacBarPlacement.settle(CGPoint(x: 530, y: 803), size: barSize, work: barWork).dock == "free",
          MacBarPlacement.settle(CGPoint(x: 700, y: 400), size: barSize, work: barWork).dock == "free" else {
        throw AxonError("contract_test_failed", "Bar docks, clamp or snapping differ.")
    }
    let freeLanding = MacBarPlacement.settle(CGPoint(x: 700, y: 400), size: barSize, work: barWork)
    let freeHome = MacBarPlacement.home(dock: "free", fraction: freeLanding.fraction, size: barSize, work: barWork)
    guard abs(freeHome.x - 700) < 0.5, abs(freeHome.y - 400) < 0.5,
          MacBarPlacement.home(dock: "free", fraction: CGPoint(x: 9, y: -9), size: barSize, work: barWork) == CGPoint(x: 988, y: 815),
          MacBarPlacement.home(dock: "bottom-centre", fraction: .zero, size: barSize, work: barWork) == CGPoint(x: 500, y: 18) else {
        throw AxonError("contract_test_failed", "Bar home from a free fraction differs.")
    }
    let barAtTop = CGRect(origin: CGPoint(x: 500, y: 809), size: barSize)
    guard MacBarPlacement.avoid(hud: barAtTop, target: CGRect(x: 100, y: 100, width: 10, height: 10), work: barWork) == barAtTop,
          MacBarPlacement.avoid(hud: barAtTop, target: CGRect(x: 700, y: 830, width: 4, height: 4), work: barWork)?.minY == 815,
          MacBarPlacement.avoid(hud: barAtTop, target: CGRect(x: 700, y: 830, width: 4, height: 4), work: barWork)?.minX == 12,
          MacBarPlacement.avoid(hud: barAtTop, target: CGRect(x: 100, y: 830, width: 700, height: 4), work: barWork)?.minX == 988,
          MacBarPlacement.avoid(hud: barAtTop, target: CGRect(x: 0, y: 0, width: 1440, height: 875), work: barWork) == nil,
          MacBarPlacement.avoid(hud: barAtTop, target: CGRect(x: 700, y: 830, width: 0, height: 4), work: barWork) == nil else {
        throw AxonError("contract_test_failed", "Bar avoidance differs from WindowGeometry.AvoidHud.")
    }
    emit(["ok": true, "control_contract": 1, "checks": ["shared state codec", "own HUD chrome excluded from occlusion", "an app's own alert above layer 0 is a valid target", "typed characters carry text without modifiers", "saved approvals expire and are capped", "malformed state refusal", "canonical approval fingerprint", "sensitive action classification", "kernel process birth identity", "native idle/paused/stopped/expired/session/monitor/Stop refusals", "empty cleanup and malformed input-journal refusal", "official Phosphor resource rendering", "bar words, states and geometry; menu layout, page timing; drag band and spring", "capture visibility and dismissal lifecycle", "access tier enforcement for target and frontmost app", "conversation-scoped remembered approvals", "confirmed-only Stop clearing", "approval completion fenced by Stop and legacy pause", "shared motion curves", "access prompt layout and placement", "access card stays visible when the helper is inactive", "window glow falloff, mask, matching and levels", "glow lit inside on full-screen edges, entrance widens, panel never moved under the menu bar", "bar docks, drag landing and avoidance", "shared Cmd/Ctrl key rule through ICU", "pixel drags and unreachable click targets stay unnamed", "polyline stroke hops match Windows"], "hud_icon_assets": iconAssets, "hud_material": "ink_surface", "desktop_input_sent": false])
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
