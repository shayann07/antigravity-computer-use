// Platform renderer for the same minimal controls and original pointer artwork.
import AppKit
import CoreGraphics
import Foundation
import QuartzCore

enum MacPhosphorIcon: String, Equatable {
    case dotsThreeFill = "dots-three-fill"
    case pauseFill = "pause-fill"
    case playFill = "play-fill"
    case stopFill = "stop-fill"
    case xFill = "x-fill"

    // Pure filled Phosphor Icons (@phosphor-icons/core 256x256 viewBox), zero strokes.
    func drawFilled(in rect: NSRect, color: NSColor) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.saveGState()
        defer { ctx.restoreGState() }
        color.setFill()
        ctx.translateBy(x: rect.minX, y: rect.maxY)
        ctx.scaleBy(x: rect.width / 256.0, y: -rect.height / 256.0)

        switch self {
        case .dotsThreeFill:
            for cx: CGFloat in [60, 128, 196] {
                NSBezierPath(ovalIn: NSRect(x: cx - 20, y: 108, width: 40, height: 40)).fill()
            }
        case .pauseFill:
            NSBezierPath(roundedRect: NSRect(x: 48, y: 40, width: 56, height: 176), xRadius: 16, yRadius: 16).fill()
            NSBezierPath(roundedRect: NSRect(x: 152, y: 40, width: 56, height: 176), xRadius: 16, yRadius: 16).fill()
        case .playFill:
            let p = NSBezierPath()
            p.move(to: NSPoint(x: 72, y: 54))
            p.curve(to: NSPoint(x: 96, y: 42), controlPoint1: NSPoint(x: 72, y: 40), controlPoint2: NSPoint(x: 84, y: 35))
            p.line(to: NSPoint(x: 224, y: 114))
            p.curve(to: NSPoint(x: 224, y: 142), controlPoint1: NSPoint(x: 236, y: 121), controlPoint2: NSPoint(x: 236, y: 135))
            p.line(to: NSPoint(x: 96, y: 214))
            p.curve(to: NSPoint(x: 72, y: 202), controlPoint1: NSPoint(x: 84, y: 221), controlPoint2: NSPoint(x: 72, y: 216))
            p.close()
            p.fill()
        case .stopFill:
            NSBezierPath(roundedRect: NSRect(x: 44, y: 44, width: 168, height: 168), xRadius: 24, yRadius: 24).fill()
        case .xFill:
            for angle: CGFloat in [.pi / 4.0, -.pi / 4.0] {
                ctx.saveGState()
                ctx.translateBy(x: 128, y: 128)
                ctx.rotate(by: angle)
                NSBezierPath(roundedRect: NSRect(x: -92, y: -14, width: 184, height: 28), xRadius: 14, yRadius: 14).fill()
                ctx.restoreGState()
            }
        }
    }
}

struct MacHudStatePresentation: Equatable {
    let resolvedState: String
    let title: String
    let toggleTitle: String
    let toggleSymbol: String
    let toggleAccessibilityLabel: String
    let stopTitle: String
    let stopSymbol: String
    let stopAccessibilityLabel: String
    let isEmergency: Bool
    let minimumContrast: Double
}

final class MacControlPanel: NSPanel {
    var onEscape: (() -> Void)?
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
    var isPrimaryRearm = false
    var hudTitle: String = "" { didSet { needsDisplay = true } }
    var hudIcon: MacPhosphorIcon = .dotsThreeFill { didSet { needsDisplay = true } }
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
        if isPrimaryRearm {
            NSColor(calibratedRed: 0.94, green: 0.25, blue: 0.22, alpha: isHighlighted ? 0.96 : 0.86).setFill()
        } else if isEmergencyAction {
            NSColor(calibratedRed: 0.90, green: 0.22, blue: 0.21, alpha: isHighlighted ? 0.88 : 0.72).setFill()
        } else {
            NSColor(calibratedWhite: 1.0, alpha: isHighlighted ? 0.22 : 0.12).setFill()
        }
        pill.fill()

        let fg = NSColor(calibratedWhite: 0.99, alpha: 1.0)
        if hudTitle.isEmpty {
            let iconSize: CGFloat = 15
            let iconRect = NSRect(x: (bounds.width - iconSize) / 2, y: (bounds.height - iconSize) / 2, width: iconSize, height: iconSize)
            hudIcon.drawFilled(in: iconRect, color: fg)
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
            hudIcon.drawFilled(in: iconRect, color: fg)
            attrTitle.draw(at: NSPoint(x: startX + iconSize + gap, y: (bounds.height - textSize.height) / 2))
        }
    }
}

final class MacVisuals: NSObject {
    var onToggle: (() -> Void)?, onStop: (() -> Void)?, onMode: ((String) -> Void)?
    var panel: MacControlPanel?
    var rootView: NSView?
    var contentContainer: NSView?
    var label = NSTextField(labelWithString: "")
    var toggle = MacHudButton(), stop = MacHudButton(), more = MacHudButton()
    var rings: [NSPanel] = []
    var pointer: NSPanel?
    var hiddenDisplays: [CGDirectDisplayID] = []
    var state = "idle", captureHidden = false
    var hoverChecked = Date.distantPast
    let origin = ProcessInfo.processInfo.systemUptime
    var visible: Bool { panel?.isVisible == true }
    var cursorApplied: Bool { !hiddenDisplays.isEmpty }

    static func statePresentation(for requested: String, latched: Bool = false) -> MacHudStatePresentation {
        let effective = MacFence.resolvedState(requested, latched: latched)
        switch effective {
        case "active":
            return MacHudStatePresentation(
                resolvedState: "active",
                title: "Working · Esc to stop",
                toggleTitle: "",
                toggleSymbol: MacPhosphorIcon.pauseFill.rawValue,
                toggleAccessibilityLabel: "Pause computer use",
                stopTitle: "Stop",
                stopSymbol: MacPhosphorIcon.stopFill.rawValue,
                stopAccessibilityLabel: "Stop computer use immediately",
                isEmergency: false,
                minimumContrast: 8.5
            )
        case "paused":
            return MacHudStatePresentation(
                resolvedState: "paused",
                title: "Paused · Resume or Esc",
                toggleTitle: "",
                toggleSymbol: MacPhosphorIcon.playFill.rawValue,
                toggleAccessibilityLabel: "Resume computer use",
                stopTitle: "Stop",
                stopSymbol: MacPhosphorIcon.stopFill.rawValue,
                stopAccessibilityLabel: "Stop computer use immediately",
                isEmergency: false,
                minimumContrast: 8.5
            )
        case "stopped":
            return MacHudStatePresentation(
                resolvedState: "stopped",
                title: "Stopped · Re-arm required",
                toggleTitle: "Re-arm",
                toggleSymbol: MacPhosphorIcon.playFill.rawValue,
                toggleAccessibilityLabel: "Re-arm computer use",
                stopTitle: "Hide",
                stopSymbol: MacPhosphorIcon.xFill.rawValue,
                stopAccessibilityLabel: "Dismiss stopped controls",
                isEmergency: true,
                minimumContrast: 9.2
            )
        default:
            return MacHudStatePresentation(
                resolvedState: "idle",
                title: "Ready · awaiting a task",
                toggleTitle: "",
                toggleSymbol: MacPhosphorIcon.playFill.rawValue,
                toggleAccessibilityLabel: "Start or resume computer use",
                stopTitle: "Stop",
                stopSymbol: MacPhosphorIcon.stopFill.rawValue,
                stopAccessibilityLabel: "Stop computer use immediately",
                isEmergency: false,
                minimumContrast: 8.5
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
        let p = makePanel(NSRect(x: screen.frame.midX - barWidth / 2, y: screen.frame.maxY - 62, width: barWidth, height: barHeight), clickThrough: false) as! MacControlPanel
        p.title = "Antigravity Computer Use"
        p.setAccessibilityRole(.toolbar)
        p.setAccessibilityLabel("Antigravity Computer Use Controls")

        let container = NSView(frame: NSRect(x: 0, y: 0, width: barWidth, height: barHeight))
        container.autoresizingMask = [.width, .height]

        // AppKit's supported native glass surface is NSVisualEffectView. The
        // newer SwiftUI glass type is not an AppKit symbol and cannot be used
        // by this native host on the macOS SDKs used for Intel or ARM builds.
        let effect = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: barWidth, height: barHeight))
        effect.material = .hudWindow; effect.blendingMode = .behindWindow; effect.state = .active
        effect.wantsLayer = true; effect.layer?.cornerRadius = barHeight / 2; effect.layer?.masksToBounds = true
        effect.appearance = NSAppearance(named: .darkAqua)
        effect.addSubview(container)
        let hostRoot: NSView = effect

        label.frame = NSRect(x: 18, y: 12, width: 206, height: 20)
        label.font = .systemFont(ofSize: 13, weight: .semibold)
        label.textColor = NSColor(calibratedWhite: 0.99, alpha: 1)
        label.lineBreakMode = .byTruncatingTail
        label.setAccessibilityIdentifier("hud-status-label")
        container.addSubview(label)

        for (button, id, action) in [(more, "hud-more", #selector(menu)), (toggle, "hud-toggle", #selector(toggleControl)), (stop, "hud-stop", #selector(stopControl))] {
            button.target = self; button.action = action; button.isBordered = false
            button.title = ""; button.image = nil
            button.focusRingType = .exterior; button.refusesFirstResponder = false
            button.setAccessibilityIdentifier(id)
            button.onEscape = { [weak self] in self?.stopControl() }
            container.addSubview(button)
        }
        stop.isEmergencyAction = true
        stop.toolTip = "Stop immediately · Esc or Control+Option+F12"
        more.hudIcon = .dotsThreeFill
        more.hudTitle = ""
        more.setAccessibilityLabel("Control settings")
        more.toolTip = "Takeover and interruption settings"
        more.nextKeyView = toggle; toggle.nextKeyView = stop; stop.nextKeyView = more
        p.initialFirstResponder = toggle
        p.contentView = hostRoot; panel = p; rootView = hostRoot; contentContainer = container

        for screen in NSScreen.screens {
            let ring = makePanel(screen.frame, clickThrough: true)
            ring.contentView = MacGlowView(frame: NSRect(origin: .zero, size: screen.frame.size))
            rings.append(ring)
        }
        let cursor = makePanel(NSRect(x: 0, y: 0, width: 40, height: 40), clickThrough: true)
        cursor.contentView = MacPointerView(frame: NSRect(x: 0, y: 0, width: 40, height: 40)); pointer = cursor
        writeHudBounds(p.frame)
    }
    func layoutControls(for presentation: MacHudStatePresentation) {
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
        toggle.isPrimaryRearm = presentation.isEmergency
        toggle.hudTitle = presentation.toggleTitle
        toggle.hudIcon = MacPhosphorIcon(rawValue: presentation.toggleSymbol) ?? .playFill
        toggle.setAccessibilityLabel(presentation.toggleAccessibilityLabel)
        toggle.toolTip = presentation.toggleAccessibilityLabel
        stop.hudTitle = presentation.stopTitle
        stop.hudIcon = MacPhosphorIcon(rawValue: presentation.stopSymbol) ?? .stopFill
        stop.setAccessibilityLabel(presentation.stopAccessibilityLabel)
        stop.isEmergencyAction = !presentation.isEmergency
        if presentation.isEmergency {
            label.frame = NSRect(x: 18, y: 12, width: 174, height: 20)
            more.frame = NSRect(x: 196, y: 6, width: 32, height: 32)
            toggle.frame = NSRect(x: 234, y: 6, width: 84, height: 32)
            stop.frame = NSRect(x: 324, y: 6, width: 64, height: 32)
        } else {
            label.frame = NSRect(x: 18, y: 12, width: 210, height: 20)
            more.frame = NSRect(x: 234, y: 6, width: 32, height: 32)
            toggle.frame = NSRect(x: 272, y: 6, width: 32, height: 32)
            stop.frame = NSRect(x: 310, y: 6, width: 78, height: 32)
        }
        toggle.needsDisplay = true; stop.needsDisplay = true; more.needsDisplay = true
    }
    func show(_ next: String) {
        build()
        let latched = !MacFence.latch.isEmpty && MacFence.latchBlocks(MacFence.latch)
        let presentation = MacVisuals.statePresentation(for: next, latched: latched)
        let wasVisible = panel?.isVisible == true
        state = presentation.resolvedState
        layoutControls(for: presentation)
        if state != "active" { releaseCursor(); rings.forEach { $0.orderOut(nil) }; pointer?.orderOut(nil) }
        if !captureHidden, let p = panel {
            writeHudBounds(p.frame)
            let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            if !wasVisible && !reduceMotion {
                p.alphaValue = 0.0
                if let layer = rootView?.layer {
                    layer.transform = CATransform3DMakeScale(0.96, 0.96, 1.0)
                }
                p.orderFrontRegardless()
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = 0.16
                    context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                    p.animator().alphaValue = 1.0
                    rootView?.layer?.transform = CATransform3DIdentity
                }
            } else {
                p.alphaValue = 1.0
                rootView?.layer?.transform = CATransform3DIdentity
                p.orderFrontRegardless()
            }
        }
        if state == "active" && !captureHidden { applyCursor(); rings.forEach { $0.orderFrontRegardless() }; animate() }
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
        releaseCursor()
        panel?.alphaValue = 1.0
        rootView?.layer?.transform = CATransform3DIdentity
        panel?.orderOut(nil)
        rings.forEach { $0.orderOut(nil) }
        pointer?.orderOut(nil)
        if !MacFence.file.isEmpty {
            try? FileManager.default.removeItem(atPath: MacFence.file + ".hud")
        }
    }
    func hideForCapture() { captureHidden = true; panel?.orderOut(nil); rings.forEach { $0.orderOut(nil) }; pointer?.orderOut(nil) }
    func finishCapture(_ state: String) { captureHidden = false; if state == "active" || state == "paused" || state == "stopped" { show(state) } }
    func activity(_ action: String) { /* The persistent state label stays calm between actions. */ }
    func animate() {
        if captureHidden || state != "active" { return }
        let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let ui = MacContract.value["ui"] as? [String: Any] ?? [:]
        let configuredSeconds = ui["breath_seconds"] as? Double ?? 4.0
        let configuredBase = ui["breath_base"] as? Double ?? 0.82
        let configuredAmplitude = ui["breath_amplitude"] as? Double ?? 0.18
        let seconds = configuredSeconds.isFinite && (1.0...30.0).contains(configuredSeconds) ? configuredSeconds : 4.0
        let base = configuredBase.isFinite && (0.0...1.0).contains(configuredBase) ? configuredBase : 0.82
        let amplitude = configuredAmplitude.isFinite && (0.0...1.0).contains(configuredAmplitude) ? configuredAmplitude : 0.18
        let alpha = reduce ? 0.94 : max(0, min(1, base + amplitude * sin((ProcessInfo.processInfo.systemUptime - origin) * .pi * 2 / seconds)))
        rings.forEach { $0.alphaValue = alpha; if !$0.isVisible { $0.orderFrontRegardless() } }
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
    @objc func toggleControl() { onToggle?() }
    @objc func stopControl() { if state == "stopped" { hide() } else { onStop?() } }
    @objc func menu() {
        let menu = NSMenu()
        for (title, value) in [("Keep working — Pause or Esc to interrupt", "manual"), ("Yield on deliberate input", "smart")] {
            let item = NSMenuItem(title: title, action: #selector(changeMode(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = value; menu.addItem(item)
        }
        menu.addItem(.separator()); let hint = NSMenuItem(title: "Esc always stops immediately", action: nil, keyEquivalent: "")
        hint.isEnabled = false; menu.addItem(hint)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: 0), in: more)
    }
    @objc func changeMode(_ item: NSMenuItem) { if let mode = item.representedObject as? String { onMode?(mode) } }
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

final class MacGlowView: NSView {
    var image: NSImage?
    override init(frame: NSRect) { super.init(frame: frame); buildGlow() }
    required init?(coder: NSCoder) { super.init(coder: coder); buildGlow() }
    func buildGlow() {
        let w = max(1, Int(bounds.width)), h = max(1, Int(bounds.height))
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                           bytesPerRow: w * 4, bitsPerPixel: 32), let bytes = bitmap.bitmapData else { return }
        let ui = MacContract.value["ui"] as? [String: Any] ?? [:]
        let sigma = ui["edge_sigma"] as? Double ?? 27, depth = ui["edge_depth"] as? Int ?? 82
        let core = ui["edge_core"] as? Double ?? 5, amplitude = ui["edge_alpha"] as? Double ?? 154
        let coreAmplitude = ui["edge_core_alpha"] as? Double ?? 20
        let horizontal = (0..<w).map { x -> Double in let d = Double(min(x, w - 1 - x)); return exp(-d * d / (2 * sigma * sigma)) }
        let vertical = (0..<h).map { y -> Double in let d = Double(min(y, h - 1 - y)); return exp(-d * d / (2 * sigma * sigma)) }
        for y in 0..<h { for x in 0..<w {
            let i = (y * w + x) * 4
            if x > depth && x < w - depth && y > depth && y < h - depth { bytes[i+3] = 0; continue }
            let dx = Double(min(x, w - 1 - x)), dy = Double(min(y, h - 1 - y))
            let alpha = amplitude * (1 - (1 - horizontal[x]) * (1 - vertical[y])) + coreAmplitude * (1 - (1 - exp(-dx*dx/(2*core*core))) * (1 - exp(-dy*dy/(2*core*core))))
            bytes[i] = 155; bytes[i+1] = 205; bytes[i+2] = 235; bytes[i+3] = UInt8(min(255, max(0, alpha)))
        } }
        let output = NSImage(size: bounds.size); output.addRepresentation(bitmap); image = output
    }
    override func draw(_ dirtyRect: NSRect) { image?.draw(in: bounds) }
}
