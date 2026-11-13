// Official Phosphor SVG artwork, shared with the Windows package helper.
// MIT license and pinned upstream revision: licenses/Phosphor-Icons.txt, UPSTREAM.json.
import AppKit
import Foundation

enum MacPhosphorIcon: String, Equatable, CaseIterable {
    case slidersHorizontalFill = "sliders-horizontal-fill"
    case pauseFill = "pause-fill"
    case playFill = "play-fill"
    case stopFill = "stop-fill"
    case xFill = "x-fill"

    private static var images: [MacPhosphorIcon: NSImage] = [:]
    var fallbackLabel: String {
        switch self {
        case .slidersHorizontalFill: return "More"
        case .pauseFill: return "Pause"
        case .playFill: return "Play"
        case .stopFill: return "Stop"
        case .xFill: return "Hide"
        }
    }
    func image() -> NSImage? {
        if let image = Self.images[self] { return image }
        guard let url = Bundle.main.url(forResource: rawValue, withExtension: "svg", subdirectory: "Phosphor"),
              let original = try? String(contentsOf: url, encoding: .utf8),
              // Tint only; never redraw or approximate the official path geometry.
              let image = NSImage(data: Data(original.replacingOccurrences(of: "currentColor", with: "#E8EFF5").utf8)),
              image.size.width > 0, image.size.height > 0 else { return nil }
        Self.images[self] = image
        return image
    }
    @discardableResult func drawFilled(in rect: NSRect) -> Bool {
        guard let image = image() else { return false }
        image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        return true
    }

    // Offscreen resource/decoder checks; no screen capture, input or OS permission.
    static func validateAssets() throws -> Int {
        for icon in allCases {
            guard let image = icon.image(),
                  let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32,
                    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                  let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
                throw AxonError("hud_asset_invalid", "An official Phosphor HUD resource could not be decoded.")
            }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = context
            NSColor.clear.setFill(); NSRect(x: 0, y: 0, width: 32, height: 32).fill(using: .copy)
            image.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32), from: .zero, operation: .sourceOver, fraction: 1)
            context.flushGraphics()
            NSGraphicsContext.restoreGraphicsState()
            var ink = 0
            for y in 0..<32 { for x in 0..<32 {
                if let color = bitmap.colorAt(x: x, y: y), color.alphaComponent > 0.5 { ink += 1 }
            }}
            guard ink > 30, ink < 900 else {
                throw AxonError("hud_asset_invalid", "An official Phosphor HUD resource rendered blank or opaque.")
            }
        }
        return allCases.count
    }
}
