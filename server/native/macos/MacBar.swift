// The control bar and its Settings menu, drawn as on Windows
// (docs/visual-design.md, server/native/DesktopVisuals.cs "Hud" and "Menu").
// Every size and position here is the Windows value in points; colours and
// durations come from MacDesign. Drawing is in a flipped (top-left) space so
// the numbers read the same as the Windows source.
import AppKit
import QuartzCore

// What the bar says. State is carried by the words and the colour of line 1;
// there is no status dot.
struct MacBarModel: Equatable {
    var state = "idle"          // idle, active, asking, stopped, ended
    var line1 = "", line2 = ""
    var hint = false            // "Press Esc to stop"
    var slot = 0                // 0 nothing, 1 Stop, 2 Hide
    var stopHover: CGFloat = 0, modeHover: CGFloat = 0
    var stopPress: CGFloat = 0, modePress: CGFloat = 0
    var pressed = 0             // 0 none, 2 the stop slot, 3 Settings
    var contrast = false

    // Mirrors Guardian.cs Model(). Line 1 never changes inside a state.
    static func make(state: String, prompting: Bool, host: String, activity: String, lowTime: Bool,
                     reason: String, ended: Bool) -> MacBarModel {
        var m = MacBarModel()
        let name = host.isEmpty ? "Computer Use" : host
        m.state = prompting ? "asking" : state
        if prompting { m.line1 = "Waiting for your answer"; m.line2 = "Allow or deny below"; m.hint = true; m.slot = 1 }
        else if state == "active" {
            m.line1 = name + " is working"; m.line2 = activity.isEmpty ? "Waiting for the next step" : activity
            if lowTime { m.line2 += " · 1 min left" }
            m.hint = true; m.slot = 1
        } else if state == "stopped" { m.line1 = "Stopped"; m.line2 = stopReason(reason); m.slot = 2 }
        else if ended { m.state = "ended"; m.line1 = "Session ended"; m.line2 = "The time limit ran out"; m.slot = 2 }
        else { m.state = "idle"; m.line1 = name + " is ready"; m.line2 = "Not controlling anything"; m.slot = 2 }
        return m
    }
    // The Mac watchdog latches Esc and Control+Option+F12 with one reason.
    static func stopReason(_ reason: String) -> String {
        switch reason {
        case "escape": return "You pressed Esc or ⌃⌥F12"
        case "button": return "You pressed Stop"
        case "watchdog_exited", "watchdog_cleanup_stalled", "watchdog_deadline_expired", "state_write_failed",
             "state_unavailable", "input_cleanup_failed", "guardian_stop_unconfirmed": return "A safety check failed"
        default: return "The task was ended"
        }
    }
    // The words the bar shows for an action, cleared 1.2 s later.
    static func activityWords(_ action: String) -> String {
        switch action {
        case "move": return "Moving"
        case "click": return "Clicking"
        case "drag": return "Dragging"
        case "scroll": return "Scrolling"
        case "type", "set_value", "key": return "Typing"
        case "observe": return "Reading the screen"
        default: return "Working"
        }
    }
}

enum MacBarArt {
    static let width: CGFloat = 440, height: CGFloat = 48
    static let stopRect = CGRect(x: 345, y: 2, width: 44, height: 44)
    static let modeRect = CGRect(x: 394, y: 2, width: 44, height: 44)
    static let line1Font = NSFont.systemFont(ofSize: 13, weight: .semibold)
    static let line2Font = NSFont.systemFont(ofSize: 12)
    static let capFont = NSFont.systemFont(ofSize: 11, weight: .semibold)
    static let bodyFont = NSFont.systemFont(ofSize: 13)

    static func stateColor(_ state: String) -> NSColor {
        state == "asking" ? MacDesign.amber : state == "stopped" ? MacDesign.rose : state == "active" ? MacDesign.violet : MacDesign.rest
    }
    static func mix(_ a: NSColor, _ b: NSColor, _ t: CGFloat) -> NSColor {
        let t = max(0, min(1, t))
        guard let x = a.usingColorSpace(.sRGB), let y = b.usingColorSpace(.sRGB) else { return a }
        return NSColor(srgbRed: x.redComponent + (y.redComponent - x.redComponent) * t, green: x.greenComponent + (y.greenComponent - x.greenComponent) * t,
                       blue: x.blueComponent + (y.blueComponent - x.blueComponent) * t, alpha: x.alphaComponent + (y.alphaComponent - x.alphaComponent) * t)
    }
    static func textWidth(_ text: String, _ font: NSFont) -> CGFloat { (text as NSString).size(withAttributes: [.font: font]).width }
    // One line, vertically centred in its box, cut with an ellipsis.
    static func text(_ text: String, _ font: NSFont, _ color: NSColor, _ box: CGRect, right: Bool = false) {
        let style = NSMutableParagraphStyle(); style.lineBreakMode = .byTruncatingTail; style.alignment = right ? .right : .left
        let line = ceil(font.ascender - font.descender + font.leading)
        let rect = CGRect(x: box.minX, y: box.minY + (box.height - line) / 2, width: max(0, box.width), height: line)
        (text as NSString).draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                                attributes: [.font: font, .foregroundColor: color, .paragraphStyle: style])
    }
    // The icon set: a 20 x 20 grid, 1.5 stroke, round caps and joins. Only
    // Stop is filled: a solid shape means the agent's state and nothing else.
    static func icon(_ name: String, _ x: CGFloat, _ y: CGFloat, _ color: NSColor, scale: CGFloat = 1) {
        NSGraphicsContext.saveGraphicsState()
        let move = NSAffineTransform(); move.translateX(by: x + 10, yBy: y + 10); move.scale(by: scale); move.translateX(by: -10, yBy: -10); move.concat()
        color.setFill(); color.setStroke()
        let pen = NSBezierPath(); pen.lineWidth = 1.5; pen.lineCapStyle = .round; pen.lineJoinStyle = .round
        func line(_ a: CGFloat, _ b: CGFloat, _ c: CGFloat, _ d: CGFloat) { pen.move(to: NSPoint(x: a, y: b)); pen.line(to: NSPoint(x: c, y: d)) }
        switch name {
        case "stop": NSBezierPath(roundedRect: CGRect(x: 4, y: 4, width: 12, height: 12), xRadius: 3, yRadius: 3).fill()
        case "settings":
            line(2.75, 6.5, 10.25, 6.5); line(14.75, 6.5, 17.25, 6.5); line(2.75, 13.5, 5.25, 13.5); line(9.75, 13.5, 17.25, 13.5)
            pen.appendOval(in: CGRect(x: 10.25, y: 4.25, width: 4.5, height: 4.5)); pen.appendOval(in: CGRect(x: 5.25, y: 11.25, width: 4.5, height: 4.5))
        case "close": line(5.25, 5.25, 14.75, 14.75); line(14.75, 5.25, 5.25, 14.75)
        case "check": pen.move(to: NSPoint(x: 4.75, y: 10.5)); pen.line(to: NSPoint(x: 8.25, y: 14)); pen.line(to: NSPoint(x: 15.25, y: 6.25))
        case "chevron": pen.move(to: NSPoint(x: 7.5, y: 4.75)); pen.line(to: NSPoint(x: 12.75, y: 10)); pen.line(to: NSPoint(x: 7.5, y: 15.25))
        default: break
        }
        if name != "stop" { pen.stroke() }
        NSGraphicsContext.restoreGraphicsState()
    }
    static func plate(_ target: CGRect, tint: NSColor, level: CGFloat, pressed: Bool, rose: Bool) {
        if level <= 0 && !pressed { return }
        let alpha = (rose ? 0.16 : 0.10) * (pressed ? 1.5 : 1) * max(level, pressed ? 1 : 0)
        tint.withAlphaComponent(alpha).setFill()
        NSBezierPath(ovalIn: CGRect(x: target.minX + 4, y: target.minY + 4, width: 36, height: 36)).fill()
    }
    // button.press: the icon's size for a press that has landed this far.
    static func pressing(_ level: CGFloat) -> CGFloat { 1 - (1 - MacDesign.pressScale) * max(0, min(1, level)) }
    static func keyCap(_ key: String, x: CGFloat, y: CGFloat, height: CGFloat, ink: NSColor) -> CGFloat {
        let wide = textWidth(key, capFont) + 12
        let shape = NSBezierPath(roundedRect: CGRect(x: x + 0.5, y: y + 0.5, width: wide - 1, height: height - 1), xRadius: 5, yRadius: 5)
        ink.withAlphaComponent(102.0 / 255).setStroke(); shape.lineWidth = 1; shape.stroke()
        text(key, capFont, ink, CGRect(x: x + 6, y: y, width: wide - 6, height: height))
        return x + wide
    }

    static func drawBar(_ m: MacBarModel, icon hostIcon: NSImage?) {
        let strong = MacDesign.paperText, soft = m.contrast ? MacDesign.paperText : MacDesign.mist, rest = MacDesign.rest
        let panel = CGRect(x: 0, y: 0, width: width, height: height)
        // The bar is always dark: it floats over unknown content.
        MacDesign.inkSurface.setFill(); NSBezierPath(roundedRect: panel, xRadius: height / 2, yRadius: height / 2).fill()
        let edge = NSBezierPath(roundedRect: panel.insetBy(dx: m.contrast ? 1 : 0.5, dy: m.contrast ? 1 : 0.5), xRadius: height / 2 - 0.5, yRadius: height / 2 - 0.5)
        (m.contrast ? MacDesign.paperText : MacDesign.hairline).setStroke(); edge.lineWidth = m.contrast ? 2 : 1; edge.stroke()
        var left: CGFloat = 16
        if let hostIcon = hostIcon {
            hostIcon.draw(in: CGRect(x: 12, y: 12, width: 24, height: 24), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
            left = 46
        }
        var textRight = stopRect.minX - 6
        if m.hint {
            // "Press [Esc] to stop": the key, directly before its mouse equivalent.
            let tail = textWidth("to stop", line2Font), key = textWidth("Esc", capFont) + 12, lead = textWidth("Press", line2Font)
            var x = stopRect.minX - 4 - tail
            text("to stop", line2Font, soft, CGRect(x: x, y: 0, width: tail + 2, height: height))
            x -= 6 + key
            _ = keyCap("Esc", x: x, y: 14.5, height: 19, ink: strong)
            x -= 6 + lead
            text("Press", line2Font, soft, CGRect(x: x, y: 0, width: lead + 2, height: height))
            textRight = x - 10
        }
        let tone = m.contrast ? MacDesign.paperText : stateColor(m.state)
        text(m.line1, line1Font, tone, CGRect(x: left, y: 7, width: textRight - left, height: 18))
        text(m.line2, line2Font, soft, CGRect(x: left, y: 25, width: textRight - left, height: 16))
        if m.slot == 1 {
            plate(stopRect, tint: MacDesign.rose, level: m.stopHover, pressed: m.pressed == 2, rose: true)
            icon("stop", stopRect.minX + 12, stopRect.minY + 12, mix(rest, MacDesign.rose, max(m.stopHover, m.pressed == 2 ? 1 : 0)), scale: pressing(m.stopPress))
        } else if m.slot == 2 {
            plate(stopRect, tint: .white, level: m.stopHover, pressed: m.pressed == 2, rose: false)
            icon("close", stopRect.minX + 12, stopRect.minY + 12, mix(rest, strong, m.stopHover), scale: pressing(m.stopPress))
        }
        MacDesign.hairline.setStroke()
        let divider = NSBezierPath(); divider.move(to: NSPoint(x: 391.5, y: 14)); divider.line(to: NSPoint(x: 391.5, y: 34)); divider.lineWidth = 1; divider.stroke()
        plate(modeRect, tint: .white, level: m.modeHover, pressed: m.pressed == 3, rose: false)
        icon("settings", modeRect.minX + 12, modeRect.minY + 12, mix(rest, strong, m.modeHover), scale: pressing(m.modePress))
    }
}

// ---- The Settings menu: a raised panel under the bar.
struct MacMenuItem: Equatable {
    var id = 0, kind = "row"        // head, row, rule, foot
    var text = "", note = ""
    var ticks = false, checked = false, chevron = false
    // How far the tick is in, 0..1. Text in a ticking row sits at the left
    // when there is no tick and slides right as the tick appears.
    var tickLevel: CGFloat = 0
    var bounds = CGRect.zero
}

enum MacMenuArt {
    static let width: CGFloat = 312, margin: CGFloat = 36   // the margin holds the shadow
    static let radius: CGFloat = 12, gap: CGFloat = 8
    // Places the items; returns the panel's height.
    static func layout(_ items: inout [MacMenuItem]) -> CGFloat {
        var y: CGFloat = 6
        for i in items.indices {
            let h: CGFloat = items[i].kind == "head" ? 30 : items[i].kind == "rule" ? 13 : items[i].kind == "foot" ? 58 : 44
            items[i].bounds = CGRect(x: 6, y: y, width: width - 12, height: h); y += h
        }
        return y + 6
    }
    // One neutral drop shadow, then the body.
    static func body(_ panel: CGRect) {
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow(); shadow.shadowOffset = MacDesign.shadowOffset; shadow.shadowBlurRadius = MacDesign.shadowBlur
        shadow.shadowColor = NSColor(white: 0, alpha: CGFloat(MacDesign.shadowOpacity)); shadow.set()
        MacDesign.inkRaised.setFill(); NSBezierPath(roundedRect: panel, xRadius: radius, yRadius: radius).fill()
        NSGraphicsContext.restoreGraphicsState()
    }
    static func edge(_ panel: CGRect) {
        MacDesign.hairline.setStroke()
        let line = NSBezierPath(roundedRect: panel.insetBy(dx: 0.5, dy: 0.5), xRadius: radius - 0.5, yRadius: radius - 0.5); line.lineWidth = 1; line.stroke()
    }
    // One page's rows with the panel's top-left at origin. Hover and press
    // plates appear at once: a hover fade on rows was rejected on Windows.
    static func rows(_ items: [MacMenuItem], origin: CGPoint, hover: Int, pressed: Int) {
        let small = MacBarArt.line2Font, body = MacBarArt.bodyFont
        for item in items {
            let box = item.bounds.offsetBy(dx: origin.x, dy: origin.y)
            switch item.kind {
            case "head": MacBarArt.text(item.text, small, MacDesign.mist, CGRect(x: box.minX + 12, y: box.minY + 6, width: box.width - 24, height: 20))
            case "rule":
                MacDesign.rule.setStroke(); let line = NSBezierPath(); line.move(to: NSPoint(x: box.minX + 8, y: box.minY + 6.5)); line.line(to: NSPoint(x: box.maxX - 8, y: box.minY + 6.5)); line.lineWidth = 1; line.stroke()
            case "foot":
                // "Esc or ⌃ ⌥ F12 stops at once", with the keys as keys.
                var x = box.minX + 12; let y = box.minY + 8
                x = MacBarArt.keyCap("Esc", x: x, y: y, height: 20, ink: MacDesign.paperText) + 5
                let or = MacBarArt.textWidth("or", small); MacBarArt.text("or", small, MacDesign.mist, CGRect(x: x, y: y, width: or + 2, height: 20)); x += or + 5
                for key in ["⌃", "⌥", "F12"] { x = MacBarArt.keyCap(key, x: x, y: y, height: 20, ink: MacDesign.paperText) + 4 }
                MacBarArt.text("stops at once.", small, MacDesign.mist, CGRect(x: x + 1, y: y, width: box.maxX - x - 8, height: 20))
                MacBarArt.text("Your own mouse and keyboard don't pause it.", small, MacDesign.mist, CGRect(x: box.minX + 12, y: y + 22, width: box.width - 24, height: 20))
            default:
                if item.id == pressed || item.id == hover {
                    NSColor(white: 1, alpha: (item.id == pressed ? 36 : 22) / 255.0).setFill()
                    NSBezierPath(roundedRect: box, xRadius: 8, yRadius: 8).fill()
                }
                var left = box.minX + 12, right = box.maxX - 12
                if item.ticks && item.tickLevel > 0 {
                    MacBarArt.icon("check", left, box.minY + 12, MacDesign.violet.withAlphaComponent(item.tickLevel))
                    left += 30 * item.tickLevel
                }
                if item.chevron { MacBarArt.icon("chevron", right - 18, box.minY + 12, MacDesign.rest); right -= 22 }
                if !item.note.isEmpty {
                    let note = MacBarArt.textWidth(item.note, small)
                    MacBarArt.text(item.note, small, MacDesign.mist, CGRect(x: right - note - 2, y: box.minY, width: note + 4, height: box.height)); right -= note + 10
                }
                MacBarArt.text(item.text, body, MacDesign.paperText, CGRect(x: left, y: box.minY, width: right - left, height: box.height))
            }
        }
    }
    // menu.page timing, seconds into the change: the height moves over
    // Normal (in and out); the old rows leave over FastLeave and the new ones
    // arrive from halfway through that, so no frame is empty.
    static func pageAt(_ s: Double) -> (move: CGFloat, gone: CGFloat, come: CGFloat) {
        let move = MacDesign.easeInOut(s / MacDesign.normal), gone = 1 - MacDesign.easeOut(s / MacDesign.fastLeave)
        let come = MacDesign.easeOut((s - MacDesign.fastLeave / 2) / (MacDesign.normal - MacDesign.fastLeave / 2))
        return (CGFloat(move), CGFloat(gone), CGFloat(come))
    }
    // The whole menu in a box of the panel's size plus margins. level: how
    // far open (alpha is the window's; scale grows from the Settings corner).
    static func draw(items: [MacMenuItem], tall: CGFloat, hover: Int, pressed: Int, size: CGSize, low: Bool,
                     level: CGFloat, page: (before: [MacMenuItem], beforeTall: CGFloat, seconds: Double)?) {
        NSGraphicsContext.saveGraphicsState()
        if level < 1 && !MacDesign.reduceMotion {
            let grow = MacDesign.menuFrom + (1 - MacDesign.menuFrom) * level
            let ox = size.width - margin, oy = low ? size.height - margin : margin
            let t = NSAffineTransform(); t.translateX(by: ox, yBy: oy); t.scale(by: grow); t.translateX(by: -ox, yBy: -oy); t.concat()
        }
        if let page = page {
            let (move, gone, come) = pageAt(page.seconds)
            let h = page.beforeTall + (tall - page.beforeTall) * move
            let panel = CGRect(x: margin, y: low ? size.height - margin - h : margin, width: width, height: h)
            body(panel)
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: panel, xRadius: radius, yRadius: radius).addClip()
            let context = NSGraphicsContext.current!.cgContext
            for (list, alpha) in [(page.before, gone), (items, come)] where alpha > 0 {
                context.saveGState(); context.setAlpha(alpha); context.beginTransparencyLayer(auxiliaryInfo: nil)
                rows(list, origin: panel.origin, hover: 0, pressed: 0)
                context.endTransparencyLayer(); context.restoreGState()
            }
            NSGraphicsContext.restoreGraphicsState()
            edge(panel)
        } else {
            let panel = CGRect(x: margin, y: low ? size.height - margin - tall : margin, width: width, height: tall)
            body(panel); rows(items, origin: panel.origin, hover: hover, pressed: pressed); edge(panel)
        }
        NSGraphicsContext.restoreGraphicsState()
    }
}

// The bar's surface. Stop and Settings are drawn by the bar and exposed to
// accessibility as real buttons with names; the bar never takes key focus.
final class MacBarView: NSView {
    var model = MacBarModel() { didSet { if model != oldValue { needsDisplay = true; refreshAccessibility() } } }
    var icon: NSImage? { didSet { needsDisplay = true } }
    var onStop: (() -> Void)?, onSettings: (() -> Void)?
    private var over = 0, down = 0
    private var hoverFrom: (stop: CGFloat, mode: CGFloat) = (0, 0), pressFrom: (stop: CGFloat, mode: CGFloat) = (0, 0)
    private var hoverAt = 0.0, pressAt = 0.0, fade: Timer?
    private lazy var stopElement = MacBarElement(host: self, index: 2)
    private lazy var modeElement = MacBarElement(host: self, index: 3)
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true); setAccessibilityRole(.group)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    required init?(coder: NSCoder) { fatalError("unused") }
    override func draw(_ dirtyRect: NSRect) { MacBarArt.drawBar(model, icon: icon) }
    func rect(for index: Int) -> CGRect { index == 2 ? MacBarArt.stopRect : MacBarArt.modeRect }
    // 2 for the stop slot (when it holds a button), 3 for Settings, 0 elsewhere.
    func button(at point: CGPoint) -> Int {
        if model.slot != 0 && MacBarArt.stopRect.contains(point) { return 2 }
        return MacBarArt.modeRect.contains(point) ? 3 : 0
    }
    func buttonAt(window point: NSPoint) -> Int { button(at: convert(point, from: nil)) }
    private func hovered(_ index: Int) {
        guard index != over else { return }
        over = index; hoverFrom = (model.stopHover, model.modeHover); hoverAt = CACurrentMediaTime(); NSCursor.arrow.set(); animate()
    }
    private func held(_ index: Int) {
        guard index != down else { return }
        down = index; pressFrom = (model.stopPress, model.modePress); pressAt = CACurrentMediaTime(); model.pressed = index; animate()
    }
    // button.hover: the plate arrives over Fast and leaves over FastLeave.
    // button.press: the icon eases to PressScale over Press, and back. Both
    // ease out from wherever they are; with Reduce Motion they are instant.
    private func animate() {
        step()
        if fade == nil {
            let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.step() }
            RunLoop.main.add(timer, forMode: .common); fade = timer
        }
    }
    private func step() {
        let now = CACurrentMediaTime(), reduce = MacDesign.reduceMotion
        func ease(_ from: CGFloat, _ to: CGFloat, _ at: Double, _ span: Double) -> CGFloat {
            let t = (now - at) / span
            return reduce || t >= 1 ? to : from + (to - from) * CGFloat(MacDesign.easeOut(t))
        }
        var next = model
        next.stopHover = ease(hoverFrom.stop, over == 2 ? 1 : 0, hoverAt, over == 2 ? MacDesign.fast : MacDesign.fastLeave)
        next.modeHover = ease(hoverFrom.mode, over == 3 ? 1 : 0, hoverAt, over == 3 ? MacDesign.fast : MacDesign.fastLeave)
        next.stopPress = ease(pressFrom.stop, down == 2 ? 1 : 0, pressAt, MacDesign.press)
        next.modePress = ease(pressFrom.mode, down == 3 ? 1 : 0, pressAt, MacDesign.press)
        model = next
        if next.stopHover == (over == 2 ? 1 : 0), next.modeHover == (over == 3 ? 1 : 0), next.stopPress == (down == 2 ? 1 : 0), next.modePress == (down == 3 ? 1 : 0) {
            fade?.invalidate(); fade = nil
        }
    }
    func resetPointerState() { over = 0; down = 0; hoverFrom = (0, 0); pressFrom = (0, 0); fade?.invalidate(); fade = nil
        var next = model; next.stopHover = 0; next.modeHover = 0; next.stopPress = 0; next.modePress = 0; next.pressed = 0; model = next }
    override func mouseMoved(with event: NSEvent) { if down == 0 { hovered(buttonAt(window: event.locationInWindow)) } }
    override func mouseEntered(with event: NSEvent) { mouseMoved(with: event) }
    override func mouseExited(with event: NSEvent) { if down == 0 { hovered(0) } }
    // Only presses that reach the buttons arrive here; the panel turns
    // presses on the body into drags first.
    override func mouseDown(with event: NSEvent) { held(buttonAt(window: event.locationInWindow)) }
    override func mouseDragged(with event: NSEvent) { hovered(buttonAt(window: event.locationInWindow) == down ? down : 0) }
    override func mouseUp(with event: NSEvent) {
        let target = down, inside = buttonAt(window: event.locationInWindow) == target
        held(0); hovered(buttonAt(window: event.locationInWindow))
        if inside { activate(target) }
    }
    func activate(_ index: Int) { if index == 2 { onStop?() } else if index == 3 { onSettings?() } }
    func refreshAccessibility() {
        setAccessibilityLabel("Computer use: \(model.line1), \(model.line2)")
        stopElement.setAccessibilityLabel(model.slot == 2 ? "Hide controls" : "Stop computer use (Esc)")
        removeAllToolTips()
        if model.slot != 0 { addToolTip(MacBarArt.stopRect, owner: (model.slot == 2 ? "Hide controls" : "Stop computer use · Esc or ⌃⌥F12") as NSString, userData: nil) }
        addToolTip(MacBarArt.modeRect, owner: "Settings" as NSString, userData: nil)
        modeElement.setAccessibilityLabel("Settings")
    }
    override func accessibilityChildren() -> [Any]? { model.slot != 0 ? [stopElement, modeElement] : [modeElement] }
}

final class MacBarElement: NSAccessibilityElement {
    weak var host: MacBarView?
    let index: Int
    init(host: MacBarView, index: Int) {
        self.host = host; self.index = index; super.init()
        setAccessibilityRole(.button)
    }
    override func accessibilityParent() -> Any? { host }
    override func accessibilityFrame() -> NSRect {
        guard let host = host, host.window != nil else { return .zero }
        return NSAccessibility.screenRect(fromView: host, rect: host.rect(for: index))
    }
    override func accessibilityPerformPress() -> Bool { host?.activate(index); return true }
}

// The Settings menu window. It opens from the Settings button, belongs to the
// bar and never outlives it.
final class MacBarMenu: NSObject {
    let panel: NSPanel
    private let view: MacMenuView
    private(set) var items: [MacMenuItem] = []
    private var tall: CGFloat = 0, low = false
    private var level: CGFloat = 0, levelFrom: CGFloat = 0, levelAt = 0.0
    private(set) var closing = false
    private var page: (before: [MacMenuItem], beforeTall: CGFloat, at: Double)?
    private var timer: Timer?, monitor: Any?
    var onChoose: ((Int) -> Void)?
    weak var bar: NSPanel?
    var isOpen: Bool { panel.isVisible && !closing }
    override init() {
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        view = MacMenuView(frame: .zero)
        super.init()
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.level = .statusBar; panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false; panel.worksWhenModal = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.sharingType = .none
        panel.setAccessibilityRole(.menu); panel.setAccessibilityLabel("Computer Use settings")
        panel.contentView = view; view.owner = self
    }
    var recordable = false { didSet { panel.sharingType = recordable ? .readOnly : .none } }
    // A page shown fresh has its ticks already in place.
    static func settled(_ list: [MacMenuItem]) -> [MacMenuItem] { list.map { var item = $0; item.tickLevel = item.ticks && item.checked ? 1 : 0; return item } }
    func open(_ list: [MacMenuItem], from bar: NSPanel) {
        self.bar = bar; page = nil; ticking.removeAll(); set(Self.settled(list)); view.hover = 0; view.pressed = 0
        if !panel.isVisible {
            level = 0; levelFrom = 0; levelAt = CACurrentMediaTime(); closing = false
            panel.alphaValue = 0; panel.orderFrontRegardless()
            monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] _ in self?.outsidePress() }
        } else if closing { closing = false; levelFrom = level; levelAt = CACurrentMediaTime() }
        start(); render()
    }
    private func set(_ list: [MacMenuItem]) { items = list; tall = MacMenuArt.layout(&items); place(tall) }
    // A change on the same page is drawn at once, except a tick, which slides
    // its row's text over Normal, easing in and out (instant with Reduce Motion).
    private var ticking: [Int: (from: CGFloat, to: CGFloat, at: Double)] = [:]
    func refresh(_ list: [MacMenuItem]) {
        guard !closing else { return }
        let before = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var next = list
        for i in next.indices where next[i].ticks {
            let to: CGFloat = next[i].checked ? 1 : 0
            guard let old = before[next[i].id], old.ticks else { next[i].tickLevel = to; continue }
            next[i].tickLevel = old.tickLevel
            if old.tickLevel != to {
                if MacDesign.reduceMotion { next[i].tickLevel = to } else { ticking[next[i].id] = (old.tickLevel, to, CACurrentMediaTime()) }
            }
        }
        page = nil; set(next); if !ticking.isEmpty { start() }; render()
    }
    private func stepTicks(_ now: Double) -> Bool {
        guard !ticking.isEmpty else { return false }
        for (id, run) in ticking {
            let t = (now - run.at) / MacDesign.normal
            let level = t >= 1 ? run.to : run.from + (run.to - run.from) * CGFloat(MacDesign.easeInOut(t))
            if let i = items.firstIndex(where: { $0.id == id }) { items[i].tickLevel = level }
            if t >= 1 { ticking[id] = nil }
        }
        return !ticking.isEmpty
    }
    // menu.page: the height moves while the old rows leave and the new arrive.
    func swap(_ list: [MacMenuItem]) {
        guard !closing else { return }
        ticking.removeAll()
        if MacDesign.reduceMotion { view.hover = 0; view.pressed = 0; page = nil; set(Self.settled(list)); render(); return }
        let before = items, beforeTall = tall
        items = Self.settled(list); tall = MacMenuArt.layout(&items); view.hover = 0; view.pressed = 0
        page = (before, beforeTall, CACurrentMediaTime()); place(max(beforeTall, tall)); start(); render()
    }
    // menu.close: reversed over NormalLeave (FastLeave with Reduce Motion);
    // at once when the bar hides or a screenshot needs the screen.
    func dismiss(atOnce: Bool) {
        guard panel.isVisible else { return }
        if atOnce { finish(); return }
        if closing { return }
        page = nil; place(tall); closing = true; levelFrom = level; levelAt = CACurrentMediaTime(); view.hover = 0; view.pressed = 0; start()
    }
    private func finish() {
        timer?.invalidate(); timer = nil; closing = false; page = nil; level = 0; ticking.removeAll()
        if let monitor = monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
        panel.orderOut(nil)
    }
    private func outsidePress() {
        let point = NSEvent.mouseLocation
        if panel.frame.insetBy(dx: MacMenuArt.margin, dy: MacMenuArt.margin).contains(point) || bar?.frame.contains(point) == true { return }
        dismiss(atOnce: false)
    }
    // 8 pt under the bar, right edges aligned; above it when the bar is docked
    // low, where the bottom edge stays put as the height changes.
    private func place(_ height: CGFloat) {
        guard let bar = bar else { return }
        let work = (bar.screen ?? NSScreen.main)?.visibleFrame ?? bar.frame
        let size = CGSize(width: MacMenuArt.width + 2 * MacMenuArt.margin, height: height + 2 * MacMenuArt.margin)
        low = bar.frame.midY < work.midY
        var x = bar.frame.maxX - size.width + MacMenuArt.margin
        x = max(work.minX - MacMenuArt.margin, min(x, work.maxX - size.width + MacMenuArt.margin))
        let y = low ? bar.frame.maxY + MacMenuArt.gap - MacMenuArt.margin : bar.frame.minY - MacMenuArt.gap - size.height + MacMenuArt.margin
        panel.setFrame(NSRect(origin: CGPoint(x: x.rounded(), y: y.rounded()), size: size), display: false)
        view.frame = NSRect(origin: .zero, size: size)
    }
    private func start() {
        guard timer == nil else { return }
        let t = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.step() }
        RunLoop.main.add(t, forMode: .common); timer = t
    }
    private func step() {
        if bar?.isVisible != true { finish(); return }
        let now = CACurrentMediaTime(), reduce = MacDesign.reduceMotion
        var busy = false
        if closing || level < 1 {
            let span = closing ? (reduce ? MacDesign.fastLeave : MacDesign.normalLeave) : (reduce ? MacDesign.fast : MacDesign.normal)
            let t = (now - levelAt) / span
            if closing && t >= 1 { finish(); return }
            let e = CGFloat(MacDesign.easeOut(min(1, t)))
            level = t >= 1 ? 1 : closing ? levelFrom * (1 - e) : levelFrom + (1 - levelFrom) * e
            busy = level < 1 || closing
        }
        if let p = page {
            if now - p.at >= MacDesign.normal { page = nil; place(tall) } else { busy = true }
        }
        if stepTicks(now) { busy = true }
        render()
        if !busy { timer?.invalidate(); timer = nil }
    }
    fileprivate var still: Bool { !closing && page == nil }
    fileprivate func render() {
        panel.alphaValue = level
        view.state = (items, tall, low, level, page.map { ($0.before, $0.beforeTall, CACurrentMediaTime() - $0.at) })
        view.needsDisplay = true
    }
    fileprivate func choose(_ id: Int) { onChoose?(id) }
    // The bench: one frame of the menu as a picture.
    static func picture(items list: [MacMenuItem], hover: Int = 0, pressed: Int = 0, level: CGFloat = 1, low: Bool = false,
                        page: (before: [MacMenuItem], seconds: Double)? = nil) -> (NSImage, CGSize) {
        var items = list.map { item -> MacMenuItem in var item = item; if item.ticks && item.checked && item.tickLevel == 0 { item.tickLevel = 1 }; return item }
        let tall = MacMenuArt.layout(&items)
        var before = settled(page?.before ?? []); let beforeTall = page == nil ? tall : MacMenuArt.layout(&before)
        let size = CGSize(width: MacMenuArt.width + 2 * MacMenuArt.margin, height: max(tall, beforeTall) + 2 * MacMenuArt.margin)
        let image = NSImage(size: size, flipped: true) { _ in
            MacMenuArt.draw(items: items, tall: tall, hover: hover, pressed: pressed, size: size, low: low, level: level,
                            page: page.map { (before, beforeTall, $0.seconds) })
            return true
        }
        return (image, size)
    }
}

final class MacMenuView: NSView {
    weak var owner: MacBarMenu?
    var hover = 0, pressed = 0
    var state: ([MacMenuItem], CGFloat, Bool, CGFloat, ([MacMenuItem], CGFloat, Double)?) = ([], 0, false, 1, nil)
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    required init?(coder: NSCoder) { fatalError("unused") }
    override func draw(_ dirtyRect: NSRect) {
        let (items, tall, low, level, page) = state
        MacMenuArt.draw(items: items, tall: tall, hover: hover, pressed: pressed, size: bounds.size, low: low, level: level, page: page)
    }
    private func hit(_ event: NSEvent) -> Int {
        let (items, tall, low, _, _) = state
        let p = convert(event.locationInWindow, from: nil)
        let origin = CGPoint(x: MacMenuArt.margin, y: low ? bounds.height - MacMenuArt.margin - tall : MacMenuArt.margin)
        return items.first(where: { $0.kind == "row" && $0.bounds.offsetBy(dx: origin.x, dy: origin.y).contains(p) })?.id ?? 0
    }
    override func mouseMoved(with event: NSEvent) {
        guard owner?.still == true else { return }
        let id = hit(event); if id != hover { hover = id; needsDisplay = true }
    }
    override func mouseExited(with event: NSEvent) { if hover != 0 || pressed != 0 { hover = 0; pressed = 0; needsDisplay = true } }
    override func mouseDown(with event: NSEvent) { guard owner?.still == true else { return }; pressed = hit(event); needsDisplay = true }
    override func mouseUp(with event: NSEvent) {
        let id = hit(event), chosen = id != 0 && id == pressed
        pressed = 0; hover = id; needsDisplay = true
        if chosen && owner?.still == true { owner?.choose(id) }
    }
    override func accessibilityChildren() -> [Any]? {
        state.0.filter { $0.kind == "row" }.map { item in
            let element = MacMenuRowElement(host: self, id: item.id)
            element.setAccessibilityLabel(item.note.isEmpty ? item.text : "\(item.text), \(item.note)")
            if item.ticks { element.setAccessibilityValue(item.checked ? 1 : 0) }
            return element
        }
    }
    fileprivate func frame(of id: Int) -> CGRect {
        let (items, tall, low, _, _) = state
        let origin = CGPoint(x: MacMenuArt.margin, y: low ? bounds.height - MacMenuArt.margin - tall : MacMenuArt.margin)
        return items.first(where: { $0.id == id })?.bounds.offsetBy(dx: origin.x, dy: origin.y) ?? .zero
    }
    fileprivate func press(_ id: Int) { if owner?.still == true { owner?.choose(id) } }
}

final class MacMenuRowElement: NSAccessibilityElement {
    weak var host: MacMenuView?
    let id: Int
    init(host: MacMenuView, id: Int) { self.host = host; self.id = id; super.init(); setAccessibilityRole(.menuItem) }
    override func accessibilityParent() -> Any? { host }
    override func accessibilityFrame() -> NSRect { host.map { NSAccessibility.screenRect(fromView: $0, rect: $0.frame(of: id)) } ?? .zero }
    override func accessibilityPerformPress() -> Bool { host?.press(id); return true }
}

// bar.drag and bar.settle (Guardian.cs Band, Resist and Spring): a rubber band
// past the inset, and an Apple-style spring with mass 1, its stiffness and
// damping from SpringSeconds and SpringBounce, solved in fixed steps.
enum MacBarMotion {
    static let step = 0.001, longest = 0.064, near: CGFloat = 0.5, slow: CGFloat = 20, trail = 0.080
    static func resist(_ over: CGFloat, _ dim: CGFloat) -> CGFloat { dim <= 0 ? 0 : (1 - 1 / (over * 0.55 / dim + 1)) * dim }
    // Inside the inset the bar follows exactly; past it each point moves it
    // less, and it can never go a whole inset further.
    static func band(_ value: CGFloat, low lowEdge: CGFloat, high highEdge: CGFloat, margin m: CGFloat) -> CGFloat {
        var low = lowEdge + m, high = highEdge - m, margin = m
        if high < low { low = lowEdge; high = max(lowEdge, highEdge); margin = 0 }
        if value < low { return (low - resist(low - value, margin)).rounded() }
        if value > high { return (high + resist(value - high, margin)).rounded() }
        return value.rounded()
    }
    struct Spring { var x: CGFloat, y: CGFloat, vx: CGFloat, vy: CGFloat; var to: CGPoint }
    // Advances the spring by elapsed seconds; returns false once at rest.
    static func advance(_ s: inout Spring, elapsed: Double) -> Bool {
        let e = min(longest, max(0, elapsed))
        let turn = 2 * Double.pi / MacDesign.springSeconds, stiffness = turn * turn
        let damping = 4 * Double.pi * (1 - MacDesign.springBounce) / MacDesign.springSeconds
        let steps = max(1, Int((e / step).rounded(.up))), dt = e / Double(steps)
        var x = Double(s.x), y = Double(s.y), vx = Double(s.vx), vy = Double(s.vy)
        for _ in 0..<steps {
            vx += (-stiffness * (x - Double(s.to.x)) - damping * vx) * dt; x += vx * dt
            vy += (-stiffness * (y - Double(s.to.y)) - damping * vy) * dt; y += vy * dt
        }
        s.x = CGFloat(x); s.y = CGFloat(y); s.vx = CGFloat(vx); s.vy = CGFloat(vy)
        return !(abs(s.x - s.to.x) < near && abs(s.y - s.to.y) < near && abs(s.vx) < slow && abs(s.vy) < slow)
    }
}

// ---- The bench (AxonHost --visual-preview <dir>): the bar and menu drawn by
// the same code as the live windows, one picture per surface and state, at 2x.
// No window is shown, no permission is requested and no input is sent.
enum MacBarBench {
    static func png(_ size: CGSize, to path: String, scale: CGFloat = 2, draw: @escaping () -> Void) throws {
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0) else { throw AxonError("preview_failed", "Cannot allocate a preview bitmap.") }
        rep.size = size
        NSGraphicsContext.saveGraphicsState()
        guard let base = NSGraphicsContext(bitmapImageRep: rep) else { throw AxonError("preview_failed", "Cannot draw a preview.") }
        let cg = base.cgContext
        cg.translateBy(x: 0, y: size.height); cg.scaleBy(x: 1, y: -1)   // rep.size already maps points to 2x pixels
        NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)
        draw()
        NSGraphicsContext.restoreGraphicsState()
        guard let data = rep.representation(using: .png, properties: [:]) else { throw AxonError("preview_failed", "Cannot encode a preview.") }
        try data.write(to: URL(fileURLWithPath: path))
    }
    static func write(to directory: String) throws -> [String] {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var written: [String] = []
        func bar(_ name: String, _ m: MacBarModel) throws {
            let path = (directory as NSString).appendingPathComponent("bar-\(name).png")
            try png(CGSize(width: MacBarArt.width, height: MacBarArt.height), to: path) { MacBarArt.drawBar(m, icon: nil) }
            written.append(path)
        }
        let host = "Antigravity"
        func model(_ state: String, prompting: Bool = false, activity: String = "", low: Bool = false, reason: String = "", ended: Bool = false) -> MacBarModel {
            MacBarModel.make(state: state, prompting: prompting, host: host, activity: activity, lowTime: low, reason: reason, ended: ended)
        }
        // The agent's pointer glow on dark and light: alone (what is drawn live,
        // around the real arrow) and with the Windows dart for comparison.
        for (name, background) in [("dark", NSColor(srgbRed: 31 / 255, green: 33 / 255, blue: 40 / 255, alpha: 1)), ("light", NSColor(white: 0.96, alpha: 1))] {
            for dart in [true, false] {
                let path = (directory as NSString).appendingPathComponent("pointer-\(dart ? "dart" : "halo")-\(name).png")
                try png(CGSize(width: MacPointerView.side, height: MacPointerView.side), to: path) {
                    background.setFill(); NSRect(x: 0, y: 0, width: MacPointerView.side, height: MacPointerView.side).fill()
                    let view = MacPointerView(frame: NSRect(x: 0, y: 0, width: MacPointerView.side, height: MacPointerView.side)); view.dart = dart
                    view.draw(view.bounds)
                }
                written.append(path)
            }
        }
        try bar("ready", model("idle"))
        try bar("working", model("active"))
        try bar("working-clicking", model("active", activity: "Clicking"))
        try bar("working-one-minute-left", model("active", activity: "Typing", low: true))
        try bar("asking", model("active", prompting: true))
        try bar("stopped-esc", model("stopped", reason: "escape"))
        try bar("stopped-button", model("stopped", reason: "button"))
        try bar("stopped-safety-check", model("stopped", reason: "watchdog_exited"))
        try bar("session-ended", model("idle", ended: true))
        var m = model("active"); m.stopHover = 1; try bar("stop-hover", m)
        m.pressed = 2; m.stopPress = 1; try bar("stop-pressed", m)
        m = model("active"); m.modeHover = 1; try bar("settings-hover", m)
        m.pressed = 3; m.modePress = 1; try bar("settings-pressed", m)
        m = model("stopped", reason: "button"); m.stopHover = 1; try bar("hide-hover", m)
        m = model("active"); m.contrast = true; try bar("working-increase-contrast", m)
        let visuals = MacVisuals()
        let main = visuals.mainMenu(), docks = visuals.dockMenu()
        func menu(_ name: String, _ items: [MacMenuItem], hover: Int = 0, pressed: Int = 0, level: CGFloat = 1, low: Bool = false,
                  page: (before: [MacMenuItem], seconds: Double)? = nil) throws {
            let (image, size) = MacBarMenu.picture(items: items, hover: hover, pressed: pressed, level: level, low: low, page: page)
            let path = (directory as NSString).appendingPathComponent("menu-\(name).png")
            try png(size, to: path) { image.draw(in: CGRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: level, respectFlipped: true, hints: nil) }
            written.append(path)
        }
        try menu("main", main)
        try menu("main-row-hover", main, hover: 2)
        try menu("main-row-pressed", main, hover: 2, pressed: 2)
        try menu("move-bar", docks)
        for ms in [33, 67, 100, 150] { try menu("page-change-\(ms)ms", docks, page: (main, Double(ms) / 1000)) }
        for (name, level) in [("opening-25pct", 0.25), ("opening-50pct", 0.5)] { try menu(name, main, level: CGFloat(MacDesign.easeOut(level))) }
        try menu("main-above-low-bar", main, low: true)
        var recording = main; recording[1].checked = true; recording[1].tickLevel = 1
        try menu("main-recording-on", recording)
        recording[1].tickLevel = CGFloat(MacDesign.easeInOut(0.5)); try menu("main-tick-sliding-in-50pct", recording)
        return written
    }
}
