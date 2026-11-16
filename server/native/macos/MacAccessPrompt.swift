// The access prompt: a card on the bar's dark surface that asks before the
// agent may use an app or perform one sensitive operation. Only its look
// follows the Windows card (docs/visual-design.md); its behaviour is the old
// NSAlert's: modal, Deny is the default and holds the focus, Return and Esc
// mean Deny, 90 seconds without an answer counts as Deny, it is excluded from
// screen capture, and the human's normal OS cursor stays visible.
import AppKit

final class MacPromptPanel: NSPanel {
    var onDeny: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { onDeny?() }
}

final class MacPromptButton: NSButton {
    let filled: Bool
    var hovering = false { didSet { if hovering != oldValue { needsDisplay = true } } }
    // The bench draws states it cannot reach with a pointer.
    var forcedHover = false, forcedPress = false, forcedFocus = false
    init(title: String, filled: Bool) {
        self.filled = filled
        super.init(frame: .zero)
        self.title = title; isBordered = false; bezelStyle = .regularSquare; focusRingType = .none
        setButtonType(.momentaryPushIn); setAccessibilityLabel(title)
    }
    required init?(coder: NSCoder) { fatalError("unused") }
    override var acceptsFirstResponder: Bool { true }
    override var canBecomeKeyView: Bool { true }
    override func becomeFirstResponder() -> Bool { needsDisplay = true; return super.becomeFirstResponder() }
    override func resignFirstResponder() -> Bool { needsDisplay = true; return super.resignFirstResponder() }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func keyDown(with event: NSEvent) {
        // Space activates the focused button, as in any dialog.
        if event.charactersIgnoringModifiers == " " { performClick(nil); return }
        super.keyDown(with: event)
    }
    override func draw(_ dirtyRect: NSRect) {
        let contrast = MacDesign.increaseContrast
        let hover = hovering || forcedHover, pressed = isHighlighted || forcedPress
        let focused = forcedFocus || (window?.firstResponder === self && window?.isKeyWindow == true)
        let accent = contrast ? NSColor.controlAccentColor : MacDesign.violet
        let ink = contrast ? NSColor.labelColor : MacDesign.paperText
        let ring = MacDesign.promptRing
        let box = bounds.insetBy(dx: ring, dy: ring)
        if focused {
            let outline = NSBezierPath(roundedRect: box.insetBy(dx: -(ring - 0.75), dy: -(ring - 0.75)),
                                       xRadius: MacDesign.promptButtonRadius + ring, yRadius: MacDesign.promptButtonRadius + ring)
            accent.setStroke(); outline.lineWidth = 1.5; outline.stroke()
        }
        NSGraphicsContext.saveGraphicsState()
        if pressed {
            // A press lands at the shared press scale.
            let transform = NSAffineTransform()
            transform.translateX(by: box.midX, yBy: box.midY); transform.scale(by: MacDesign.pressScale)
            transform.translateX(by: -box.midX, yBy: -box.midY); transform.concat()
        }
        let shape = NSBezierPath(roundedRect: box, xRadius: MacDesign.promptButtonRadius, yRadius: MacDesign.promptButtonRadius)
        let label: NSColor
        if filled {
            let fill = contrast ? accent : pressed ? MacDesign.violet.blended(withFraction: 0.16, of: MacDesign.inkSurface)!
                : hover ? MacDesign.violet.blended(withFraction: 0.28, of: .white)! : MacDesign.violet
            fill.setFill(); shape.fill()
            label = contrast ? .alternateSelectedControlTextColor : MacDesign.inkSurface
            if contrast && (hover || pressed) { ink.setStroke(); shape.lineWidth = 2; shape.stroke() }
        } else {
            if !contrast && (hover || pressed) { NSColor(white: 1, alpha: pressed ? 36.0 / 255 : 22.0 / 255).setFill(); shape.fill() }
            let line = NSBezierPath(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), xRadius: MacDesign.promptButtonRadius - 0.5, yRadius: MacDesign.promptButtonRadius - 0.5)
            (contrast ? ink : NSColor(white: 1, alpha: (hover || pressed ? 140.0 : 102.0) / 255)).setStroke()
            line.lineWidth = contrast && (hover || pressed) ? 2 : 1; line.stroke()
            label = ink
        }
        let text = NSAttributedString(string: title, attributes: [.font: MacDesign.promptButtonFont, .foregroundColor: label])
        let size = text.size()
        text.draw(at: NSPoint(x: box.midX - size.width / 2, y: box.midY - size.height / 2))
        NSGraphicsContext.restoreGraphicsState()
    }
}

// The card's body area: one replaceable view. Today it is the request's
// text; per-app rows with tier tags will be another MacPromptBody that fills
// the same slot without changing the card, its buttons or its placement.
protocol MacPromptBody: NSView {
    // The height the body wants at the card's inner width, before the limit.
    var naturalHeight: CGFloat { get }
    // The tallest the body may be; past that its text scrolls.
    var mostHeight: CGFloat { get }
    // The view that takes Tab after Allow.
    var keyView: NSView { get }
}
extension MacPromptBody { var mostHeight: CGFloat { MacDesign.promptBodyMost } }

// One app row for an app request that carries card:1 (DesktopVisuals.cs
// PromptApp). Only the tiers native controls enforce have a row; any other
// tier, or no name, keeps the text card.
struct MacPromptApp: Equatable {
    let name: String, sentence: String, tag: String, sub: String, level: Int   // bars lit: 1 click only, 2 full control
    static func make(tier: String, name: String, conversation: Bool) -> MacPromptApp? {
        let sub = conversation ? "Until you start a new conversation" : "For this task"
        guard !name.isEmpty else { return nil }
        switch tier {
        case "full": return MacPromptApp(name: name, sentence: "Can see, click and type", tag: "Full control", sub: sub, level: 2)
        case "click": return MacPromptApp(name: name, sentence: "Can see and click. Cannot type", tag: "Click only", sub: sub, level: 1)
        default: return nil
        }
    }
    // The app's own display name from its bundle, or its file name. Never blank.
    static func appName(_ executable: String) -> String {
        var url = URL(fileURLWithPath: executable)
        while url.path != "/" && url.pathExtension != "app" { url.deleteLastPathComponent() }
        if url.pathExtension == "app", let info = Bundle(url: url)?.infoDictionary {
            for key in ["CFBundleDisplayName", "CFBundleName"] {
                if let name = (info[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty, name.count <= 48 { return name }
            }
            let file = url.deletingPathExtension().lastPathComponent
            if !file.isEmpty { return file }
        }
        let file = URL(fileURLWithPath: executable).lastPathComponent
        return file.isEmpty ? executable : file
    }
}

// The app row over the request text: the line under the heading, a plate with
// the app's name, its sentence and the tier tag (a word plus the two-step
// mark, so it never rests on colour), then path, PID, task and notice as text
// that scrolls past promptBodyMost.
final class MacPromptAppBody: NSView, MacPromptBody {
    let app: MacPromptApp
    let details: MacPromptTextBody
    static let rowTop = MacDesign.promptSub + 4
    static let header = rowTop + MacDesign.promptRow + 10
    var naturalHeight: CGFloat { MacPromptAppBody.header + max(details.naturalHeight, 18) }
    var mostHeight: CGFloat { MacPromptAppBody.header + MacDesign.promptBodyMost }
    var keyView: NSView { details.text }
    override var isFlipped: Bool { true }
    init(_ app: MacPromptApp, details text: String, width: CGFloat) {
        self.app = app
        details = MacPromptTextBody(text, width: width)
        super.init(frame: NSRect(x: 0, y: 0, width: width, height: 10))
        addSubview(details)
        setAccessibilityElement(true); setAccessibilityRole(.group)
        setAccessibilityLabel("\(app.name), \(app.tag). \(app.sentence). \(app.sub).")
    }
    required init?(coder: NSCoder) { fatalError("unused") }
    override func setFrameSize(_ size: NSSize) {
        super.setFrameSize(size)
        let room = max(18, size.height - MacPromptAppBody.header)
        details.frame = NSRect(x: 0, y: MacPromptAppBody.header, width: size.width, height: room)
        details.hasVerticalScroller = details.naturalHeight > room + 0.5
    }
    var rowRect: NSRect { NSRect(x: 0, y: MacPromptAppBody.rowTop, width: bounds.width, height: MacDesign.promptRow) }
    var tagRect: NSRect {
        let word = (app.tag as NSString).size(withAttributes: [.font: MacPromptAppBody.tagFont]).width
        let wide = ceil(word) + 10 + 14 + 10, high: CGFloat = 24, row = rowRect
        return NSRect(x: row.maxX - 12 - wide, y: row.minY + (row.height - high) / 2, width: wide, height: high)
    }
    static let tagFont = NSFont.systemFont(ofSize: 12, weight: .semibold)
    static let nameFont = NSFont.systemFont(ofSize: 13, weight: .semibold)
    override func draw(_ dirtyRect: NSRect) {
        let contrast = MacDesign.increaseContrast
        let strong = contrast ? NSColor.labelColor : MacDesign.paperText, soft = contrast ? NSColor.labelColor : MacDesign.mist
        let line: (String, NSFont, NSColor, NSRect) -> Void = { text, font, color, box in
            let style = NSMutableParagraphStyle(); style.lineBreakMode = .byTruncatingTail
            NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: style]).draw(in: box)
        }
        line(app.sub, MacDesign.promptNoteFont, soft, NSRect(x: 0, y: 0, width: bounds.width, height: MacDesign.promptSub))
        let row = rowRect, plate = NSBezierPath(roundedRect: row, xRadius: 12, yRadius: 12)
        if contrast { NSColor.labelColor.setStroke(); plate.lineWidth = 1; plate.stroke() }
        else { NSColor(white: 1, alpha: 16.0 / 255).setFill(); plate.fill() }
        let tag = tagRect
        let outline = NSBezierPath(roundedRect: tag.insetBy(dx: 0.5, dy: 0.5), xRadius: 7, yRadius: 7)
        (contrast ? strong : NSColor(white: 1, alpha: 102.0 / 255)).setStroke(); outline.lineWidth = 1; outline.stroke()
        for bar in 0..<2 {
            let high: CGFloat = bar == 0 ? 6 : 10
            let mark = NSRect(x: tag.minX + 10 + CGFloat(bar) * 6, y: tag.maxY - 7 - high, width: 4, height: high)
            if bar < app.level { strong.setFill(); mark.fill() }
            else { (contrast ? strong : NSColor(white: 1, alpha: 120.0 / 255)).setStroke(); let box = NSBezierPath(rect: mark.insetBy(dx: 0.5, dy: 0.5)); box.lineWidth = 1; box.stroke() }
        }
        let word = NSAttributedString(string: app.tag, attributes: [.font: MacPromptAppBody.tagFont, .foregroundColor: strong])
        let wordSize = word.size()
        word.draw(at: NSPoint(x: tag.minX + 10 + 14, y: tag.midY - wordSize.height / 2))
        let text = tag.minX - 12 - (row.minX + 14)
        line(app.name, MacPromptAppBody.nameFont, strong, NSRect(x: row.minX + 14, y: row.minY + 9, width: text, height: 20))
        line(app.sentence, MacDesign.promptNoteFont, soft, NSRect(x: row.minX + 14, y: row.minY + 29, width: text, height: 18))
    }
}

// The request as text: shown whole, scrolling past promptBodyMost, never cut.
final class MacPromptTextBody: NSScrollView, MacPromptBody {
    let text = NSTextView()
    let naturalHeight: CGFloat
    var keyView: NSView { text }
    init(_ string: String, width: CGFloat) {
        let contrast = MacDesign.increaseContrast
        text.string = string; text.isEditable = false; text.isSelectable = true; text.drawsBackground = false
        text.font = MacDesign.promptBodyFont; text.textColor = contrast ? .labelColor : MacDesign.rest
        text.textContainerInset = .zero; text.textContainer?.lineFragmentPadding = 0
        text.textContainer?.widthTracksTextView = true; text.isVerticallyResizable = true; text.isHorizontallyResizable = false
        text.frame = NSRect(x: 0, y: 0, width: width, height: 10)
        text.textContainer?.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
        text.setAccessibilityLabel("Request")
        text.layoutManager?.ensureLayout(for: text.textContainer!)
        naturalHeight = ceil(text.layoutManager?.usedRect(for: text.textContainer!).height ?? 0) + 2
        super.init(frame: .zero)
        text.frame.size.height = max(naturalHeight, 18)
        documentView = text; drawsBackground = false; borderType = .noBorder
        scrollerStyle = .overlay; scrollerKnobStyle = contrast ? .default : .light
    }
    required init?(coder: NSCoder) { fatalError("unused") }
}

final class MacPromptCardView: NSView {
    let title: String
    let content: MacPromptBody
    // The text body, when the card shows the request as text.
    var body: NSTextView { (content as? MacPromptTextBody)?.text ?? NSTextView() }
    var scroll: NSView { content }
    let allow = MacPromptButton(title: "Allow", filled: true)
    let deny = MacPromptButton(title: "Deny", filled: false)
    let margin: CGFloat
    private(set) var card = NSRect.zero, rule: CGFloat = 0, bodyScrolls = false
    override var isFlipped: Bool { true }

    // The first line of the request is the title; the rest is shown whole.
    static func split(_ message: String, fallback: String) -> (title: String, body: String) {
        let text = message.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if let cut = text.firstIndex(of: "\n") {
            let head = text[..<cut].trimmingCharacters(in: .whitespaces)
            if !head.isEmpty && head.count <= 64 { return (head, String(text[cut...]).trimmingCharacters(in: .whitespacesAndNewlines)) }
        }
        return (fallback, text)
    }
    init(message: String, fallback: String, margin: CGFloat = 36, content replacement: MacPromptBody? = nil, heading: String? = nil) {
        let parts = MacPromptCardView.split(message, fallback: fallback)
        title = heading ?? parts.title; self.margin = margin
        let pad = MacDesign.promptPad, width = MacDesign.promptWidth, inner = width - 2 * pad
        content = replacement ?? MacPromptTextBody(parts.body, width: inner)
        super.init(frame: .zero)
        // As tall as its content, up to the limit; past that it scrolls, and nothing is cut.
        bodyScrolls = content.naturalHeight > content.mostHeight
        let tall = min(max(content.naturalHeight, 18), content.mostHeight)
        (content as? NSScrollView)?.hasVerticalScroller = bodyScrolls
        let top = pad + MacDesign.promptTitle + 8
        card = NSRect(x: margin, y: margin, width: width, height: 0)
        content.frame = NSRect(x: margin + pad, y: margin + top, width: inner, height: tall)
        rule = top + tall + 12
        let row = rule + 12
        let ring = MacDesign.promptRing, across = MacDesign.promptButtonWidth + 2 * ring, down = MacDesign.promptButtonHeight + 2 * ring
        deny.frame = NSRect(x: margin + width - pad - MacDesign.promptButtonWidth - ring, y: margin + row - ring, width: across, height: down)
        allow.frame = NSRect(x: deny.frame.minX - MacDesign.promptButtonGap - MacDesign.promptButtonWidth, y: deny.frame.minY, width: across, height: down)
        card.size.height = row + MacDesign.promptButtonHeight + pad
        frame = NSRect(x: 0, y: 0, width: width + 2 * margin, height: card.height + 2 * margin)
        // Deny first in the key loop: it holds the focus when the prompt opens.
        deny.nextKeyView = allow; allow.nextKeyView = content.keyView; content.keyView.nextKeyView = deny
        [content, allow, deny].forEach(addSubview)
        setAccessibilityElement(true); setAccessibilityRole(.group); setAccessibilityLabel(title)
    }
    required init?(coder: NSCoder) { fatalError("unused") }
    // The card for an app request with a row: the heading names the host,
    // the row the app, and the text under it the identity, task and notice.
    convenience init(app: MacPromptApp, host: String, details: String, margin: CGFloat = 36) {
        let inner = MacDesign.promptWidth - 2 * MacDesign.promptPad
        self.init(message: details, fallback: "", margin: margin,
                  content: MacPromptAppBody(app, details: details, width: inner),
                  heading: "Allow \(host.isEmpty ? "the agent" : host) to use this app?")
    }
    var noteWidth: CGFloat { allow.frame.minX + MacDesign.promptRing - (margin + MacDesign.promptPad) - 12 }
    override func draw(_ dirtyRect: NSRect) {
        let contrast = MacDesign.increaseContrast
        let shape = NSBezierPath(roundedRect: card, xRadius: MacDesign.promptRadius, yRadius: MacDesign.promptRadius)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        // Flipped view: a positive offset in a flipped context still moves the
        // shadow down the screen when expressed as negative height.
        shadow.shadowOffset = NSSize(width: MacDesign.shadowOffset.width, height: MacDesign.shadowOffset.height)
        shadow.shadowBlurRadius = MacDesign.shadowBlur
        shadow.shadowColor = NSColor(white: 0, alpha: CGFloat(MacDesign.shadowOpacity)); shadow.set()
        (contrast ? NSColor.windowBackgroundColor : MacDesign.inkSurface).setFill(); shape.fill()
        NSGraphicsContext.restoreGraphicsState()
        (contrast ? NSColor.labelColor : MacDesign.hairline).setStroke()
        let edge = NSBezierPath(roundedRect: card.insetBy(dx: 0.5, dy: 0.5), xRadius: MacDesign.promptRadius - 0.5, yRadius: MacDesign.promptRadius - 0.5)
        edge.lineWidth = contrast ? 2 : 1; edge.stroke()
        let pad = MacDesign.promptPad
        let head = NSAttributedString(string: title, attributes: [.font: MacDesign.promptTitleFont,
            .foregroundColor: contrast ? NSColor.labelColor : MacDesign.paperText,
            .paragraphStyle: { let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail; return p }()])
        head.draw(in: NSRect(x: card.minX + pad, y: card.minY + pad, width: card.width - 2 * pad, height: MacDesign.promptTitle))
        (contrast ? NSColor.labelColor : MacDesign.rule).setFill()
        NSRect(x: card.minX + pad, y: card.minY + rule, width: card.width - 2 * pad, height: 1).fill()
        let note = NSAttributedString(string: MacDesign.promptNote, attributes: [.font: MacDesign.promptNoteFont,
            .foregroundColor: contrast ? NSColor.labelColor : MacDesign.mist])
        let size = note.boundingRect(with: NSSize(width: noteWidth, height: MacDesign.promptButtonHeight), options: [.usesLineFragmentOrigin])
        note.draw(with: NSRect(x: card.minX + pad, y: card.minY + rule + 12 + (MacDesign.promptButtonHeight - size.height) / 2,
                               width: noteWidth, height: size.height), options: [.usesLineFragmentOrigin])
    }
    // 8 pt under the bar and centred on it, above it when the bar is docked
    // low; in the middle of the screen when the bar is not shown.
    static func placement(card: NSSize, bar: NSRect?, screen: NSRect, keep: CGFloat = 12) -> NSRect {
        var origin: NSPoint
        if let bar = bar, !bar.isEmpty {
            let low = bar.midY < screen.midY
            origin = NSPoint(x: bar.midX - card.width / 2,
                             y: low ? bar.maxY + MacDesign.promptGap : bar.minY - MacDesign.promptGap - card.height)
        } else {
            origin = NSPoint(x: screen.midX - card.width / 2, y: screen.midY - card.height / 2)
        }
        origin.x = max(screen.minX + keep, min(origin.x, screen.maxX - keep - card.width))
        origin.y = max(screen.minY + keep, min(origin.y, screen.maxY - keep - card.height))
        return NSRect(origin: origin, size: card)
    }
}

enum MacAccessPrompt {
    // The card's window. It must stay on screen while the helper is not the
    // active app: an NSPanel hides on deactivation by default, which left the
    // card existing but invisible whenever macOS declined to activate the
    // helper (Intel, macOS 26.6, three times).
    static func makePanel(_ frame: NSRect) -> MacPromptPanel {
        let panel = MacPromptPanel(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false
        panel.level = .modalPanel; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        // Excluded from capture: the agent can neither see nor click it.
        panel.sharingType = .none
        return panel
    }
    // Runs the prompt modally. Returns true only for an explicit Allow.
    // onPanel lets the guardian abort it on Stop; the expiry denies.
    static func run(message: String, fallback: String, bar: NSRect?, onPanel: (NSPanel?) -> Void, timedOut: inout Bool, card: MacPromptCardView? = nil) -> Bool {
        let view = card ?? MacPromptCardView(message: message, fallback: fallback)
        let screen = (bar.flatMap { b in NSScreen.screens.first { $0.frame.intersects(b) } } ?? NSScreen.main ?? NSScreen.screens.first)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let cardRect = MacPromptCardView.placement(card: view.card.size, bar: bar, screen: screen)
        let frame = cardRect.insetBy(dx: -view.margin, dy: -view.margin)
        let panel = makePanel(frame)
        panel.isMovableByWindowBackground = true   // the card body (title strip, note) drags it
        panel.title = view.title; panel.setAccessibilitySubrole(.dialog); panel.setAccessibilityTitle(view.title)
        panel.contentView = view
        let deny = view.deny, allow = view.allow
        deny.keyEquivalent = "\r"   // Return means Deny
        deny.target = Stopper.shared; deny.action = #selector(Stopper.deny)
        allow.target = Stopper.shared; allow.action = #selector(Stopper.allow)
        panel.onDeny = { Stopper.shared.deny() }
        panel.initialFirstResponder = deny
        onPanel(panel)
        // Ask to become the active app so Return and Esc reach the card. macOS
        // may refuse a background helper; the card is shown regardless and a
        // click on it gives it the keyboard.
        if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
        // It appears and disappears at once: live controls are not scaled.
        panel.orderFrontRegardless(); panel.makeKey(); panel.makeFirstResponder(deny)
        var expired = false
        let expiry = Timer(timeInterval: MacDesign.promptTimeout, repeats: false) { _ in expired = true; NSApp.abortModal() }
        RunLoop.main.add(expiry, forMode: .common); RunLoop.main.add(expiry, forMode: .modalPanel)
        let response = NSApp.runModal(for: panel)
        expiry.invalidate(); panel.orderOut(nil); onPanel(nil)
        NSApp.deactivate()
        timedOut = expired
        return response == .OK && !expired
    }
    final class Stopper: NSObject {
        static let shared = Stopper()
        @objc func allow() { NSApp.stopModal(withCode: .OK) }
        @objc func deny() { NSApp.stopModal(withCode: .cancel) }
    }
    // The bench's pictures: the same view, drawn offscreen. Writes PNGs.
    static func preview(to directory: String) throws -> [String] {
        let samples: [(String, String, (MacPromptCardView) -> Void)] = [
            ("app", "Allow this application for this session?\n\nMeeting notes — TextEdit\n/System/Applications/TextEdit.app/Contents/MacOS/TextEdit\nPID 18244\nAccess: full.\n\nTask: Type the meeting notes into TextEdit and save them.\n\nIts screenshots and accessibility text go to Antigravity's configured model. Ordinary actions run autonomously. Consequential effects need a separate confirmation. Your real mouse/keyboard will be used. Esc or Control+Option+F12 stops.", { _ in }),
            ("action-long", "Approve ONE sensitive operation?\n\nSave the notes as meeting.txt in Documents.\n\nApplication: /System/Applications/TextEdit.app/Contents/MacOS/TextEdit\nControl: Save\n\n" + String(repeating: "{\n  \"operation\": \"file_dialog\",\n  \"args\": { \"path\": \"/Users/owner/Documents/Projects/Quarterly/A-long-folder-name-that-has-no-spaces-anywhere/meeting.txt\" }\n}\n", count: 4) + "\nCheck the actual target. Never let an agent approve this dialog. Deny if the result is unclear.", { _ in }),
            ("launch", "Launch this application?\n\nOpen Calculator to check the totals.\n\n{\n  \"app\": \"/System/Applications/Calculator.app\",\n  \"args\": []\n}\n\nThis starts software with your account's privileges. No shell is used. Approve only if intended.", { _ in }),
            ("states-allow-hover", "Allow this application for this session?\n\nCalculator\nAccess: full.", { $0.allow.forcedHover = true; $0.deny.forcedFocus = true }),
            ("states-allow-press-focus", "Allow this application for this session?\n\nCalculator\nAccess: full.", { $0.allow.forcedPress = true; $0.allow.forcedFocus = true }),
            ("states-deny-hover-press", "Allow this application for this session?\n\nTerminal\nAccess: click only (terminal or IDE). Left clicks and scrolling; no typing, keys, right click or drag.", { $0.deny.forcedHover = true; $0.deny.forcedPress = true; $0.deny.forcedFocus = true }),
        ]
        var written: [String] = []
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let notice = "Its screenshots and accessibility text go to Antigravity's configured model. Ordinary actions run autonomously. Consequential effects need a separate confirmation. Your real mouse/keyboard will be used. Esc or Ctrl+Alt+F12 stops. Use a disposable account/VM for important data."
        let rows: [(String, MacPromptCardView)] = [
            ("row-full", MacPromptCardView(app: MacPromptApp.make(tier: "full", name: "TextEdit", conversation: true)!, host: "Antigravity",
                details: "/System/Applications/TextEdit.app/Contents/MacOS/TextEdit\nPID 18244\n\nTask: Type the meeting notes into TextEdit and save them.\n\n" + notice)),
            ("row-click", MacPromptCardView(app: MacPromptApp.make(tier: "click", name: "Terminal", conversation: false)!, host: "Antigravity",
                details: "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal\nPID 912\n\nTask: Read the build log.\n\n" + notice)),
            ("row-long", MacPromptCardView(app: MacPromptApp.make(tier: "full", name: "A very long application display name that keeps going", conversation: true)!, host: "",
                details: "/Applications/Long.app/Contents/MacOS/Long\nPID 4242\n\nTask: " + String(repeating: "Fill in every field of the long form and check each total. ", count: 9) + "\n\n" + notice)),
        ]
        let cards = samples.map { sample -> (String, MacPromptCardView) in
            let view = MacPromptCardView(message: sample.1, fallback: "Computer Use needs your answer"); sample.2(view); return (sample.0, view)
        } + rows
        for (name, view) in cards {
            let sheet = NSView(frame: view.frame); sheet.wantsLayer = true
            sheet.layer?.backgroundColor = NSColor(srgbRed: 31 / 255, green: 33 / 255, blue: 40 / 255, alpha: 1).cgColor
            sheet.addSubview(view)
            guard let rep = sheet.bitmapImageRepForCachingDisplay(in: sheet.bounds) else { throw AxonError("preview_failed", "Cannot allocate a preview bitmap.") }
            sheet.cacheDisplay(in: sheet.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else { throw AxonError("preview_failed", "Cannot encode a preview.") }
            let path = (directory as NSString).appendingPathComponent("prompt-\(name).png")
            try png.write(to: URL(fileURLWithPath: path)); written.append(path)
        }
        return written
    }
}
