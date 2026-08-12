import AppKit

enum MenuBarIconRenderer {
    static func image(badgeCount: Int) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size)
        image.lockFocus()

        if let symbol = NSImage(systemSymbolName: "checkmark.circle", accessibilityDescription: "Workbench") {
            symbol.draw(in: NSRect(origin: .zero, size: size))
        }

        if badgeCount > 0 {
            let diameter: CGFloat = 10
            let badgeRect = NSRect(x: size.width - diameter, y: size.height - diameter, width: diameter, height: diameter)
            NSColor.systemRed.setFill()
            NSBezierPath(ovalIn: badgeRect).fill()

            let text = badgeCount > 9 ? "9+" : "\(badgeCount)"
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 7, weight: .bold),
                .foregroundColor: NSColor.white,
            ]
            let textSize = text.size(withAttributes: attributes)
            let origin = NSPoint(x: badgeRect.midX - textSize.width / 2, y: badgeRect.midY - textSize.height / 2)
            text.draw(at: origin, withAttributes: attributes)
        }

        image.unlockFocus()
        // A template image is auto-tinted monochrome by the system, which would erase the red badge.
        // Only the badge-free idle icon can safely be a template (so it adapts to light/dark menu bars).
        image.isTemplate = badgeCount == 0
        return image
    }
}
