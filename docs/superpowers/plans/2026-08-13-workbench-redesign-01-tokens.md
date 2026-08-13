# Workbench Redesign Phase 1: Design Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Nocturne design system's full color ramps, spacing scale, radius scale, and heading/body font helpers to `Theme.swift`, so every later phase has real tokens to build against.

**Architecture:** Additive only — the existing flat `Theme` tokens (`Theme.background`, `Theme.accent`, etc.) stay untouched and in use by not-yet-migrated screens. New tokens are namespaced under `Theme.Neutral`, `Theme.Accent`, `Theme.Space`, `Theme.Radius`, `Theme.FontSize`, plus top-level `Theme.nocturneBg`/`nocturneSurface`/`nocturneText`/`nocturneAccent`/`nocturneDivider`/`projectDotColors` and `Theme.heading(_:)`/`Theme.body(_:)` font helpers.

**Tech Stack:** SwiftUI, Swift Testing (`@Test`), AppKit (`NSColor`, for test-only RGB extraction).

## Global Constraints

- Do not remove or modify any existing `Theme` member — this phase is purely additive (see roadmap's "Global constraints").
- Exact source values (from `_ds/nocturne-.../styles.css` and the README's Design Tokens section — already verified, use these, don't re-derive):
  - Base: `--color-bg #161826`, `--color-surface #232532`, `--color-text #e9e9ed`, `--color-accent #9184d9`, divider = `--color-text` at 16% opacity.
  - Neutral ramp 100→900: `#f3f5fe #e4e7f5 #cfd3e5 #b2b6ca #9397ab #75798c #595d6c #3f424d #292b31`.
  - Accent ramp 100→900: `#f5f4ff #e7e5fe #d2cefd #b5abfc #968ae0 #796cbf #5d5294 #423a6a #2b2741`.
  - Project dot colors (8, in order, first is the accent itself): `#9184d9 #7ea8c4 #c49ab0 #8fbf9f #c4b18a #a79ad9 #8aa6c4 #c49a9a`.
  - Spacing: `space-1 2.8px, space-2 5.6px, space-3 8.4px, space-4 11.2px, space-6 16.8px, space-8 22.4px` (space-5/7 don't exist in the scale — don't invent them).
  - Radius: `sm 4px, md 8px, lg 14px`.
  - Font sizes in use: `22, 15, 14, 13, 12, 11, 10` (screen title, brand/card title, task title/inputs, secondary rows/chat, table meta, labels/kickers/counts, tags/avatar).
  - Type family: Inter for both heading and body; heading weight 500, body weight 400.

## Task 1: Hex color helper + color ramp tokens

**Files:**
- Modify: `app/Workbench/Views/Theme.swift`
- Test: `app/WorkbenchTests/Views/ThemeTests.swift` (new file)

**Interfaces:**
- Produces: `Theme.Neutral.n100...n900: Color`, `Theme.Accent.a100...a900: Color`, `Theme.nocturneBg/nocturneSurface/nocturneText/nocturneAccent/nocturneDivider: Color`, `Theme.projectDotColors: [Color]` (8 entries).

- [ ] **Step 1: Write the failing tests**

Create `app/WorkbenchTests/Views/ThemeTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests/ThemeTests`
Expected: FAIL to build — `Theme.Neutral`, `Theme.Accent`, `Theme.nocturneBg`, `Theme.projectDotColors` don't exist yet.

- [ ] **Step 3: Add the hex initializer and color tokens**

In `app/Workbench/Views/Theme.swift`, add (leave every existing line as-is, append below the existing `enum Theme` body):

```swift
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests/ThemeTests`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/Workbench/Views/Theme.swift app/WorkbenchTests/Views/ThemeTests.swift
git commit -m "feat(theme): add Nocturne neutral/accent color ramps and project dot colors"
```

## Task 2: Spacing and radius scale

**Files:**
- Modify: `app/Workbench/Views/Theme.swift`
- Test: `app/WorkbenchTests/Views/ThemeTests.swift`

**Interfaces:**
- Produces: `Theme.Space.s1/s2/s3/s4/s6/s8: CGFloat`, `Theme.Radius.sm/md/lg: CGFloat`.

- [ ] **Step 1: Write the failing tests**

Append to `ThemeTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests/ThemeTests`
Expected: FAIL to build — `Theme.Space` and `Theme.Radius` don't exist yet.

- [ ] **Step 3: Add the scales**

In `app/Workbench/Views/Theme.swift`, inside the `extension Theme { ... }` block added in Task 1, add:

```swift
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests/ThemeTests`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/Workbench/Views/Theme.swift app/WorkbenchTests/Views/ThemeTests.swift
git commit -m "feat(theme): add Nocturne spacing and radius scale"
```

## Task 3: Font size scale and Inter heading/body helpers

**Files:**
- Modify: `app/Workbench/Views/Theme.swift`
- Manual (you, before Step 3 below): download Inter and add it to the Xcode project.

**Interfaces:**
- Produces: `Theme.FontSize.screenTitle/cardTitle/body/secondary/tableMeta/label/tag: CGFloat`, `Theme.heading(_ size: CGFloat) -> Font`, `Theme.body(_ size: CGFloat) -> Font`.

**Why a manual step:** the design's type family is Inter, loaded from Google Fonts in the web prototype. There's no font binary in the handoff bundle to copy, and fetching a font binary isn't something available tooling can do safely here — so this step needs you.

- [ ] **Step 1 (manual, you): Download and add Inter to the project**

1. Download Inter from https://rsms.me/inter/ (or https://fonts.google.com/specimen/Inter) — get at minimum `Inter-Regular.ttf` and `Inter-Medium.ttf`.
2. Create `app/Workbench/Resources/Fonts/` and place both files there.
3. In Xcode, add the folder to the `Workbench` target (checkbox "Workbench" under Target Membership).
4. In `app/Workbench/Info.plist`, add:
   ```xml
   <key>ATSApplicationFontsPath</key>
   <string>Resources/Fonts</string>
   ```
   (If `app/project.yml` regenerates `Info.plist` via XcodeGen, add the same key/value under that target's `info` section in `project.yml` instead, then run `xcodegen generate`.)

`Font.custom(_:size:)` falls back to the system font automatically if a named font isn't found, so the app builds and runs correctly even before this manual step is done — but the tests in Step 4 below check the *font-size scale* (plain numbers), not the actual Inter rendering, so they'll pass either way. This manual step is what makes the later phases' UI actually render in Inter once they start using `Theme.heading`/`Theme.body`.

- [ ] **Step 2: Write the failing tests**

Append to `ThemeTests.swift`:

```swift
@Test func fontSizeScaleMatchesDesignTokens() {
    #expect(Theme.FontSize.screenTitle == 22)
    #expect(Theme.FontSize.cardTitle == 15)
    #expect(Theme.FontSize.body == 14)
    #expect(Theme.FontSize.secondary == 13)
    #expect(Theme.FontSize.tableMeta == 12)
    #expect(Theme.FontSize.label == 11)
    #expect(Theme.FontSize.tag == 10)
}

@Test func headingAndBodyReturnDistinctFontsAtGivenSize() {
    #expect(Theme.heading(15) != Theme.body(15))
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests/ThemeTests`
Expected: FAIL to build — `Theme.FontSize`, `Theme.heading`, `Theme.body` don't exist yet.

- [ ] **Step 4: Add the font size scale and font helpers**

In `app/Workbench/Views/Theme.swift`, inside the `extension Theme { ... }` block, add:

```swift
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests/ThemeTests`
Expected: PASS — 9 tests green.

- [ ] **Step 6: Commit**

```bash
git add app/Workbench/Views/Theme.swift app/WorkbenchTests/Views/ThemeTests.swift app/Workbench/Resources/Fonts app/Workbench/Info.plist app/project.yml
git commit -m "feat(theme): add font size scale and Inter heading/body helpers"
```

## Self-Review Notes

- Spec coverage: Color (base + both ramps + project dots + divider) ✓ Task 1. Spacing ✓ Task 2. Radius ✓ Task 2. Type (sizes + Inter heading/body) ✓ Task 3. Shadows from the spec (`--shadow-sm/md/lg`) are intentionally deferred — no phase needs them yet (they attach to specific components: cards, dialogs, the chat panel), so they'll be added as plain `.shadow()` modifiers directly on those views in the phase that builds them, not as abstract tokens here.
- No placeholders: every step has literal code or literal manual instructions with exact URLs/paths.
- Type consistency: `Theme.Neutral`/`Theme.Accent`/`Theme.Space`/`Theme.Radius`/`Theme.FontSize` names are used identically across all three tasks.
