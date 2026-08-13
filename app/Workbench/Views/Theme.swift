import SwiftUI

enum Theme {
    static let background = Color(red: 0.0549, green: 0.0549, blue: 0.0667)
    static let sidebarBackground = Color(red: 0.0784, green: 0.0784, blue: 0.0902)
    static let cardBackground = Color(red: 0.0902, green: 0.0902, blue: 0.1059)
    static let selectedBackground = Color(red: 0.1098, green: 0.1098, blue: 0.1333)
    static let border = Color(red: 0.1373, green: 0.1373, blue: 0.1608)
    static let accent = Color(red: 0.4863, green: 0.4863, blue: 0.9412)
    static let textPrimary = Color(red: 0.9098, green: 0.9098, blue: 0.9255)
    static let textSecondary = Color(red: 0.6510, green: 0.6510, blue: 0.6824)
    static let textMuted = Color(red: 0.3333, green: 0.3333, blue: 0.3686)
    static let success = Color(red: 0.4353, green: 0.8471, blue: 0.5412)
    static let danger = Color(red: 0.9412, green: 0.6275, blue: 0.6275)
}

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

    static let nocturneBg = Color(hex: "161826")
    static let nocturneSurface = Color(hex: "232532")
    static let nocturneText = Color(hex: "E9E9ED")
    static let nocturneAccent = Color(hex: "9184D9")
    static let nocturneDivider = Color(hex: "E9E9ED").opacity(0.16)

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
}
