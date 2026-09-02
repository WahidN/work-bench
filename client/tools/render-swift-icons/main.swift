// Renders the Swift app's real menu bar icon to PNG, so probe 3 can pixel-diff the
// canvas port against it.
//
// This compiles and calls the production `MenuBarIconRenderer` rather than
// transcribing it, which matters: a transcription compared against a transcription
// would prove nothing. Build it with the renderer as a second input file:
//
//   swiftc -O tools/render-swift-icons/main.swift \
//     ../app/Workbench/MenuBarIconRenderer.swift -o /tmp/render-swift-icons
//
// It writes tray-swift-<count>.png into the directory given as argv[1].

import AppKit

let counts = [0, 1, 9, 12]
let outputDirectory = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

for count in counts {
    let image = MenuBarIconRenderer.image(badgeCount: count)

    // Round-tripped through TIFF because an NSImage built with lockFocus caches a
    // snapshot rep that is not an NSBitmapImageRep, so `representations.first` cannot
    // be cast and cannot be asked for its pixel dimensions.
    //
    // lockFocus picks up the main screen's backing scale, so the rep can come back at
    // 2x even though the NSImage says 18x18. Reading the real pixel dimensions rather
    // than assuming them is the point of printing them.
    guard
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff)
    else {
        FileHandle.standardError.write("no bitmap rep for count \(count)\n".data(using: .utf8)!)
        exit(1)
    }

    guard let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("could not encode count \(count)\n".data(using: .utf8)!)
        exit(1)
    }

    let path = "\(outputDirectory)/tray-swift-\(count).png"
    try! png.write(to: URL(fileURLWithPath: path))
    print("swift count=\(count) pixels=\(rep.pixelsWide)x\(rep.pixelsHigh) isTemplate=\(image.isTemplate) -> \(path)")
}
