import SwiftUI

/// A namespace only. Every token now lives in the extensions below, on the Nocturne
/// ramps. The flat pre-redesign colours that used to sit here were removed once the
/// last screen stopped using them, which was the point of roadmap phase 8.
enum Theme {}

private extension Color {
    init(hex: String) {
        var value: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&value)
        self.init(
            red: Double((value & 0xFF0000) >> 16) / 255,
            green: Double((value & 0x00FF00) >> 8) / 255,
            blue: Double(value & 0x0000FF) / 255
        )
    }
}

extension Theme {
    enum Neutral {
        static let n100 = Color(hex: "F3F5FE")
        static let n200 = Color(hex: "E4E7F5")
        static let n300 = Color(hex: "CFD3E5")
        static let n400 = Color(hex: "B2B6CA")
        static let n500 = Color(hex: "9397AB")
        static let n600 = Color(hex: "75798C")
        static let n700 = Color(hex: "595D6C")
        static let n800 = Color(hex: "3F424D")
        static let n900 = Color(hex: "292B31")
    }

    enum Accent {
        static let a100 = Color(hex: "F5F4FF")
        static let a200 = Color(hex: "E7E5FE")
        static let a300 = Color(hex: "D2CEFD")
        static let a400 = Color(hex: "B5ABFC")
        static let a500 = Color(hex: "968AE0")
        static let a600 = Color(hex: "796CBF")
        static let a700 = Color(hex: "5D5294")
        static let a800 = Color(hex: "423A6A")
        static let a900 = Color(hex: "2B2741")
    }

    /// Status hues from the handoff. `changesRequested`, `approved` and `blocked` are
    /// genuinely ad-hoc, low-chroma hues outside the neutral and accent ramps, which is
    /// why those three are literal values here. `needsReview` and `draft` alias the
    /// accent and neutral ramps instead.
    enum Status {
        static let needsReview = Accent.a400
        static let changesRequested = Color(hex: "C49AB0")
        static let approved = Color(hex: "8FBF9F")
        static let blocked = Color(hex: "C4B18A")
        static let draft = Neutral.n500
    }

    /// Added lines and a completed action. The handoff's low-chroma green, the same
    /// value Status.approved uses.
    static let positive = Color(hex: "8FBF9F")
    /// Removed lines and validation errors. The handoff's low-chroma red. Kept
    /// top-level rather than inside Status, because a form error is not a status.
    static let negative = Color(hex: "C49A9A")

    static let sidebarGradientTop = Color(hex: "1A1C2B")
    // The slide-over panel shares the sidebar's raised tone (#1a1c2b).
    static let panelBackground = sidebarGradientTop

    static let nocturneBg = Color(hex: "161826")
    static let nocturneSurface = Color(hex: "232532")
    static let nocturneText = Color(hex: "E9E9ED")
    static let nocturneAccent = Color(hex: "9184D9")
    static let nocturneDivider = Color(hex: "E9E9ED").opacity(0.16)

    // The palette's own surface and backdrop, from handoff section 8. It sits on a
    // tone of its own, between the sidebar's #1a1c2b and the surface #232532.
    static let paletteSurface = Color(hex: "1C1E2C")
    static let paletteBackdrop = Color(hex: "0A0B12").opacity(0.6)

    static let projectDotColors: [Color] = [
        nocturneAccent,
        Color(hex: "7EA8C4"),
        Color(hex: "C49AB0"),
        Color(hex: "8FBF9F"),
        Color(hex: "C4B18A"),
        Color(hex: "A79AD9"),
        Color(hex: "8AA6C4"),
        Color(hex: "C49A9A")
    ]

    enum Space {
        static let s1: CGFloat = 2.8
        static let s2: CGFloat = 5.6
        static let s3: CGFloat = 8.4
        static let s4: CGFloat = 11.2
        static let s6: CGFloat = 16.8
        static let s8: CGFloat = 22.4
    }

    enum Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 8
        static let lg: CGFloat = 14
    }

    enum FontSize {
        static let screenTitle: CGFloat = 22
        static let cardTitle: CGFloat = 15
        static let body: CGFloat = 14
        static let secondary: CGFloat = 13
        static let tableMeta: CGFloat = 12
        static let label: CGFloat = 11
        static let tag: CGFloat = 10
    }

    static func heading(_ size: CGFloat) -> Font {
        .custom("Inter-Medium", size: size)
    }

    static func body(_ size: CGFloat) -> Font {
        .custom("Inter-Regular", size: size)
    }
}
