// The light around the window the agent is working in (docs/visual-design.md,
// "Edge glow"). Original artwork; no vendor assets. It is light, not an
// outline: a soft band on the window's edge that falls away to nothing, in one
// palette for every app (blue with a touch of violet). It is never static: the
// colours travel one lap in GlowLap seconds and the band slowly swells, on a
// 15 fps clock at rest as on Windows; the guardian's 70 ms tick re-reads one
// window's bounds.
// Its brightest part eases toward the agent's last action; that is the only
// response to an action. Reduce Motion stops the drift and the easing.
import AppKit
import CoreGraphics
import QuartzCore

enum MacGlowLevel: String, CaseIterable {
    case soft, medium, bright
    var gain: Float { switch self { case .soft: return 0.55; case .medium: return 0.78; case .bright: return 1.0 } }
    var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
    static func saved(in directory: URL) -> MacGlowLevel {
        let path = directory.appendingPathComponent("control-preferences.json")
        let value = (try? Data(contentsOf: path)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        return (value?["glow_brightness"] as? String).flatMap(MacGlowLevel.init(rawValue:)) ?? .soft
    }
    func save(in directory: URL) {
        let path = directory.appendingPathComponent("control-preferences.json")
        var value = (try? Data(contentsOf: path)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        value["glow_brightness"] = rawValue
        if let bytes = try? JSONSerialization.data(withJSONObject: value) { try? bytes.write(to: path, options: [.atomic]); chmod(path.path, 0o600) }
    }
}

enum MacGlowShape {
    // Glow timing, matching DesktopVisuals.cs GlowLap and GlowBreath.
    static let lap: CFTimeInterval = 60, breath: CFTimeInterval = 7
    static let restFrame: TimeInterval = 0.066   // DesktopVisuals.cs GlowRestFrame: 15 redraws a second at rest
    static let reach: CGFloat = 46          // how far the light spills outside the window
    static let lip: CGFloat = 10            // how far it reaches inside
    static let corner: CGFloat = 10         // the window's corner radius
    // One family, blue through a touch of violet; every blend lifted to full
    // brightness so the light never passes through a dull mix.
    static let tones: [(Int, Int, Int)] = [(84, 150, 255), (124, 206, 255), (98, 132, 255), (150, 128, 255), (104, 184, 255), (132, 216, 255)]
    static func lifted(_ c: (Int, Int, Int)) -> CGColor {
        let top = CGFloat(max(c.0, c.1, c.2)), lift = top > 0 ? 255 / top : 1
        return CGColor(srgbRed: min(1, CGFloat(c.0) * lift / 255), green: min(1, CGFloat(c.1) * lift / 255), blue: min(1, CGFloat(c.2) * lift / 255), alpha: 1)
    }
    // Signed distance from a point to a rounded rectangle (negative inside).
    static func distance(_ x: CGFloat, _ y: CGFloat, _ rect: CGRect, _ radius: CGFloat) -> CGFloat {
        let cx = abs(x - rect.midX) - (rect.width / 2 - radius), cy = abs(y - rect.midY) - (rect.height / 2 - radius)
        let outside = hypot(max(cx, 0), max(cy, 0)), inside = min(max(cx, cy), 0)
        return outside + inside - radius
    }
    // Alpha of the band at a signed distance: a Gaussian falloff outside, a
    // short lip inside, both reaching zero with no visible edge.
    // A smooth taper takes it exactly to zero before the panel's edge, so
    // there is never a visible rectangle.
    static func alpha(_ d: CGFloat, spread: CGFloat = 1) -> CGFloat {
        func taper(_ t: CGFloat) -> CGFloat { let x = max(0, min(1, (t - 0.55) / 0.45)); return 1 - x * x * (3 - 2 * x) }
        let far = reach * spread, near = lip * max(spread, 0.6)
        if d >= 0 { let s = far / 2.8; return 0.92 * exp(-(d * d) / (2 * s * s)) * taper(d / far) }
        let s = near / 2.6, depth = near * 1.6; return 0.92 * exp(-(d * d) / (2 * s * s)) * taper(-d / depth)
    }
    // Edges with no room outside (a maximised or full-screen window) are lit
    // inside instead, as on Windows: the light starts at the edge and falls
    // away into the window over the same reach.
    struct Inside: Equatable { var left = false, right = false, bottom = false, top = false
        var any: Bool { left || right || bottom || top } }
    // AppKit rects: an edge is lit inside when the screen leaves it less than
    // half the reach.
    static func inside(window: CGRect, screen: CGRect) -> Inside {
        let room = reach / 2
        return Inside(left: window.minX - screen.minX < room, right: screen.maxX - window.maxX < room,
                      bottom: window.minY - screen.minY < room, top: screen.maxY - window.maxY < room)
    }
    // The band as an alpha mask in points. Ordered dithering spreads the 8-bit
    // steps, so faint light melts away instead of stepping. Only the band is
    // computed; the window's interior stays transparent. spread < 1 is the
    // narrow band the entrance widens from.
    static func mask(size: CGSize, window: CGRect, inside: Inside = Inside(), spread: CGFloat = 1) -> CGImage? {
        let w = max(1, Int(ceil(size.width))), h = max(1, Int(ceil(size.height)))
        guard w * h <= 40_000_000, let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                     space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue),
              let bytes = context.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
        let bayer: [CGFloat] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
        let deep = reach * spread, edge = lip * max(spread, 0.6) * 1.6
        let inner = CGRect(x: window.minX + (inside.left ? deep : edge), y: window.minY + (inside.bottom ? deep : edge),
                           width: window.width - (inside.left ? deep : edge) - (inside.right ? deep : edge),
                           height: window.height - (inside.bottom ? deep : edge) - (inside.top ? deep : edge))
        for row in 0..<h {
            // CGContext rows run bottom-up; the window rect is in the same space.
            let y = CGFloat(row) + 0.5, base = (h - 1 - row) * w
            for column in 0..<w {
                let x = CGFloat(column) + 0.5
                if inner.width > 0 && inner.height > 0 && inner.contains(CGPoint(x: x, y: y)) { bytes[base + column] = 0; continue }
                var a = alpha(distance(x, y, window, corner), spread: spread)
                if inside.any && window.contains(CGPoint(x: x, y: y)) {
                    // A soft union, not the larger value: the two edges of a
                    // corner meet with no seam.
                    var clear = 1 - a
                    if inside.left { clear *= 1 - alpha(x - window.minX, spread: spread) }
                    if inside.right { clear *= 1 - alpha(window.maxX - x, spread: spread) }
                    if inside.bottom { clear *= 1 - alpha(y - window.minY, spread: spread) }
                    if inside.top { clear *= 1 - alpha(window.maxY - y, spread: spread) }
                    a = 1 - clear
                }
                let value = a * 255 + (bayer[(row & 3) * 4 + (column & 3)] / 16 - 0.5)
                bytes[base + column] = UInt8(max(0, min(255, value.rounded())))
            }
        }
        return context.makeImage()
    }
}

final class MacWindowGlow {
    private(set) var panel: NSPanel?
    private let root = CALayer(), colour = CAGradientLayer(), spot = CAGradientLayer(), band = CALayer()
    private(set) var windowID: CGWindowID = 0
    private(set) var frame = CGRect.zero        // the window, AppKit global coordinates
    private var maskSize = CGSize.zero
    private(set) var shown = false
    var level: MacGlowLevel = .soft { didSet { applyLevel(animated: true) } }

    // Finds the on-screen window of an approved process whose bounds best
    // match the AX rectangle the worker reported (top-left global points).
    static func matchWindow(pid: pid_t, rect: CGRect, list: [[String: Any]]) -> (CGWindowID, CGRect)? {
        var best: (CGWindowID, CGRect, CGFloat)?
        for row in list {
            guard (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                  (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let number = (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  let bounds = row[kCGWindowBounds as String] as? [String: Any],
                  let r = CGRect(dictionaryRepresentation: bounds as CFDictionary), r.width >= 40, r.height >= 40 else { continue }
            let score = abs(r.minX - rect.minX) + abs(r.minY - rect.minY) + abs(r.width - rect.width) + abs(r.height - rect.height)
            if best == nil || score < best!.2 { best = (number, r, score) }
        }
        guard let found = best, found.2 <= 24 else { return nil }
        return (found.0, found.1)
    }
    static func bounds(of id: CGWindowID) -> CGRect? {
        guard id != 0, let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]],
              let row = list.first, (row[kCGWindowIsOnscreen as String] as? Bool) == true,
              let bounds = row[kCGWindowBounds as String] as? [String: Any] else { return nil }
        return CGRect(dictionaryRepresentation: bounds as CFDictionary)
    }
    // CoreGraphics global (top-left origin) to AppKit global (bottom-left).
    static func appKit(_ r: CGRect, primaryHeight: CGFloat? = nil) -> CGRect {
        let height = primaryHeight ?? NSScreen.screens.first?.frame.height ?? 0
        return CGRect(x: r.minX, y: height - r.maxY, width: r.width, height: r.height)
    }
    static func appKit(_ p: CGPoint, primaryHeight: CGFloat? = nil) -> CGPoint {
        let height = primaryHeight ?? NSScreen.screens.first?.frame.height ?? 0
        return CGPoint(x: p.x, y: height - p.y)
    }

    private var orderedAt: CFTimeInterval = 0
    var recordable = false { didSet { panel?.sharingType = recordable ? .readOnly : .none } }
    private func build() {
        guard panel == nil else { return }
        let p = MacGlowPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false; p.ignoresMouseEvents = true
        // Normal level, ordered just above the target window: a window that covers
        // the target also covers its glow, as on Windows.
        p.level = .normal; p.hidesOnDeactivate = false; p.isReleasedWhenClosed = false
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        // Out of recordings unless the human turns "Show bar and glow in
        // recordings" on; the runtime's own screenshots hide it either way.
        p.sharingType = recordable ? .readOnly : .none
        let view = NSView(); view.wantsLayer = true; view.layer = root
        p.contentView = view
        colour.type = .conic; colour.startPoint = CGPoint(x: 0.5, y: 0.5); colour.endPoint = CGPoint(x: 1, y: 0.5)
        let stops = MacGlowShape.tones.map(MacGlowShape.lifted)
        colour.colors = stops + [stops[0]]
        spot.type = .radial; spot.startPoint = CGPoint(x: 0.5, y: 0.5); spot.endPoint = CGPoint(x: 1, y: 1)
        spot.colors = [CGColor(srgbRed: 0.86, green: 0.93, blue: 1, alpha: 0.9), CGColor(srgbRed: 0.6, green: 0.8, blue: 1, alpha: 0)]
        band.addSublayer(colour); band.addSublayer(spot)
        root.addSublayer(band); root.opacity = 0
        panel = p
    }
    // The window the light belongs to. It survives the light leaving (the
    // window minimised, hidden or jumping) and enters again once the window
    // is back and its bounds have settled for 120 ms.
    private var parked = false, passing = false
    private var seen = CGRect.zero, seenAt = 0.0, pending: CGPoint?
    private var inside = MacGlowShape.Inside()
    private let wide = CALayer(), narrow = CALayer(), masks = CALayer()
    // Shows or moves the light to a window. point: the action, AppKit global.
    func show(windowID id: CGWindowID, frame window: CGRect, point: CGPoint?, pulse: Bool) {
        build()
        _ = pulse   // An action moves the bright part only; no other motion.
        if id != windowID {
            // glow.pass: another window. This light leaves; the new one enters on its own bounds.
            windowID = id; seen = window; seenAt = CACurrentMediaTime() - 1; pending = point
            if shown { pass() } else if !passing { enter(window) }
            return
        }
        if let point = point {
            if shown && !passing { aim(at: point, animated: !MacDesign.reduceMotion) } else { pending = point }
        }
        if !shown && !passing && !parked { seen = window; enter(window) }
    }
    // glow.enter: the light fades up while the band widens from the window's
    // edge, over Slow, easing out. With Reduce Motion it is a short fade and
    // nothing grows.
    private func enter(_ window: CGRect) {
        guard let panel = panel else { return }
        let reduce = MacDesign.reduceMotion
        parked = false; shown = true
        relayout(window, widening: !reduce)
        let near = window.insetBy(dx: -24, dy: -24)
        aim(at: pending.flatMap { near.contains($0) ? $0 : nil } ?? CGPoint(x: window.midX, y: window.minY), animated: false); pending = nil
        CATransaction.begin(); CATransaction.setDisableActions(true); root.opacity = 0
        wide.opacity = reduce ? 1 : 0; narrow.opacity = reduce ? 0 : 1; CATransaction.commit()
        panel.order(.above, relativeTo: Int(windowID)); orderedAt = CACurrentMediaTime()
        startDrift(reduce: reduce)
        CATransaction.begin(); CATransaction.setAnimationDuration(reduce ? MacDesign.fast : MacDesign.slow)
        CATransaction.setAnimationTimingFunction(MacDesign.easeOut)
        root.opacity = level.gain
        if !reduce { wide.opacity = 1; narrow.opacity = 0 }
        CATransaction.commit()
    }
    // glow.pass: the window jumped (resized, maximised, minimised) or the
    // agent moved to another one. The light leaves over NormalLeave and
    // enters again where it now belongs.
    private func pass() {
        guard shown, !passing, let panel = panel else { return }
        shown = false; parked = true
        if MacDesign.reduceMotion { drift?.invalidate(); drift = nil; root.opacity = 0; panel.orderOut(nil); return }
        passing = true
        CATransaction.begin(); CATransaction.setAnimationDuration(MacDesign.normalLeave); CATransaction.setAnimationTimingFunction(MacDesign.easeOut)
        CATransaction.setCompletionBlock { [weak self] in
            guard let self = self else { return }
            self.passing = false
            if !self.shown { panel.orderOut(nil); self.drift?.invalidate(); self.drift = nil }
        }
        root.opacity = 0; CATransaction.commit()
    }
    private func relayout(_ window: CGRect, widening: Bool = false) {
        guard let panel = panel else { return }
        let outer = window.insetBy(dx: -MacGlowShape.reach, dy: -MacGlowShape.reach)
        let screen = (NSScreen.screens.first { $0.frame.contains(CGPoint(x: window.midX, y: window.midY)) } ?? NSScreen.main)?.frame ?? outer
        let sides = MacGlowShape.inside(window: window, screen: screen)
        frame = window
        CATransaction.begin(); CATransaction.setDisableActions(true)
        panel.setFrame(outer, display: false)
        root.frame = CGRect(origin: .zero, size: outer.size); band.frame = root.bounds
        let side = hypot(outer.width, outer.height)
        colour.bounds = CGRect(x: 0, y: 0, width: side, height: side); colour.position = CGPoint(x: outer.width / 2, y: outer.height / 2)
        let local = CGRect(x: MacGlowShape.reach, y: MacGlowShape.reach, width: window.width, height: window.height)
        if outer.size != maskSize || sides != inside {
            maskSize = outer.size; inside = sides
            masks.frame = band.bounds; wide.frame = masks.bounds; narrow.frame = masks.bounds
            wide.contents = MacGlowShape.mask(size: outer.size, window: local, inside: sides)
            narrow.contents = nil
            if masks.sublayers == nil { masks.addSublayer(narrow); masks.addSublayer(wide) }
            band.mask = masks
        }
        if widening && narrow.contents == nil { narrow.contents = MacGlowShape.mask(size: outer.size, window: local, inside: sides, spread: 0.35) }
        CATransaction.commit()
    }
    private func aim(at point: CGPoint, animated: Bool) {
        guard let panel = panel else { return }
        let local = CGPoint(x: point.x - panel.frame.minX, y: point.y - panel.frame.minY)
        let size = max(220, min(panel.frame.width, panel.frame.height) * 0.9)
        CATransaction.begin()
        if animated { CATransaction.setAnimationDuration(MacDesign.normal); CATransaction.setAnimationTimingFunction(MacDesign.easeInOut) }
        else { CATransaction.setDisableActions(true) }
        spot.bounds = CGRect(x: 0, y: 0, width: size, height: size); spot.position = local
        CATransaction.commit()
    }
    // The drift runs on a 15 fps clock (GlowRestFrame), not as a continuous
    // Core Animation: a layer animating every display frame makes the window
    // server recomposite the whole panel at 60 fps, which measured far costlier
    // at rest. Each tick sets the colours' turn and the band's swell with
    // implicit animations disabled.
    private var drift: Timer?
    private var driftOrigin: CFTimeInterval = 0
    private func startDrift(reduce: Bool) {
        drift?.invalidate(); drift = nil
        colour.removeAllAnimations(); band.removeAllAnimations()
        guard !reduce else { return }
        driftOrigin = CACurrentMediaTime()
        let timer = Timer(timeInterval: MacGlowShape.restFrame, repeats: true) { [weak self] _ in self?.driftTick() }
        RunLoop.main.add(timer, forMode: .common); RunLoop.main.add(timer, forMode: .modalPanel)
        drift = timer; driftTick()
    }
    // Frame times at rest, for --glow-trial: how long each 15 fps tick takes
    // in this process and how far apart the ticks land.
    private(set) var tickCount = 0, tickSeconds = 0.0, tickWorst = 0.0, intervalSeconds = 0.0
    private var lastTick = 0.0
    func resetStats() { tickCount = 0; tickSeconds = 0; tickWorst = 0; intervalSeconds = 0; lastTick = 0 }
    private func driftTick() {
        guard shown || passing else { drift?.invalidate(); drift = nil; return }
        let started = CACurrentMediaTime()
        let t = started - driftOrigin
        let turn = -2 * Double.pi * (t / MacGlowShape.lap).truncatingRemainder(dividingBy: 1)
        let swell = 1 + 0.006 * (1 - cos(2 * Double.pi * t / MacGlowShape.breath))
        CATransaction.begin(); CATransaction.setDisableActions(true)
        colour.setAffineTransform(CGAffineTransform(rotationAngle: CGFloat(turn)))
        band.setAffineTransform(CGAffineTransform(scaleX: CGFloat(swell), y: CGFloat(swell)))
        CATransaction.commit(); CATransaction.flush()
        let spent = CACurrentMediaTime() - started
        if lastTick > 0 { intervalSeconds += started - lastTick; tickCount += 1; tickSeconds += spent; tickWorst = max(tickWorst, spent) }
        lastTick = started
    }
    private func applyLevel(animated: Bool) {
        guard shown && !passing else { return }
        CATransaction.begin(); CATransaction.setAnimationDuration(animated && !MacDesign.reduceMotion ? MacDesign.fast : 0)
        CATransaction.setAnimationTimingFunction(MacDesign.easeOut); root.opacity = level.gain; CATransaction.commit()
    }
    // Called from the guardian's tick: follows the window 1:1 while it moves
    // at the same size (no easing while it is dragged), passes when it jumps
    // or leaves the screen, and enters again once it is back and settled.
    func follow() {
        guard windowID != 0, shown || parked || passing else { return }
        let now = CACurrentMediaTime()
        guard let bounds = MacWindowGlow.bounds(of: windowID) else { pass(); seen = .zero; return }
        let window = MacWindowGlow.appKit(bounds)
        if window != seen {
            if shown && !passing && window.size == frame.size { relayout(window) } else if shown { pass() }
            seen = window; seenAt = now; return
        }
        if parked && !passing && now - seenAt >= 0.12 { enter(window) }
        // The target may have been raised above the glow since; stay just above it.
        if shown, let panel = panel, now - orderedAt >= 0.5 { panel.order(.above, relativeTo: Int(windowID)); orderedAt = now }
    }
    func hide(immediately: Bool = false) {
        parked = false; pending = nil
        guard shown || passing, let panel = panel else { windowID = 0; return }
        shown = false; windowID = 0
        if immediately || MacDesign.reduceMotion { passing = false; drift?.invalidate(); drift = nil; CATransaction.begin(); CATransaction.setDisableActions(true); root.opacity = 0; CATransaction.commit(); panel.orderOut(nil); return }
        passing = true
        CATransaction.begin(); CATransaction.setAnimationDuration(MacDesign.normalLeave); CATransaction.setAnimationTimingFunction(MacDesign.easeOut)
        CATransaction.setCompletionBlock { [weak self] in
            guard let self = self else { return }
            self.passing = false
            if !self.shown { panel.orderOut(nil); self.drift?.invalidate(); self.drift = nil }
        }
        root.opacity = 0; CATransaction.commit()
    }
    // The bench: renders the band offscreen at a given window size.
    static func preview(window: CGSize, to path: String, background: NSColor, level: MacGlowLevel = .soft, fullScreen: Bool = false, spread: CGFloat = 1) throws {
        // Full screen: the window is the whole picture and every edge is lit inside.
        let pad = fullScreen ? 0 : MacGlowShape.reach
        let outer = CGSize(width: window.width + 2 * pad, height: window.height + 2 * pad)
        let local = CGRect(x: pad, y: pad, width: window.width, height: window.height)
        let sides = fullScreen ? MacGlowShape.Inside(left: true, right: true, bottom: true, top: true) : MacGlowShape.Inside()
        guard let mask = MacGlowShape.mask(size: outer, window: local, inside: sides, spread: spread),
              let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(outer.width), pixelsHigh: Int(outer.height), bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: rep) else { throw AxonError("preview_failed", "Cannot allocate a glow preview.") }
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
        let cg = context.cgContext
        cg.setFillColor(background.cgColor); cg.fill(CGRect(origin: .zero, size: outer))
        cg.setFillColor(NSColor(white: background.whiteComponentSafe > 0.5 ? 0.97 : 0.16, alpha: 1).cgColor)
        cg.addPath(CGPath(roundedRect: local, cornerWidth: MacGlowShape.corner, cornerHeight: MacGlowShape.corner, transform: nil)); cg.fillPath()
        cg.saveGState(); cg.clip(to: CGRect(origin: .zero, size: outer), mask: mask)
        let stops = MacGlowShape.tones.map(MacGlowShape.lifted) + [MacGlowShape.lifted(MacGlowShape.tones[0])]
        let centre = CGPoint(x: outer.width / 2, y: outer.height / 2)
        // The same conic gradient layer the live glow turns, rendered once.
        let sweep = CAGradientLayer()
        sweep.type = .conic; sweep.startPoint = CGPoint(x: 0.5, y: 0.5); sweep.endPoint = CGPoint(x: 1, y: 0.5)
        sweep.colors = stops; sweep.opacity = level.gain
        sweep.frame = CGRect(origin: .zero, size: outer); _ = centre
        sweep.render(in: cg)
        cg.restoreGState()
        NSGraphicsContext.restoreGraphicsState()
        guard let png = rep.representation(using: .png, properties: [:]) else { throw AxonError("preview_failed", "Cannot encode a glow preview.") }
        try png.write(to: URL(fileURLWithPath: path))
    }
}

private extension NSColor {
    var whiteComponentSafe: CGFloat { (usingColorSpace(.genericGray) ?? self).whiteComponent }
}

// At normal level AppKit moves a window out from under the menu bar. The glow
// reaches past its window's edges, so for a window near the top that shifted
// the whole band down. The glow's frame is exact; never constrain it.
final class MacGlowPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}
