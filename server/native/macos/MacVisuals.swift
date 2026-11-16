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

struct MacHudStatePresentation: Equatable {
    let resolvedState: String
    let title: String
    // There is no toggle: no Pause, no Resume and no Re-arm. Stop and the
    // settings menu are the bar's only controls.
    let stopTitle: String
    let stopSymbol: String
    let stopAccessibilityLabel: String
    let isEmergency: Bool
    let contrastTarget: Double // A design target; not measured composited contrast.
}

// Where the bar lives (docs/internal/HUD-REDESIGN.md, section 8): six docks
// per screen (top and bottom by left, centre, right) or a free place saved as a
// fraction of the work area. Pure geometry in AppKit coordinates.
enum MacBarPlacement {
    static let docks = ["top-left", "top-centre", "top-right", "bottom-left", "bottom-centre", "bottom-right"]
    static let margin: CGFloat = 12, snap: CGFloat = 12, threshold: CGFloat = 4
    static func dockOrigin(_ name: String, size: CGSize, work: CGRect) -> CGPoint? {
        guard docks.contains(name) else { return nil }
        let x = name.hasSuffix("left") ? work.minX + margin : name.hasSuffix("right") ? work.maxX - margin - size.width : work.midX - size.width / 2
        let y = name.hasPrefix("top") ? work.maxY - margin - size.height : work.minY + margin
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
    // Within snap distance of a dock the bar lands on it; elsewhere it stays.
    static func settle(_ origin: CGPoint, size: CGSize, work: CGRect) -> (dock: String, fraction: CGPoint, origin: CGPoint) {
        let placed = clamp(origin, size: size, work: work)
        for name in docks {
            if let dock = dockOrigin(name, size: size, work: work), hypot(dock.x - placed.x, dock.y - placed.y) <= snap {
                return (name, .zero, clamp(dock, size: size, work: work))
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
    var onEscape: (() -> Void)?
    // Physical pointer drags on the bar's body (never on a button, never an
    // event the agent posted). Returns true when the event was a drag.
    var onDrag: ((NSEvent) -> Bool)?
    override func sendEvent(_ event: NSEvent) {
        if [.leftMouseDown, .leftMouseDragged, .leftMouseUp].contains(event.type),
           event.cgEvent?.getIntegerValueField(.eventSourceUserData) != AXON_EVENT_MARKER,
           onDrag?(event) == true { return }
        super.sendEvent(event)
    }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { onEscape?() }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onEscape?(); return }
        super.keyDown(with: event)
    }
}

final class MacHudButton: NSButton {
    var isEmergencyAction = false
    var hudTitle: String = "" { didSet { needsDisplay = true } }
    var hudIcon: MacPhosphorIcon = .slidersHorizontalFill { didSet { needsDisplay = true } }
    var onEscape: (() -> Void)?
    override var acceptsFirstResponder: Bool { true }
    override var focusRingMaskBounds: NSRect { bounds.insetBy(dx: 1, dy: 1) }
    override func drawFocusRingMask() {
        let r = focusRingMaskBounds
        NSBezierPath(roundedRect: r, xRadius: r.height / 2, yRadius: r.height / 2).fill()
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onEscape?(); return }
        if event.keyCode == 36 || event.keyCode == 49 {
            performClick(self)
            return
        }
        super.keyDown(with: event)
    }
    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        needsDisplay = true
        return ok
    }
    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder()
        needsDisplay = true
        return ok
    }
    override func draw(_ dirtyRect: NSRect) {
        let pillRect = bounds.insetBy(dx: 1, dy: 1)
        let pill = NSBezierPath(roundedRect: pillRect, xRadius: pillRect.height / 2, yRadius: pillRect.height / 2)
        if isHighlighted {
            if isEmergencyAction { NSColor(calibratedRed: 0.48, green: 0.16, blue: 0.22, alpha: 0.55).setFill() }
            else { NSColor(calibratedWhite: 1.0, alpha: 0.16).setFill() }
            pill.fill()
        }

        let fg = NSColor(calibratedWhite: 0.99, alpha: 1.0)
        if hudTitle.isEmpty {
            let iconSize: CGFloat = 15
            let iconRect = NSRect(x: (bounds.width - iconSize) / 2, y: (bounds.height - iconSize) / 2, width: iconSize, height: iconSize)
            if !hudIcon.drawFilled(in: iconRect) { drawFallbackLabel(in: bounds) }
        } else {
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 12.5, weight: .semibold),
                .foregroundColor: fg
            ]
            let attrTitle = NSAttributedString(string: hudTitle, attributes: attrs)
            let textSize = attrTitle.size()
            let iconSize: CGFloat = 12.5
            let gap: CGFloat = 6
            let totalWidth = iconSize + gap + textSize.width
            let startX = (bounds.width - totalWidth) / 2
            let iconRect = NSRect(x: startX, y: (bounds.height - iconSize) / 2, width: iconSize, height: iconSize)
            _ = hudIcon.drawFilled(in: iconRect)
            attrTitle.draw(at: NSPoint(x: startX + iconSize + gap, y: (bounds.height - textSize.height) / 2))
        }
    }
    private func drawFallbackLabel(in rect: NSRect) {
        let text = NSAttributedString(string: hudIcon.fallbackLabel, attributes: [.font: NSFont.systemFont(ofSize: 10), .foregroundColor: NSColor.white])
        let size = text.size()
        text.draw(at: NSPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2))
    }
}

final class MacVisuals: NSObject {
    var onStop: (() -> Void)?, onEnd: (() -> Void)?
    var panel: MacControlPanel?
    var rootView: NSView?
    var contentContainer: NSView?
    var label = NSTextField(labelWithString: "")
    var stop = MacHudButton(), more = MacHudButton()
    // The light around the window in use replaced the old screen-edge rings.
    let windowGlow = MacWindowGlow()
    private var glowLevelLoaded = false
    var pointer: NSPanel?
    var hiddenDisplays: [CGDirectDisplayID] = []
    var state = "idle"
    private var visibility = MacHudVisibility()
    var captureHidden: Bool { visibility.captureHidden }
    var hoverChecked = Date.distantPast
    let origin = ProcessInfo.processInfo.systemUptime
    var visible: Bool { panel?.isVisible == true }
    // The bar's home: a dock or a free fraction, saved in control-preferences.json.
    var dock = "top-centre", dockFraction = CGPoint(x: 0.5, y: 0)
    var displaced = false, displacedAt = Date.distantPast
    private var dragArmed = false, dragging = false, dragGrab = CGPoint.zero, dragStart = CGPoint.zero
    var cursorApplied: Bool { !hiddenDisplays.isEmpty }

    static var nativeGlassCompiled: Bool {
        #if AGCU_MACOS26_SDK
        return true
        #else
        return false
        #endif
    }
    static func makeMaterial(frame: NSRect, content: NSView) -> NSView {
        #if AGCU_MACOS26_SDK
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView(frame: frame)
            glass.style = .regular
            glass.cornerRadius = frame.height / 2
            glass.contentView = content
            glass.appearance = NSAppearance(named: .darkAqua)
            glass.wantsLayer = true
            return glass
        }
        #endif
        let effect = NSVisualEffectView(frame: frame)
        effect.material = .hudWindow; effect.blendingMode = .behindWindow; effect.state = .active
        effect.wantsLayer = true; effect.layer?.cornerRadius = frame.height / 2; effect.layer?.masksToBounds = true
        effect.appearance = NSAppearance(named: .darkAqua)
        effect.addSubview(content)
        return effect
    }
    static func materialBackend(for view: NSView?) -> String {
        guard let view = view else { return "not_created" }
        #if AGCU_MACOS26_SDK
        if #available(macOS 26.0, *), view is NSGlassEffectView { return "native_liquid_glass" }
        #endif
        return view is NSVisualEffectView ? "visual_effect_fallback" : "unknown"
    }

    static func statePresentation(for requested: String, latched: Bool = false) -> MacHudStatePresentation {
        let effective = MacFence.resolvedState(requested, latched: latched)
        switch effective {
        case "active":
            return MacHudStatePresentation(
                resolvedState: "active",
                title: "Antigravity is working",
                stopTitle: "Stop",
                stopSymbol: MacPhosphorIcon.stopFill.rawValue,
                stopAccessibilityLabel: "Stop computer use immediately",
                isEmergency: false,
                contrastTarget: 8.5
            )
        case "paused":
            return MacHudStatePresentation(
                resolvedState: "paused",
                title: "Paused · no control",
                stopTitle: "Stop",
                stopSymbol: MacPhosphorIcon.stopFill.rawValue,
                stopAccessibilityLabel: "Stop computer use immediately",
                isEmergency: false,
                contrastTarget: 8.5
            )
        case "stopped":
            return MacHudStatePresentation(
                resolvedState: "stopped",
                title: "Stopped · task ended",
                stopTitle: "Hide",
                stopSymbol: MacPhosphorIcon.xFill.rawValue,
                stopAccessibilityLabel: "Dismiss stopped controls",
                isEmergency: true,
                contrastTarget: 9.2
            )
        default:
            return MacHudStatePresentation(
                resolvedState: "idle",
                title: "Antigravity is ready",
                stopTitle: "Stop",
                stopSymbol: MacPhosphorIcon.stopFill.rawValue,
                stopAccessibilityLabel: "Stop computer use immediately",
                isEmergency: false,
                contrastTarget: 8.5
            )
        }
    }

    func makePanel(_ frame: NSRect, clickThrough: Bool) -> NSPanel {
        let p: NSPanel
        if clickThrough {
            p = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        } else {
            let cp = MacControlPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            cp.onEscape = { [weak self] in self?.stopControl() }
            p = cp
        }
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = !clickThrough
        p.level = .statusBar; p.hidesOnDeactivate = false; p.ignoresMouseEvents = clickThrough
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
    func build() {
        guard panel == nil else { return }
        let barWidth: CGFloat = 396, barHeight: CGFloat = 44
        let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main!
        loadPlacement()
        let origin = MacBarPlacement.home(dock: dock, fraction: dockFraction, size: CGSize(width: barWidth, height: barHeight), work: screen.visibleFrame)
        let p = makePanel(NSRect(origin: origin, size: CGSize(width: barWidth, height: barHeight)), clickThrough: false) as! MacControlPanel
        p.onDrag = { [weak self] event in self?.drag(event) ?? false }
        p.title = "Antigravity Computer Use"
        p.setAccessibilityRole(.toolbar)
        p.setAccessibilityLabel("Antigravity Computer Use Controls")

        let container = NSView(frame: NSRect(x: 0, y: 0, width: barWidth, height: barHeight))
        container.autoresizingMask = [.width, .height]

        // NSGlassEffectView is AppKit's public macOS 26 material. The SDK gate
        // keeps source builds working with older SDKs; runtime availability
        // preserves the macOS 14 deployment target of prebuilt bundles.
        let hostRoot = Self.makeMaterial(frame: NSRect(x: 0, y: 0, width: barWidth, height: barHeight), content: container)

        label.frame = NSRect(x: 18, y: 12, width: 206, height: 20)
        label.font = .systemFont(ofSize: 13, weight: .semibold)
        label.textColor = NSColor(calibratedWhite: 0.99, alpha: 1)
        label.lineBreakMode = .byTruncatingTail
        label.setAccessibilityIdentifier("hud-status-label")
        container.addSubview(label)

        for (button, id, action) in [(more, "hud-more", #selector(menu)), (stop, "hud-stop", #selector(stopControl))] {
            button.target = self; button.action = action; button.isBordered = false
            button.title = ""; button.image = nil
            button.focusRingType = .exterior; button.refusesFirstResponder = false
            button.setAccessibilityIdentifier(id)
            button.onEscape = { [weak self] in self?.stopControl() }
            container.addSubview(button)
        }
        stop.isEmergencyAction = true
        stop.toolTip = "Stop immediately · Esc or Control+Option+F12"
        more.hudIcon = .slidersHorizontalFill
        more.hudTitle = ""
        more.setAccessibilityLabel("Control settings")
        more.toolTip = "Settings: glow brightness and End"
        more.nextKeyView = stop; stop.nextKeyView = more
        p.initialFirstResponder = stop
        p.contentView = hostRoot; panel = p; rootView = hostRoot; contentContainer = container

        if !glowLevelLoaded, !MacFence.file.isEmpty {
            windowGlow.level = MacGlowLevel.saved(in: URL(fileURLWithPath: MacFence.file).deletingLastPathComponent()); glowLevelLoaded = true
        }
        let cursor = makePanel(NSRect(x: 0, y: 0, width: 40, height: 40), clickThrough: true)
        cursor.contentView = MacPointerView(frame: NSRect(x: 0, y: 0, width: 40, height: 40)); pointer = cursor
        writeHudBounds(p.frame)
    }
    func layoutControls(for presentation: MacHudStatePresentation) {
        #if AGCU_MACOS26_SDK
        if #available(macOS 26.0, *), let glass = rootView as? NSGlassEffectView {
            // Regular glass supplies adaptive contrast; avoid painting an
            // opaque slab over the native material. Colour reinforces state.
            glass.tintColor = presentation.isEmergency ? NSColor.systemRed.withAlphaComponent(0.18) : .clear
        }
        #endif
        if let glass = rootView as? NSVisualEffectView {
            if presentation.isEmergency {
                glass.layer?.backgroundColor = NSColor(calibratedRed: 0.42, green: 0.06, blue: 0.08, alpha: 0.88).cgColor
            } else if presentation.resolvedState == "paused" {
                glass.layer?.backgroundColor = NSColor(calibratedRed: 0.14, green: 0.10, blue: 0.04, alpha: 0.50).cgColor
            } else {
                glass.layer?.backgroundColor = NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.11, alpha: 0.44).cgColor
            }
        }
        label.stringValue = presentation.title
        label.textColor = .white
        stop.hudTitle = presentation.stopTitle
        stop.hudIcon = MacPhosphorIcon(rawValue: presentation.stopSymbol) ?? .stopFill
        stop.setAccessibilityLabel(presentation.stopAccessibilityLabel)
        stop.isEmergencyAction = !presentation.isEmergency
        // Keep the controls under the human's hand in the same positions in
        // every state. The native material carries the bar, without nested pills.
        label.frame = NSRect(x: 18, y: 12, width: 246, height: 20)
        more.frame = NSRect(x: 272, y: 6, width: 32, height: 32)
        stop.frame = NSRect(x: 310, y: 6, width: 78, height: 32)
        stop.needsDisplay = true; more.needsDisplay = true
    }
    func show(_ next: String) {
        build()
        let latched = !MacFence.latch.isEmpty && MacFence.latchBlocks(MacFence.latch)
        let presentation = MacVisuals.statePresentation(for: next, latched: latched)
        let animateEntrance = visibility.requestShow()
        state = presentation.resolvedState
        layoutControls(for: presentation)
        if state != "active" { releaseCursor(); windowGlow.hide(); pointer?.orderOut(nil) }
        if !captureHidden, let p = panel {
            writeHudBounds(p.frame)
            if animateEntrance {
                // Appear: opacity and a scale from menuFrom over Normal, easing
                // out. Reduce Motion keeps a short fade and drops the scale.
                let reduceMotion = MacDesign.reduceMotion
                p.alphaValue = 0.0
                if let layer = rootView?.layer {
                    layer.transform = reduceMotion ? CATransform3DIdentity : CATransform3DMakeScale(MacDesign.menuFrom, MacDesign.menuFrom, 1.0)
                }
                p.orderFrontRegardless()
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = reduceMotion ? MacDesign.fast : MacDesign.normal
                    context.timingFunction = MacDesign.easeOut
                    context.allowsImplicitAnimation = true
                    p.animator().alphaValue = 1.0
                    rootView?.layer?.transform = CATransform3DIdentity
                }
            } else {
                p.alphaValue = 1.0
                rootView?.layer?.transform = CATransform3DIdentity
                p.orderFrontRegardless()
            }
        }
        if state == "active" && !captureHidden { applyCursor(); animate() }
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
        panel?.alphaValue = 1.0
        rootView?.layer?.transform = CATransform3DIdentity
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
        visibility.beginCapture(); panel?.orderOut(nil); windowGlow.panel?.orderOut(nil); pointer?.orderOut(nil)
        clearHudBounds() // Hidden controls must not suppress real takeover input.
    }
    func finishCapture(_ state: String) {
        let restore = visibility.endCapture()
        if restore && (state == "active" || state == "paused" || state == "stopped") { show(state) }
        else { hide() }
        // The glow marks the window in use whether or not the bar is shown.
        if state == "active" && windowGlow.shown { windowGlow.panel?.orderFrontRegardless() }
    }
    func activity(_ action: String) { /* The persistent state label stays calm between actions. */ }
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
        let reduce = MacDesign.reduceMotion
        let ui = MacContract.value["ui"] as? [String: Any] ?? [:]
        let configuredSeconds = ui["breath_seconds"] as? Double ?? 4.0
        let configuredBase = ui["breath_base"] as? Double ?? 0.82
        let configuredAmplitude = ui["breath_amplitude"] as? Double ?? 0.18
        let seconds = configuredSeconds.isFinite && (1.0...30.0).contains(configuredSeconds) ? configuredSeconds : 4.0
        let base = configuredBase.isFinite && (0.0...1.0).contains(configuredBase) ? configuredBase : 0.82
        let amplitude = configuredAmplitude.isFinite && (0.0...1.0).contains(configuredAmplitude) ? configuredAmplitude : 0.18
        let alpha = reduce ? 0.94 : max(0, min(1, base + amplitude * sin((ProcessInfo.processInfo.systemUptime - origin) * .pi * 2 / seconds)))
        _ = alpha
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
    @objc func stopControl() { if state == "stopped" { hide() } else { onStop?() } }
    @objc func endControl() { onEnd?() }
    @objc func menu() {
        let menu = NSMenu()
        // Human input never pauses the agent; there is no takeover mode.
        let heading = NSMenuItem(title: "Glow brightness", action: nil, keyEquivalent: ""); heading.isEnabled = false; menu.addItem(heading)
        for level in MacGlowLevel.allCases {
            let item = NSMenuItem(title: level.title, action: #selector(changeGlow(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = level.rawValue; item.state = windowGlow.level == level ? .on : .off; menu.addItem(item)
        }
        menu.addItem(.separator())
        let move = NSMenuItem(title: "Move bar", action: nil, keyEquivalent: ""), docks = NSMenu()
        for name in MacBarPlacement.docks {
            let item = NSMenuItem(title: name.replacingOccurrences(of: "-", with: " ").capitalized, action: #selector(moveToDock(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = name; item.state = dock == name ? .on : .off; docks.addItem(item)
        }
        docks.addItem(.separator())
        let reset = NSMenuItem(title: "Reset", action: #selector(moveToDock(_:)), keyEquivalent: ""); reset.target = self; reset.representedObject = "top-centre"; docks.addItem(reset)
        move.submenu = docks; menu.addItem(move)
        menu.addItem(.separator())
        let hint = NSMenuItem(title: "Esc always stops immediately", action: nil, keyEquivalent: "")
        hint.isEnabled = false; menu.addItem(hint)
        let end = NSMenuItem(title: "End session and hide", action: #selector(endControl), keyEquivalent: "")
        end.target = self; menu.addItem(end)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: 0), in: more)
    }
    var preferenceDirectory: URL? { MacFence.file.isEmpty ? nil : URL(fileURLWithPath: MacFence.file).deletingLastPathComponent() }
    func loadPlacement() {
        guard let dir = preferenceDirectory,
              let value = (try? Data(contentsOf: dir.appendingPathComponent("control-preferences.json"))).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) else { return }
        if let saved = value["bar_dock"] as? String, MacBarPlacement.docks.contains(saved) { dock = saved }
        else if value["bar_dock"] as? String == "free", let x = (value["bar_x"] as? NSNumber)?.doubleValue, let y = (value["bar_y"] as? NSNumber)?.doubleValue,
                (0...1).contains(x), (0...1).contains(y) { dock = "free"; dockFraction = CGPoint(x: x, y: y) }
    }
    func savePlacement() {
        guard let dir = preferenceDirectory else { return }
        let path = dir.appendingPathComponent("control-preferences.json")
        var value = (try? Data(contentsOf: path)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        value["bar_dock"] = dock
        if dock == "free" { value["bar_x"] = Double(dockFraction.x); value["bar_y"] = Double(dockFraction.y) } else { value.removeValue(forKey: "bar_x"); value.removeValue(forKey: "bar_y") }
        if let bytes = try? JSONSerialization.data(withJSONObject: value) { try? bytes.write(to: path, options: [.atomic]); chmod(path.path, 0o600) }
    }
    var workArea: CGRect { (panel?.screen ?? NSScreen.main)?.visibleFrame ?? .zero }
    // Drag: 4 pt before it starts, 1:1 from the grab point, clamped inside the
    // work area, landing on a dock within 12 pt. Dragging never changes state,
    // access or visibility, and a press on a button is never a drag.
    func drag(_ event: NSEvent) -> Bool {
        guard let p = panel else { return false }
        switch event.type {
        case .leftMouseDown:
            if [more, stop].contains(where: { $0.convert($0.bounds, to: nil).contains(event.locationInWindow) }) { return false }
            dragArmed = true; dragging = false; dragGrab = NSEvent.mouseLocation; dragStart = p.frame.origin
            return true
        case .leftMouseDragged:
            guard dragArmed else { return false }
            let now = NSEvent.mouseLocation, dx = now.x - dragGrab.x, dy = now.y - dragGrab.y
            if !dragging && hypot(dx, dy) < MacBarPlacement.threshold { return true }
            dragging = true
            let screen = NSScreen.screens.first(where: { $0.frame.contains(now) })?.visibleFrame ?? workArea
            p.setFrameOrigin(MacBarPlacement.clamp(CGPoint(x: dragStart.x + dx, y: dragStart.y + dy), size: p.frame.size, work: screen))
            writeHudBounds(p.frame)
            return true
        case .leftMouseUp:
            guard dragArmed else { return false }
            dragArmed = false
            guard dragging else { return true }
            dragging = false
            let landing = MacBarPlacement.settle(p.frame.origin, size: p.frame.size, work: workArea)
            dock = landing.dock; dockFraction = landing.fraction; displaced = false
            moveBar(to: landing.origin, duration: MacDesign.normal)
            savePlacement()
            return true
        default: return false
        }
    }
    func moveBar(to origin: CGPoint, duration: TimeInterval) {
        guard let p = panel else { return }
        let target = NSRect(origin: origin, size: p.frame.size)
        writeHudBounds(target)
        if duration <= 0 || MacDesign.reduceMotion { p.setFrame(target, display: true); return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration; context.timingFunction = MacDesign.easeInOut
            p.animator().setFrame(target, display: true)
        }
    }
    // avoid_input: step aside from a target (AppKit global rect). A jump, so
    // the reply reports the final place. Never changes Stop, state or access.
    func avoid(_ target: CGRect) -> (allowed: Bool, moved: Bool) {
        guard let p = panel, visible else { return (true, false) }
        guard let placement = MacBarPlacement.avoid(hud: p.frame, target: target, work: workArea) else { return (false, false) }
        if placement == p.frame { return (true, false) }
        p.setFrameOrigin(placement.origin); writeHudBounds(placement); displaced = true; displacedAt = Date()
        return (true, true)
    }
    // After the click that needed the space, the bar returns home.
    func returnHomeIfDue() {
        guard displaced, !dragging, Date().timeIntervalSince(displacedAt) > 1.5, let p = panel else { return }
        displaced = false
        moveBar(to: MacBarPlacement.home(dock: dock, fraction: dockFraction, size: p.frame.size, work: workArea), duration: MacDesign.slow)
    }
    @objc func moveToDock(_ item: NSMenuItem) {
        guard let name = item.representedObject as? String, let p = panel else { return }
        dock = MacBarPlacement.docks.contains(name) ? name : "top-centre"; displaced = false
        moveBar(to: MacBarPlacement.home(dock: dock, fraction: dockFraction, size: p.frame.size, work: workArea), duration: MacDesign.slow)
        savePlacement()
    }
    @objc func changeGlow(_ item: NSMenuItem) {
        guard let raw = item.representedObject as? String, let level = MacGlowLevel(rawValue: raw) else { return }
        windowGlow.level = level
        if !MacFence.file.isEmpty { level.save(in: URL(fileURLWithPath: MacFence.file).deletingLastPathComponent()) }
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

