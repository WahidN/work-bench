// Renders the app icon from the app's own mark.
//
//   swift tools/render-app-icon.swift src-tauri/icons/source.png
//   pnpm tauri icon src-tauri/icons/source.png
//
// Why this exists rather than an icon file to copy: the Swift app has no icon asset at
// all, no .xcassets and no .appiconset, so it ships with the generic macOS application
// icon. There is nothing to port. What the app does have is a mark, the badge in
// `Sidebar.swift`'s `brandRow`: a wrench and screwdriver in an accent-bordered rounded
// square. Scaling that up is derivation from the app's own design rather than inventing
// a logo, which a port has no business doing.
//
// The alternative was shipping Tauri's own default icons, which are the Tauri logo. An
// app claiming in the Dock to be a Tauri sample is worse than a generic icon and worse
// than this.
//
// Every number is `brandRow` at 1x, multiplied: a 22pt badge with a 6pt radius, a 1pt
// accent border and a 12pt symbol, on the sidebar's raised tone.

import AppKit

let outputPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-source.png"

// macOS icons are drawn inside a rounded square that does not fill the canvas; the system
// grid leaves roughly a tenth clear on each side. 1024 is what `tauri icon` wants as its
// source.
let canvas: CGFloat = 1024
let inset: CGFloat = 96
let side = canvas - inset * 2

/// The scale from `brandRow`'s 22pt badge to this one, applied to every other number so
/// the proportions are the sidebar's rather than re-picked.
let scale = side / 22

func color(_ hex: UInt32) -> NSColor {
    NSColor(
        srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: 1
    )
}

// Theme.sidebarGradientTop and Theme.nocturneAccent.
let background = color(0x1A1C2B)
let accent = color(0x9184D9)

let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(canvas),
    pixelsHigh: Int(canvas),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: Int(canvas) * 4,
    bitsPerPixel: 32
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

let square = NSRect(x: inset, y: inset, width: side, height: side)
// `brandRow`'s 6pt radius on a 22pt badge, so a little over a quarter of the side. That is
// squarer than macOS's own superellipse, and deliberately: it is this app's badge.
let squircle = NSBezierPath(roundedRect: square, xRadius: 6 * scale, yRadius: 6 * scale)
background.setFill()
squircle.fill()
accent.setStroke()
squircle.lineWidth = 1 * scale
squircle.stroke()

// The symbol at 12pt on a 22pt badge, tinted with the accent exactly as the border is.
//
// `paletteColors` rather than filling a rect and masking it back: masking leaves the
// symbol's own bounding box faintly tinted wherever it has partial alpha, which at 1024
// showed as a visible square behind the glyph.
let symbolSide = 12 * scale
let configuration = NSImage.SymbolConfiguration(pointSize: symbolSide, weight: .regular)
    .applying(NSImage.SymbolConfiguration(paletteColors: [accent]))
guard
    let tinted = NSImage(systemSymbolName: "wrench.and.screwdriver", accessibilityDescription: nil)?
        .withSymbolConfiguration(configuration)
else {
    FileHandle.standardError.write("wrench.and.screwdriver is not available here\n".data(using: .utf8)!)
    exit(1)
}

// Centred at its own aspect ratio, never squashed into a square.
let natural = tinted.size
let fitted = natural.width > natural.height
    ? NSSize(width: symbolSide, height: symbolSide * natural.height / natural.width)
    : NSSize(width: symbolSide * natural.width / natural.height, height: symbolSide)

tinted.draw(
    in: NSRect(
        x: (canvas - fitted.width) / 2,
        y: (canvas - fitted.height) / 2,
        width: fitted.width,
        height: fitted.height
    ),
    from: .zero,
    operation: .sourceOver,
    fraction: 1
)

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("could not encode the icon\n".data(using: .utf8)!)
    exit(1)
}
try png.write(to: URL(fileURLWithPath: outputPath))
print("wrote \(outputPath) at \(Int(canvas))x\(Int(canvas))")
