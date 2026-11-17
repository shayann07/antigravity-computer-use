// One place for the Mac's visual values. Every colour, size, duration and
// easing a view uses comes from here; a raw duration or easing in a view is a
// mistake. The values match server/native/DesktopVisuals.cs (the Windows
// reference) and docs/visual-design.md; only the drawing is native AppKit.
import AppKit
import QuartzCore

enum MacDesign {
    // ---- Motion, in seconds.
    static let fast: TimeInterval = 0.100        // hover, toggle
    static let normal: TimeInterval = 0.200      // appear, state change
    static let slow: TimeInterval = 0.300        // the glow's entrance
    static let fastLeave: TimeInterval = 0.067   // leaving; Stop uses this one
    static let normalLeave: TimeInterval = 0.133 // leaving
    static let press: TimeInterval = 0.160       // a press landing...
    static let pressScale: CGFloat = 0.97        // ...and how far it goes
    static let menuFrom: CGFloat = 0.96          // a menu grows from this share of its size
    static let springSeconds: Double = 0.45      // the bar settling after a drag
    static let springBounce: Double = 0.15
    // Entering and leaving ease out; moving on screen eases in and out.
    static let easeOutPoints: (Float, Float, Float, Float) = (0.23, 1, 0.32, 1)
    static let easeInOutPoints: (Float, Float, Float, Float) = (0.77, 0, 0.175, 1)
    static var easeOut: CAMediaTimingFunction {
        CAMediaTimingFunction(controlPoints: easeOutPoints.0, easeOutPoints.1, easeOutPoints.2, easeOutPoints.3)
    }
    static var easeInOut: CAMediaTimingFunction {
        CAMediaTimingFunction(controlPoints: easeInOutPoints.0, easeInOutPoints.1, easeInOutPoints.2, easeInOutPoints.3)
    }
    // The same curves as numbers, for frame-driven drawing and for checks.
    static func easeOut(_ t: Double) -> Double { bezier(t, easeOutPoints) }
    static func easeInOut(_ t: Double) -> Double { bezier(t, easeInOutPoints) }
    static func bezier(_ t: Double, _ points: (Float, Float, Float, Float)) -> Double {
        let x = max(0, min(1, t.isFinite ? t : 0))
        let (x1, y1, x2, y2) = (Double(points.0), Double(points.1), Double(points.2), Double(points.3))
        var p = x
        for _ in 0..<8 {
            let at = 3 * (1 - p) * (1 - p) * p * x1 + 3 * (1 - p) * p * p * x2 + p * p * p - x
            let slope = 3 * (1 - p) * (1 - p) * x1 + 6 * (1 - p) * p * (x2 - x1) + 3 * p * p * (1 - x2)
            if abs(slope) < 1e-6 { break }
            p = max(0, min(1, p - at / slope))
        }
        if x == 0 { return 0 }
        if x == 1 { return 1 }
        return 3 * (1 - p) * (1 - p) * p * y1 + 3 * (1 - p) * p * p * y2 + p * p * p
    }
    // Reduce Motion: movement becomes an instant change or a short fade.
    static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    static var increaseContrast: Bool { NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast }

    // ---- Colour. The bar and the prompt are always dark: they float over
    // unknown content. Increase Contrast switches to system colours.
    static func rgb(_ r: Int, _ g: Int, _ b: Int, _ a: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: a)
    }
    static func contract(_ key: String, _ fallback: (Int, Int, Int)) -> NSColor {
        if let value = MacContract.value["ui"] as? [String: Any], let list = value[key] as? [Int], list.count == 3,
           list.allSatisfy({ (0...255).contains($0) }) { return rgb(list[0], list[1], list[2]) }
        if let list = MacContract.value[key] as? [Int], list.count == 3, list.allSatisfy({ (0...255).contains($0) }) {
            return rgb(list[0], list[1], list[2])
        }
        return rgb(fallback.0, fallback.1, fallback.2)
    }
    static let inkSurface = rgb(18, 22, 29), inkRaised = rgb(28, 34, 44)
    static let paperText = rgb(242, 245, 248), mist = rgb(169, 180, 192), rest = rgb(213, 220, 228)
    static let amber = rgb(240, 184, 102), rose = rgb(255, 143, 160), slate = rgb(27, 39, 53)
    static var violet: NSColor { contract("accent_rgb", (155, 205, 235)) }
    static var blue: NSColor { contract("blue_rgb", (128, 171, 207)) }
    static let hairline = NSColor(white: 1, alpha: 41.0 / 255)
    static let rule = NSColor(white: 1, alpha: 26.0 / 255)
    // One neutral drop shadow: 0 12 28, black 34 %.
    static let shadowOffset = CGSize(width: 0, height: -12), shadowBlur: CGFloat = 28, shadowOpacity: Float = 0.34

    // ---- The access prompt (docs/visual-design.md, "Access prompt").
    static let promptWidth: CGFloat = 496, promptRadius: CGFloat = 18
    static let promptPad: CGFloat = 16, promptTitle: CGFloat = 22, promptBodyMost: CGFloat = 300
    static let promptButtonWidth: CGFloat = 104, promptButtonHeight: CGFloat = 44, promptButtonRadius: CGFloat = 12
    static let promptRing: CGFloat = 3, promptButtonGap: CGFloat = 8, promptGap: CGFloat = 8
    // The app row (card:1), as DesktopVisuals.cs PromptSub and PromptRow.
    static let promptSub: CGFloat = 18, promptRow: CGFloat = 56
    static let promptTimeout: TimeInterval = 90
    static let promptNote = "No answer in 90 s counts as Deny"
    static let promptTitleFont = NSFont.systemFont(ofSize: 16, weight: .semibold)
    static let promptBodyFont = NSFont.systemFont(ofSize: 13)
    static let promptNoteFont = NSFont.systemFont(ofSize: 12)
    static let promptButtonFont = NSFont.systemFont(ofSize: 13, weight: .semibold)
}
