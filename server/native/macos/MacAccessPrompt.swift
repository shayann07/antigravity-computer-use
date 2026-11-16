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

final class MacPromptCardView: NSView {
    let title: String
    let scroll = NSScrollView()
    let body = NSTextView()
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
    init(message: String, fallback: String, margin: CGFloat = 36) {
        let parts = MacPromptCardView.split(message, fallback: fallback)
        title = parts.title; self.margin = margin
        super.init(frame: .zero)
        let pad = MacDesign.promptPad, width = MacDesign.promptWidth, inner = width - 2 * pad
        let contrast = MacDesign.increaseContrast
        body.string = parts.body; body.isEditable = false; body.isSelectable = true; body.drawsBackground = false
        body.font = MacDesign.promptBodyFont; body.textColor = contrast ? .labelColor : MacDesign.rest
        body.textContainerInset = .zero; body.textContainer?.lineFragmentPadding = 0
        body.textContainer?.widthTracksTextView = true; body.isVerticallyResizable = true; body.isHorizontallyResizable = false
        body.frame = NSRect(x: 0, y: 0, width: inner, height: 10)
        body.textContainer?.containerSize = NSSize(width: inner, height: .greatestFiniteMagnitude)
        body.setAccessibilityLabel("Request")
        body.layoutManager?.ensureLayout(for: body.textContainer!)
        let used = ceil(body.layoutManager?.usedRect(for: body.textContainer!).height ?? 0) + 2
        // As tall as its text, up to the limit; past that it scrolls, and nothing is cut.
        bodyScrolls = used > MacDesign.promptBodyMost
        let tall = min(max(used, 18), MacDesign.promptBodyMost)
        body.frame.size.height = max(used, tall)
        scroll.documentView = body; scroll.drawsBackground = false; scroll.borderType = .noBorder
        scroll.hasVerticalScroller = bodyScrolls; scroll.scrollerStyle = .overlay; scroll.scrollerKnobStyle = contrast ? .default : .light
        let top = pad + MacDesign.promptTitle + 8
        card = NSRect(x: margin, y: margin, width: width, height: 0)
        scroll.frame = NSRect(x: margin + pad, y: margin + top, width: inner, height: tall)
        rule = top + tall + 12
        let row = rule + 12
        let ring = MacDesign.promptRing, across = MacDesign.promptButtonWidth + 2 * ring, down = MacDesign.promptButtonHeight + 2 * ring
        deny.frame = NSRect(x: margin + width - pad - MacDesign.promptButtonWidth - ring, y: margin + row - ring, width: across, height: down)
        allow.frame = NSRect(x: deny.frame.minX - MacDesign.promptButtonGap - MacDesign.promptButtonWidth, y: deny.frame.minY, width: across, height: down)
        card.size.height = row + MacDesign.promptButtonHeight + pad
        frame = NSRect(x: 0, y: 0, width: width + 2 * margin, height: card.height + 2 * margin)
        // Deny first in the key loop: it holds the focus when the prompt opens.
        deny.nextKeyView = allow; allow.nextKeyView = body; body.nextKeyView = deny
        [scroll, allow, deny].forEach(addSubview)
        setAccessibilityElement(true); setAccessibilityRole(.group); setAccessibilityLabel(title)
    }
    required init?(coder: NSCoder) { fatalError("unused") }
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
    // Runs the prompt modally. Returns true only for an explicit Allow.
    // onPanel lets the guardian abort it on Stop; the expiry denies.
    static func run(message: String, fallback: String, bar: NSRect?, onPanel: (NSPanel?) -> Void, timedOut: inout Bool) -> Bool {
        let view = MacPromptCardView(message: message, fallback: fallback)
        let screen = (bar.flatMap { b in NSScreen.screens.first { $0.frame.intersects(b) } } ?? NSScreen.main ?? NSScreen.screens.first)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let cardRect = MacPromptCardView.placement(card: view.card.size, bar: bar, screen: screen)
        let frame = cardRect.insetBy(dx: -view.margin, dy: -view.margin)
        let panel = MacPromptPanel(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.level = .modalPanel; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        // Excluded from capture: the agent can neither see nor click it.
        panel.sharingType = .none
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
        NSApp.activate(ignoringOtherApps: true)
        // It appears and disappears at once: live controls are not scaled.
        panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(deny)
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
        for (name, message, adjust) in samples {
            let view = MacPromptCardView(message: message, fallback: "Computer Use needs your answer")
            adjust(view)
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
