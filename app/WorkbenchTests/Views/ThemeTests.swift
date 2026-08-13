import Testing
import SwiftUI
import AppKit
@testable import Workbench

private func rgb(_ color: Color) -> (r: Double, g: Double, b: Double) {
    let ns = NSColor(color).usingColorSpace(.deviceRGB)!
    return (ns.redComponent, ns.greenComponent, ns.blueComponent)
}

private func expectHex(_ color: Color, _ hex: String) {
    var value: UInt64 = 0
    Scanner(string: hex).scanHexInt64(&value)
    let expected = (
        r: Double((value & 0xFF0000) >> 16) / 255,
        g: Double((value & 0x00FF00) >> 8) / 255,
        b: Double(value & 0x0000FF) / 255
    )
    let actual = rgb(color)
    #expect(abs(actual.r - expected.r) < 0.005)
    #expect(abs(actual.g - expected.g) < 0.005)
    #expect(abs(actual.b - expected.b) < 0.005)
}

@Test func neutralRampMatchesDesignTokens() {
    expectHex(Theme.Neutral.n100, "F3F5FE")
    expectHex(Theme.Neutral.n400, "B2B6CA")
    expectHex(Theme.Neutral.n500, "9397AB")
    expectHex(Theme.Neutral.n900, "292B31")
}

@Test func accentRampMatchesDesignTokens() {
    expectHex(Theme.Accent.a100, "F5F4FF")
    expectHex(Theme.Accent.a400, "B5ABFC")
    expectHex(Theme.Accent.a500, "968AE0")
    expectHex(Theme.Accent.a900, "2B2741")
}

@Test func baseNocturneTokensMatchDesignTokens() {
    expectHex(Theme.nocturneBg, "161826")
    expectHex(Theme.nocturneSurface, "232532")
    expectHex(Theme.nocturneText, "E9E9ED")
    expectHex(Theme.nocturneAccent, "9184D9")
}

@Test func projectDotColorsHasEightEntriesStartingWithAccent() {
    #expect(Theme.projectDotColors.count == 8)
    expectHex(Theme.projectDotColors[0], "9184D9")
    expectHex(Theme.projectDotColors[1], "7EA8C4")
    expectHex(Theme.projectDotColors[7], "C49A9A")
}

@Test func spacingScaleMatchesDesignTokens() {
    #expect(Theme.Space.s1 == 2.8)
    #expect(Theme.Space.s2 == 5.6)
    #expect(Theme.Space.s3 == 8.4)
    #expect(Theme.Space.s4 == 11.2)
    #expect(Theme.Space.s6 == 16.8)
    #expect(Theme.Space.s8 == 22.4)
}

@Test func radiusScaleMatchesDesignTokens() {
    #expect(Theme.Radius.sm == 4)
    #expect(Theme.Radius.md == 8)
    #expect(Theme.Radius.lg == 14)
}
