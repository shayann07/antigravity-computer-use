// Platform renderer for the same minimal controls and original pointer artwork.
import AppKit
import CoreGraphics
import Foundation
import QuartzCore
import Darwin

// Requested visibility survives temporary capture hiding. A capture restore is
// not a new entrance, and it must not undo a later explicit Hide or End.
struct MacHudVisibility {
    private(set) var requestedVisible = false
    private(set) var captureHidden = false
    mutating func requestShow() -> Bool {
        let entrance = !requestedVisible && !captureHidden
        requestedVisible = true
        return entrance
    }
    mutating func requestHide() { requestedVisible = false }
    mutating func beginCapture() { captureHidden = true }
    mutating func endCapture() -> Bool {
        captureHidden = false
        return requestedVisible
    }
}

// Where the bar lives (docs/internal/HUD-REDESIGN.md, section 8): six docks
// per screen (top and bottom by left, centre, right) or a free place saved as a
// fraction of the work area. Pure geometry in AppKit coordinates.
enum MacBarPlacement {
    static let docks = ["top-left", "top-centre", "top-right", "bottom-left", "bottom-centre", "bottom-right"]
    // margin: the inset at the sides and the drag's rubber band; edge: a
    // dock's distance from the top or bottom (Guardian.cs HomeFor).
    static let margin: CGFloat = 12, edge: CGFloat = 18, snap: CGFloat = 12, threshold: CGFloat = 4
    static func dockOrigin(_ name: String, size: CGSize, work: CGRect) -> CGPoint? {
        guard docks.contains(name) else { return nil }
        let x = name.hasSuffix("left") ? work.minX + margin : name.hasSuffix("right") ? work.maxX - margin - size.width : work.midX - size.width / 2
        let y = name.hasPrefix("top") ? work.maxY - edge - size.height : work.minY + edge
        return CGPoint(x: x.rounded(), y: y.rounded())
    }
    static func clamp(_ origin: CGPoint, size: CGSize, work: CGRect) -> CGPoint {
        CGPoint(x: max(work.minX + margin, min(origin.x, work.maxX - margin - size.width)),
                y: max(work.minY + margin, min(origin.y, work.maxY - margin - size.height)))
    }
    // fraction: (0, 0) is the top-left of the free range, (1, 1) its bottom-right.
    static func home(dock: String, fraction: CGPoint, size: CGSize, work: CGRect) -> CGPoint {
        if let origin = dockOrigin(dock, size: size, work: work) { return clamp(origin, size: size, work: work) }
        let fx = max(0, min(1, fraction.x.isFinite ? fraction.x : 0.5)), fy = max(0, min(1, fraction.y.isFinite ? fraction.y : 0))
        let rangeX = max(0, work.width - 2 * margin - size.width), rangeY = max(0, work.height - 2 * margin - size.height)
        return clamp(CGPoint(x: work.minX + margin + fx * rangeX, y: work.maxY - margin - size.height - fy * rangeY), size: size, work: work)
    }
    // Within snap distance of a dock on both axes the bar lands on it;
    // elsewhere it stays.
    static func settle(_ origin: CGPoint, size: CGSize, work: CGRect) -> (dock: String, fraction: CGPoint, origin: CGPoint) {
        let placed = clamp(origin, size: size, work: work)
        for name in docks {
            if let dock = dockOrigin(name, size: size, work: work), abs(dock.x - placed.x) <= snap, abs(dock.y - placed.y) <= snap {
                return (name, .zero, dock)
            }
        }
        let rangeX = max(1, work.width - 2 * margin - size.width), rangeY = max(1, work.height - 2 * margin - size.height)
        let fraction = CGPoint(x: (placed.x - work.minX - margin) / rangeX, y: (work.maxY - margin - size.height - placed.y) / rangeY)
        return ("free", fraction, placed)
    }
    // Port of WindowGeometry.AvoidHud: the nearest top or bottom placement
    // that keeps the bar inside the work area and clear of the padded target.
    // nil when no placement exists; the same frame when there is no overlap.
    static func avoid(hud: CGRect, target: CGRect, work: CGRect, margin: CGFloat = 12) -> CGRect? {
        guard hud.width > 0, hud.height > 0, target.width > 0, target.height > 0, work.width >= hud.width, work.height >= hud.height else { return nil }
        let padded = target.insetBy(dx: -margin, dy: -margin)
        if !hud.intersects(padded) { return hud }
        var best: (CGRect, CGFloat)?
        for y in [work.maxY - hud.height - margin, work.minY + margin] {
            for x in [work.minX + margin, work.minX + (work.width - hud.width) / 2, work.maxX - hud.width - margin] {
                let candidate = CGRect(x: x.rounded(), y: y.rounded(), width: hud.width, height: hud.height)
                guard work.contains(candidate), !candidate.intersects(padded) else { continue }
                let score = pow(candidate.minX - hud.minX, 2) + pow(candidate.minY - hud.minY, 2)
                if best == nil || score < best!.1 { best = (candidate, score) }
            }
        }
        return best?.0
    }
}

final class MacControlPanel: NSPanel {
    // Physical pointer drags on the bar's body (never on a button, never an
    // event the agent posted). Returns true when the event was a drag.
    var onDrag: ((NSEvent) -> Bool)?
    override func sendEvent(_ event: NSEvent) {
        if [.leftMouseDown, .leftMouseDragged, .leftMouseUp].contains(event.type),
           event.cgEvent?.getIntegerValueField(.eventSourceUserData) != AXON_EVENT_MARKER,
           onDrag?(event) == true { return }
        super.sendEvent(event)
    }
    // The bar never takes keyboard focus; Esc is read by the watchdog.
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class MacVisuals: NSObject {
    var onStop: (() -> Void)?
    var panel: MacControlPanel?
    var barView: MacBarView?
    let menu = MacBarMenu()
    // The light around the window in use.
    let windowGlow = MacWindowGlow()
    private var preferencesLoaded = false
    var pointer: NSPanel?
    var hiddenDisplays: [CGDirectDisplayID] = []
    var state = "idle"
    // What line 2 says: the reason for a Stop, the last action's words, and
    // whether the session ran out. prompting: an access card is open.
    var reason = "", ended = false, prompting = false, deadlineMs: Int64 = 0
    private var activityText = "", activityAt = Date.distantPast
    var hostName = "Antigravity"
    private var hostPath = ""
    // "Show bar and glow in recordings": off by default. The runtime's own
    // screenshots hide everything regardless; the access card is always excluded.
    private(set) var recordVisuals = false
    private var visibility = MacHudVisibility()
    var captureHidden: Bool { visibility.captureHidden }
    var hoverChecked = Date.distantPast
    var visible: Bool { panel?.isVisible == true }
    // The bar's home: a dock or a free fraction, saved in control-preferences.json.
    var dock = "top-centre", dockFraction = CGPoint(x: 0.5, y: 0)
    var displaced = false, displacedAt = Date.distantPast
    private var dragArmed = false, dragging = false, dragGrab = CGPoint.zero, dragStart = CGPoint.zero
    private var dragTrail: [(Double, CGPoint)] = []
    private var spring: MacBarMotion.Spring?, springTick = 0.0, springHeld = false, motionTimer: Timer?
    private var slide: (from: CGPoint, to: CGPoint, at: Double, span: Double)?
    var cursorApplied: Bool { !hiddenDisplays.isEmpty }
    static let barSize = CGSize(width: MacBarArt.width, height: MacBarArt.height)

    func makePanel(_ frame: NSRect, clickThrough: Bool) -> NSPanel {
        let p: NSPanel = clickThrough ? NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            : MacControlPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
        p.level = .statusBar; p.hidesOnDeactivate = false; p.ignoresMouseEvents = clickThrough
        // Stop on the bar must work while an access card is modal.
        p.worksWhenModal = true
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        p.sharingType = .none; p.isReleasedWhenClosed = false
        return p
    }
    func writeHudBounds(_ frame: NSRect) {
        let quartzY = (NSScreen.screens.first?.frame.maxY ?? 0) - frame.maxY
        if let bytes = try? JSONSerialization.data(withJSONObject: [frame.minX, quartzY, frame.width, frame.height]) {
            try? bytes.write(to: URL(fileURLWithPath: MacFence.file + ".hud"), options: [.atomic]); chmod(MacFence.file + ".hud", 0o600)
        }
    }
    func loadPreferences() {
        guard !preferencesLoaded, let dir = preferenceDirectory else { return }
        preferencesLoaded = true
        windowGlow.level = MacGlowLevel.saved(in: dir)
        loadPlacement()
        let value = (try? Data(contentsOf: dir.appendingPathComponent("control-preferences.json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        recordVisuals = (value?["record_visuals"] as? Bool) == true
    }
    func build() {
        guard panel == nil else { return }
        let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main!
        loadPreferences()
        let origin = MacBarPlacement.home(dock: dock, fraction: dockFraction, size: Self.barSize, work: screen.visibleFrame)
        let p = makePanel(NSRect(origin: origin, size: Self.barSize), clickThrough: false) as! MacControlPanel
        p.onDrag = { [weak self] event in self?.drag(event) ?? false }
        p.title = "Computer Use"
        p.setAccessibilityRole(.toolbar); p.setAccessibilityLabel("Computer Use controls")
        let view = MacBarView(frame: NSRect(origin: .zero, size: Self.barSize))
        view.onStop = { [weak self] in self?.stopControl() }
        view.onSettings = { [weak self] in self?.openMenu() }
        p.contentView = view; panel = p; barView = view
        menu.onChoose = { [weak self] id in self?.menuChosen(id) }
        let cursor = makePanel(NSRect(x: 0, y: 0, width: 40, height: 40), clickThrough: true)
        cursor.contentView = MacPointerView(frame: NSRect(x: 0, y: 0, width: 40, height: 40)); pointer = cursor
        applyRecordingPreference()
        writeHudBounds(p.frame)
    }
    var lowTime: Bool { state == "active" && deadlineMs > 0 && deadlineMs - Int64(Date().timeIntervalSince1970 * 1000) < 60_000 }
    func refreshBar() {
        guard let view = barView else { return }
        if !activityText.isEmpty && Date().timeIntervalSince(activityAt) > 1.2 { activityText = "" }
        var next = MacBarModel.make(state: state, prompting: prompting, host: hostName, activity: activityText, lowTime: lowTime, reason: reason, ended: ended)
        let current = view.model
        next.stopHover = current.stopHover; next.modeHover = current.modeHover; next.stopPress = current.stopPress
        next.modePress = current.modePress; next.pressed = current.pressed; next.contrast = MacDesign.increaseContrast
        view.model = next
    }
    func show(_ next: String) {
        build()
        let latched = !MacFence.latch.isEmpty && MacFence.latchBlocks(MacFence.latch)
        let resolved = MacFence.resolvedState(next, latched: latched)
        // There is no paused presentation: a legacy paused record is no control.
        state = resolved == "paused" ? "idle" : resolved
        if state != "idle" { ended = false }
        let entrance = visibility.requestShow()
        refreshBar()
        if state != "active" { releaseCursor(); windowGlow.hide(); pointer?.orderOut(nil) }
        if !captureHidden, let p = panel {
            writeHudBounds(p.frame)
            if entrance {
                // bar.enter: opacity over Normal, easing out; a short fade with Reduce Motion.
                p.alphaValue = 0; p.orderFrontRegardless()
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = MacDesign.reduceMotion ? MacDesign.fast : MacDesign.normal
                    context.timingFunction = MacDesign.easeOut
                    p.animator().alphaValue = 1
                }
            } else { p.alphaValue = 1; p.orderFrontRegardless() }
        }
        if state == "active" && !captureHidden && !prompting { applyCursor(); animate() }
    }
    func applyCursor() {
        if cursorApplied { return }
        var displays = [CGDirectDisplayID](repeating: 0, count: 32); var count: UInt32 = 0
        guard CGGetActiveDisplayList(32, &displays, &count) == .success else { return }
        for display in displays.prefix(Int(count)) where CGDisplayHideCursor(display) == .success { hiddenDisplays.append(display) }
        if !hiddenDisplays.isEmpty { pointer?.orderFrontRegardless() }
    }
    func releaseCursor() {
        for display in hiddenDisplays { CGDisplayShowCursor(display) }
        hiddenDisplays.removeAll(); pointer?.orderOut(nil)
    }
    func hide() {
        visibility.requestHide()
        releaseCursor()
        menu.dismiss(atOnce: true)
        stopMotion()
        barView?.resetPointerState()
        panel?.alphaValue = 1
        panel?.orderOut(nil)
        windowGlow.hide(immediately: true)
        pointer?.orderOut(nil)
        clearHudBounds()
    }
    private func clearHudBounds() {
        // Never recursively delete an entry at the auxiliary bounds path.
        if !MacFence.file.isEmpty { _ = unlink(MacFence.file + ".hud") }
    }
    func hideForCapture() {
        visibility.beginCapture(); menu.dismiss(atOnce: true); panel?.orderOut(nil); windowGlow.panel?.orderOut(nil); pointer?.orderOut(nil)
        clearHudBounds() // Hidden controls must not suppress real takeover input.
    }
    // Restores the bar the human had before a capture, in whatever state it
    // is now. An explicit Hide or End during the capture keeps it hidden.
    func finishCapture(_ state: String) {
        if visibility.endCapture() { show(state) } else { hide() }
        // The glow marks the window in use whether or not the bar is shown.
        if state == "active" && windowGlow.shown { windowGlow.panel?.orderFrontRegardless() }
    }
    // An access card is open: the bar says so and keeps Stop under the
    // human's hand; the agent's pointer is put away so the OS cursor shows.
    func beginPrompt() {
        prompting = true; menu.dismiss(atOnce: true); releaseCursor(); pointer?.orderOut(nil); refreshBar()
    }
    func endPrompt() {
        prompting = false; refreshBar()
        if state == "active" && visible && !captureHidden { applyCursor() }
    }
    func activity(_ action: String) { activityText = MacBarModel.activityWords(action); activityAt = Date(); refreshBar() }
    // The runtime names its host. The icon is decorative and read from the
    // host's own app bundle; a name over 40 characters is ignored.
    func setHost(name: String?, path: String?) {
        if let name = name, !name.isEmpty, name.count <= 40, name != hostName { hostName = name; refreshBar() }
        guard let path = path, path != hostPath, path.utf8.count <= 1024 else { return }
        hostPath = path
        var bundle = URL(fileURLWithPath: path)
        while bundle.path != "/" && bundle.pathExtension != "app" { bundle.deleteLastPathComponent() }
        barView?.icon = bundle.pathExtension == "app" && FileManager.default.fileExists(atPath: bundle.path) ? NSWorkspace.shared.icon(forFile: bundle.path) : nil
    }
    // Lights the window of an approved app that received an action. The
    // guardian has already checked the grant; pid and rect come from the
    // worker's window identity (top-left global points).
    func glow(action: String, pid: pid_t, rect: CGRect, point: CGPoint? = nil) {
        guard state == "active", !captureHidden,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              let (id, bounds) = MacWindowGlow.matchWindow(pid: pid, rect: rect, list: list) else { return }
        let pointed = ["click", "move", "drag", "scroll"].contains(action)
        windowGlow.show(windowID: id, frame: MacWindowGlow.appKit(bounds), point: point ?? (pointed ? NSEvent.mouseLocation : nil), pulse: action != "observe")
    }
    func animate() {
        if captureHidden || state != "active" { return }
        refreshBar()
        windowGlow.follow()
        returnHomeIfDue()
        if cursorApplied {
            let point = NSEvent.mouseLocation
            pointer?.setFrameOrigin(NSPoint(x: point.x - 4, y: point.y - 38))
            if pointer?.isVisible != true { pointer?.orderFrontRegardless() }
            if Date().timeIntervalSince(hoverChecked) >= 0.15 {
                hoverChecked=Date();var insertion=false
                if let location=CGEvent(source:nil)?.location,
                   let element=elementAt(Int(location.x),Int(location.y)) {
                    var pid: pid_t=0
                    if AXUIElementGetPid(element,&pid) == .success,
                       let identity=try? macIdentity(pid), let key=identity["key"] as? String,
                       let control=try? MacFence.read(), control.grants.contains(key) {
                        AXUIElementSetMessagingTimeout(element,0.08)
                        let role=axString(element,kAXRoleAttribute as String) ?? ""
                        insertion=["AXTextField","AXTextArea","AXComboBox"].contains(role)
                    }
                }
                if let view=pointer?.contentView as? MacPointerView,view.textInsertion != insertion {view.textInsertion=insertion;view.needsDisplay=true}
            }
        }
    }
    // The stop slot: Stop while working or asking, Hide when stopped or ready.
    func stopControl() { if barView?.model.slot == 2 { hide() } else { onStop?() } }

    // ---- The Settings menu (Guardian.cs MainMenu, DockMenu, MenuChosen).
    func openMenu() {
        guard let p = panel, visible else { return }
        if menu.isOpen { menu.dismiss(atOnce: false); return }
        menu.recordable = recordVisuals
        menu.open(mainMenu(), from: p)
    }
    static func dockLabel(_ name: String) -> String {
        switch name {
        case "top-left": return "Top left"; case "top-right": return "Top right"; case "bottom-left": return "Bottom left"
        case "bottom-centre": return "Bottom centre"; case "bottom-right": return "Bottom right"; case "free": return "Where you put it"
        default: return "Top centre"
        }
    }
    func mainMenu() -> [MacMenuItem] {
        [MacMenuItem(kind: "head", text: "Computer Use"),
         MacMenuItem(id: 1, text: "Show bar and glow in recordings", ticks: true, checked: recordVisuals),
         MacMenuItem(id: 2, text: "Move bar", note: Self.dockLabel(dock), chevron: true),
         // One press steps to the next level; the glow changes at once.
         MacMenuItem(id: 3, text: "Glow brightness", note: windowGlow.level.title),
         MacMenuItem(kind: "rule"), MacMenuItem(kind: "foot")]
    }
    func dockMenu() -> [MacMenuItem] {
        [MacMenuItem(kind: "head", text: "Move bar")]
            + MacBarPlacement.docks.enumerated().map { MacMenuItem(id: 10 + $0.offset, text: Self.dockLabel($0.element), ticks: true, checked: dock == $0.element) }
            + [MacMenuItem(kind: "rule"), MacMenuItem(id: 20, text: "Reset", ticks: true)]
    }
    func menuChosen(_ id: Int) {
        switch id {
        case 1: recordVisuals.toggle(); applyRecordingPreference(); savePreference("record_visuals", recordVisuals); menu.refresh(mainMenu())
        case 2: menu.swap(dockMenu())
        case 3:
            windowGlow.level = windowGlow.level == .soft ? .medium : windowGlow.level == .medium ? .bright : .soft
            if let dir = preferenceDirectory { windowGlow.level.save(in: dir) }
            menu.refresh(mainMenu())
        case 10..<(10 + MacBarPlacement.docks.count): menu.dismiss(atOnce: false); moveToDock(MacBarPlacement.docks[id - 10])
        case 20: menu.dismiss(atOnce: false); moveToDock("top-centre")
        default: break
        }
    }
    func applyRecordingPreference() {
        let sharing: NSWindow.SharingType = recordVisuals ? .readOnly : .none
        panel?.sharingType = sharing; pointer?.sharingType = sharing
        menu.recordable = recordVisuals; windowGlow.recordable = recordVisuals
    }
    var preferenceDirectory: URL? { MacFence.file.isEmpty ? nil : URL(fileURLWithPath: MacFence.file).deletingLastPathComponent() }
    func loadPlacement() {
        guard let dir = preferenceDirectory,
              let value = (try? Data(contentsOf: dir.appendingPathComponent("control-preferences.json"))).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) else { return }
        if let saved = value["bar_dock"] as? String, MacBarPlacement.docks.contains(saved) { dock = saved }
        else if value["bar_dock"] as? String == "free", let x = (value["bar_x"] as? NSNumber)?.doubleValue, let y = (value["bar_y"] as? NSNumber)?.doubleValue,
                (0...1).contains(x), (0...1).contains(y) { dock = "free"; dockFraction = CGPoint(x: x, y: y) }
    }
    private func updatePreferences(_ change: (inout [String: Any]) -> Void) {
        guard let dir = preferenceDirectory else { return }
        let path = dir.appendingPathComponent("control-preferences.json")
        var value = (try? Data(contentsOf: path)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        change(&value)
        if let bytes = try? JSONSerialization.data(withJSONObject: value) { try? bytes.write(to: path, options: [.atomic]); chmod(path.path, 0o600) }
    }
    func savePreference(_ key: String, _ value: Any) { updatePreferences { $0[key] = value } }
    func savePlacement() {
        updatePreferences { value in
            value["bar_dock"] = dock
            if dock == "free" { value["bar_x"] = Double(dockFraction.x); value["bar_y"] = Double(dockFraction.y) } else { value.removeValue(forKey: "bar_x"); value.removeValue(forKey: "bar_y") }
        }
    }
    var workArea: CGRect { (panel?.screen ?? NSScreen.main)?.visibleFrame ?? .zero }

    // ---- bar.drag and bar.settle. 4 pt before a drag starts, then 1:1 from
    // the grab point with a rubber band past the inset; on release it lands
    // on a dock within 12 pt and springs there from the speed it was let go
    // at. Dragging never changes state, access or visibility, and a press on
    // a button is never a drag.
    func drag(_ event: NSEvent) -> Bool {
        guard let p = panel, let view = barView else { return false }
        switch event.type {
        case .leftMouseDown:
            if view.buttonAt(window: event.locationInWindow) != 0 { return false }
            dragArmed = true; dragging = false; dragGrab = NSEvent.mouseLocation; dragStart = p.frame.origin
            // A new grab holds a settling bar where it is.
            if spring != nil { spring = nil; springHeld = true }
            slide = nil
            return true
        case .leftMouseDragged:
            guard dragArmed else { return false }
            let now = NSEvent.mouseLocation, dx = now.x - dragGrab.x, dy = now.y - dragGrab.y
            if !dragging && abs(dx) < MacBarPlacement.threshold && abs(dy) < MacBarPlacement.threshold { return true }
            if !dragging { dragging = true; springHeld = false; dragTrail.removeAll(); menu.dismiss(atOnce: true) }
            let work = NSScreen.screens.first(where: { $0.frame.contains(now) })?.visibleFrame ?? workArea, m = MacBarPlacement.margin
            let origin = CGPoint(x: MacBarMotion.band(dragStart.x + dx, low: work.minX, high: work.maxX - p.frame.width, margin: m),
                                 y: MacBarMotion.band(dragStart.y + dy, low: work.minY, high: work.maxY - p.frame.height, margin: m))
            p.setFrameOrigin(origin); writeHudBounds(p.frame)
            let t = CACurrentMediaTime(); dragTrail.append((t, origin))
            while dragTrail.count > 2 && t - dragTrail[0].0 > MacBarMotion.trail { dragTrail.removeFirst() }
            return true
        case .leftMouseUp:
            guard dragArmed else { return false }
            dragArmed = false
            if dragging { dragging = false; settle() }
            // A grab that never became a drag lets the spring carry on.
            else if springHeld, let target = heldTarget { springHeld = false; springTo(target, speed: .zero) }
            return true
        default: return false
        }
    }
    private var heldTarget: CGPoint? { panel.map { MacBarPlacement.home(dock: dock, fraction: dockFraction, size: $0.frame.size, work: workArea) } }
    // The speed the bar was let go at, from the last moments of the drag.
    private func releaseSpeed() -> CGPoint {
        let now = CACurrentMediaTime(), recent = dragTrail.filter { now - $0.0 <= MacBarMotion.trail }; dragTrail.removeAll()
        guard let a = recent.first, let b = recent.last, b.0 > a.0 else { return .zero }
        return CGPoint(x: (b.1.x - a.1.x) / (b.0 - a.0), y: (b.1.y - a.1.y) / (b.0 - a.0))
    }
    private func settle() {
        guard let p = panel else { return }
        let speed = releaseSpeed()
        let landing = MacBarPlacement.settle(p.frame.origin, size: p.frame.size, work: workArea)
        dock = landing.dock; dockFraction = landing.fraction; displaced = false
        springTo(landing.origin, speed: speed)
        savePlacement()
    }
    private func springTo(_ target: CGPoint, speed: CGPoint) {
        guard let p = panel else { return }
        slide = nil; springHeld = false; writeHudBounds(NSRect(origin: target, size: p.frame.size))
        // Reduce Motion: the bar is simply there.
        if MacDesign.reduceMotion { spring = nil; p.setFrameOrigin(target); return }
        spring = MacBarMotion.Spring(x: p.frame.minX, y: p.frame.minY, vx: speed.x, vy: speed.y, to: target)
        springTick = CACurrentMediaTime(); startMotion()
    }
    // Moving to a dock from the menu or back home eases in and out.
    func moveBar(to origin: CGPoint, duration: TimeInterval) {
        guard let p = panel else { return }
        spring = nil; springHeld = false
        writeHudBounds(NSRect(origin: origin, size: p.frame.size))
        if duration <= 0 || MacDesign.reduceMotion || p.frame.origin == origin { slide = nil; p.setFrameOrigin(origin); return }
        slide = (p.frame.origin, origin, CACurrentMediaTime(), duration); startMotion()
    }
    private func startMotion() {
        guard motionTimer == nil else { return }
        let t = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.motionStep() }
        RunLoop.main.add(t, forMode: .common); motionTimer = t
    }
    private func stopMotion() { motionTimer?.invalidate(); motionTimer = nil; spring = nil; slide = nil }
    private func motionStep() {
        guard let p = panel else { stopMotion(); return }
        let now = CACurrentMediaTime(); var busy = false
        if var s = spring {
            let elapsed = now - springTick; springTick = now
            if MacBarMotion.advance(&s, elapsed: elapsed) {
                let work = workArea, m = MacBarPlacement.margin
                p.setFrameOrigin(CGPoint(x: MacBarMotion.band(s.x, low: work.minX, high: work.maxX - p.frame.width, margin: m),
                                         y: MacBarMotion.band(s.y, low: work.minY, high: work.maxY - p.frame.height, margin: m)))
                spring = s; busy = true
            } else { spring = nil; p.setFrameOrigin(s.to) }
        }
        if let s = slide {
            let t = (now - s.at) / s.span
            if t >= 1 { slide = nil; p.setFrameOrigin(s.to) }
            else {
                let e = CGFloat(MacDesign.easeInOut(t))
                p.setFrameOrigin(CGPoint(x: (s.from.x + (s.to.x - s.from.x) * e).rounded(), y: (s.from.y + (s.to.y - s.from.y) * e).rounded())); busy = true
            }
        }
        if !busy { motionTimer?.invalidate(); motionTimer = nil }
    }
    // avoid_input: step aside from a target (AppKit global rect). A jump, so
    // the reply reports the final place. Never changes Stop, state or access.
    func avoid(_ target: CGRect) -> (allowed: Bool, moved: Bool) {
        guard let p = panel, visible else { return (true, false) }
        guard let placement = MacBarPlacement.avoid(hud: p.frame, target: target, work: workArea) else { return (false, false) }
        if placement == p.frame { return (true, false) }
        stopMotion(); menu.dismiss(atOnce: true)
        p.setFrameOrigin(placement.origin); writeHudBounds(placement); displaced = true; displacedAt = Date()
        return (true, true)
    }
    // After the click that needed the space, the bar returns home.
    func returnHomeIfDue() {
        guard displaced, !dragging, Date().timeIntervalSince(displacedAt) > 1.5, let target = heldTarget else { return }
        displaced = false
        moveBar(to: target, duration: MacDesign.slow)
    }
    func moveToDock(_ name: String) {
        guard let target = { () -> CGPoint? in dock = MacBarPlacement.docks.contains(name) ? name : "top-centre"; return heldTarget }() else { return }
        displaced = false
        moveBar(to: target, duration: MacDesign.slow)
        savePlacement()
    }
    deinit { releaseCursor() }
}

final class MacPointerView: NSView {
    var textInsertion=false
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        if textInsertion {
            let p=NSBezierPath();p.move(to:NSPoint(x:4,y:3));p.line(to:NSPoint(x:4,y:28))
            p.move(to:NSPoint(x:0,y:3));p.line(to:NSPoint(x:8,y:3));p.move(to:NSPoint(x:0,y:28));p.line(to:NSPoint(x:8,y:28))
            NSColor(calibratedWhite:0.12,alpha:0.95).setStroke();p.lineWidth=4;p.stroke()
            NSColor(calibratedRed:0.84,green:0.93,blue:0.98,alpha:1).setStroke();p.lineWidth=1.8;p.stroke();return
        }
        let p = NSBezierPath(); p.move(to: NSPoint(x: 4, y: 2)); p.line(to: NSPoint(x: 28, y: 16))
        p.curve(to: NSPoint(x: 27.8, y: 18.2), controlPoint1: NSPoint(x: 29.5, y: 17), controlPoint2: NSPoint(x: 29, y: 18))
        p.line(to: NSPoint(x: 17.3, y: 19.6)); p.line(to: NSPoint(x: 11.8, y: 28.5))
        p.curve(to: NSPoint(x: 9.6, y: 27.8), controlPoint1: NSPoint(x: 11, y: 29.8), controlPoint2: NSPoint(x: 9.9, y: 29.3))
        p.close(); NSGradient(starting: .white, ending: NSColor(calibratedRed: 0.51, green: 0.69, blue: 0.79, alpha: 1))?.draw(in: p, angle: 90)
        NSColor(calibratedRed: 0.11, green: 0.15, blue: 0.21, alpha: 0.94).setStroke(); p.lineWidth = 1.25; p.stroke()
    }
}

