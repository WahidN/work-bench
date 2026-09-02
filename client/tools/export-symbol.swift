// Exports the SF Symbol that MenuBarIconRenderer.swift draws, so the Tauri client can
// use the real glyph instead of an approximation of it.
//
// A webview canvas has no access to SF Symbols, and the tray needs raster bytes
// anyway, so the honest options were to hand-draw a lookalike or to export the real
// symbol once and bundle it. This does the second. Run it by hand, not at build time:
// the output is committed, and a machine without Xcode must still be able to build the
// client.
//
//   swift tools/export-symbol.swift
//
// The trade this locks in: the glyph stops following the system. A future macOS that
// restyles checkmark.circle, or a change of symbol weight, needs this re-run.

import AppKit

let symbolName = "checkmark.circle"
let outputDirectory = "public/tray"

// 18pt is the size MenuBarIconRenderer uses. Both scales are exported because the tray
// is drawn at the screen's backing scale, and a 1x asset on a Retina menu bar is soft.
let scales: [(name: String, scale: CGFloat)] = [("tray-18", 1), ("tray-18@2x", 2)]

guard
    let symbol = NSImage(
        systemSymbolName: symbolName,
        accessibilityDescription: "Workbench"
    )
else {
    FileHandle.standardError.write("could not load SF Symbol \(symbolName)\n".data(using: .utf8)!)
    exit(1)
}

// Deliberately NO symbol configuration.
//
// MenuBarIconRenderer.swift draws the symbol straight out of
// `NSImage(systemSymbolName:)` and lets `draw(in:)` scale it to fill 18x18. An earlier
// version of this script applied `SymbolConfiguration(pointSize: 18, weight: .regular)`
// first, which changes the glyph's metrics, and the pixel diff caught it: 92 of 324
// pixels differed at badge count 0, where nothing but this glyph is drawn.
let configured = symbol

try? FileManager.default.createDirectory(
    atPath: outputDirectory,
    withIntermediateDirectories: true
)

for (name, scale) in scales {
    let pixels = Int(18 * scale)
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixels,
        pixelsHigh: pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: pixels * 4,
        bitsPerPixel: 32
    )!
    bitmap.size = NSSize(width: 18, height: 18)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

    // No fill colour is set: an SF Symbol is a template image, so `draw(in:)` paints
    // it in its own black and the shape lives in the alpha channel, which is exactly
    // what both the tray's template tinting and the badge compositing want. Setting a
    // colour here would have had no effect anyway, which is why the earlier
    // `NSColor.white.set()` is gone.
    configured.draw(
        in: NSRect(x: 0, y: 0, width: 18, height: 18),
        from: .zero,
        operation: .sourceOver,
        fraction: 1
    )

    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("could not encode \(name)\n".data(using: .utf8)!)
        exit(1)
    }
    let path = "\(outputDirectory)/\(name).png"
    try! png.write(to: URL(fileURLWithPath: path))
    print("wrote \(path) at \(pixels)x\(pixels)")
}
