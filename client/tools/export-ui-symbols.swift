// Exports every SF Symbol the two ported screens use, as alpha-only PNGs.
//
// The screens reference 15 SF Symbols and a webview has no access to any of them, so a
// port has three options: substitute a third-party icon set and accept that nothing
// matches, hand-draw them, or export the real ones. This does the third.
//
// Exported as black-on-transparent, which makes each file an alpha mask. The frontend
// then uses it with `mask-image` and `background: currentColor`, so the icons stay
// tintable from CSS exactly like SF Symbols are tintable from SwiftUI. A plain white
// PNG in an <img> would not be.
//
//   swift tools/export-ui-symbols.swift
//
// Two trades this locks in, both recorded in findings.md:
//   1. The glyphs stop following the system, so a macOS release that restyles any of
//      them needs this re-run.
//   2. SF Symbols are licensed by Apple for use on Apple platforms. That is fine for a
//      Mac-only client and is a real blocker for a Linux or Windows one, which would
//      need a different icon set and therefore a different look.

import AppKit

// Every symbol used by Sidebar, AppHeader, TodayScreen, TaskRow, PRsScreen and
// PrDetailScreen.
let symbolNames = [
    "sun.horizon",
    "exclamationmark.triangle",
    "square.grid.2x2",
    "arrow.triangle.pull",
    "list.bullet.rectangle",
    "wrench.and.screwdriver",
    "magnifyingglass",
    "gearshape",
    "arrow.clockwise",
    "sparkles",
    "plus",
    "trash",
    "checkmark",
    "pin",
    "pin.fill",
    "checklist",
    "bubble.left.fill",
    // PrDetailScreen and PrFileSectionView.
    "chevron.down",
    "chevron.right",
    "arrow.left",
    "doc.text",
    "bubble.left",
]

let outputDirectory = "public/icons"
// 20pt at 3x covers every call site: the largest is 16pt, and one asset per symbol
// keeps the mask CSS to a single rule.
let pointSize: CGFloat = 20
let scale: CGFloat = 3

try? FileManager.default.createDirectory(
    atPath: outputDirectory,
    withIntermediateDirectories: true
)

var failed: [String] = []

for name in symbolNames {
    guard let symbol = NSImage(systemSymbolName: name, accessibilityDescription: name) else {
        failed.append(name)
        continue
    }

    // A symbol's natural aspect ratio is not square, and squashing it into a square box
    // would distort the glyph. The box is square and the glyph is centred inside it at
    // its own aspect ratio, which is what SwiftUI's `Image(systemName:)` does.
    let natural = symbol.size
    let fitted = natural.width > natural.height
        ? NSSize(width: pointSize, height: pointSize * natural.height / natural.width)
        : NSSize(width: pointSize * natural.width / natural.height, height: pointSize)

    let pixels = Int(pointSize * scale)
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
    bitmap.size = NSSize(width: pointSize, height: pointSize)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    symbol.draw(
        in: NSRect(
            x: (pointSize - fitted.width) / 2,
            y: (pointSize - fitted.height) / 2,
            width: fitted.width,
            height: fitted.height
        ),
        from: .zero,
        operation: .sourceOver,
        fraction: 1
    )
    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        failed.append(name)
        continue
    }

    // Dots become dashes so the filenames need no escaping in CSS urls.
    let fileName = name.replacingOccurrences(of: ".", with: "-") + ".png"
    try! png.write(to: URL(fileURLWithPath: "\(outputDirectory)/\(fileName)"))
    print("wrote \(outputDirectory)/\(fileName) at \(pixels)x\(pixels)")
}

if !failed.isEmpty {
    FileHandle.standardError.write(
        "could not export: \(failed.joined(separator: ", "))\n".data(using: .utf8)!
    )
    exit(1)
}
print("exported \(symbolNames.count) symbols")
