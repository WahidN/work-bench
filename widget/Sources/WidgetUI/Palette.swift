import SwiftUI

/// The colours of the Workbench window, so the widget looks like part of it.
enum Palette {
  static let canvas = Color(red: 0x1A / 255, green: 0x1A / 255, blue: 0x1A / 255)
  static let border = Color(red: 0x29 / 255, green: 0x29 / 255, blue: 0x29 / 255)
  static let hover = Color.white.opacity(0.05)
  static let text = Color(red: 0xE2 / 255, green: 0xE2 / 255, blue: 0xE2 / 255)
  static let secondary = Color(red: 0xA3 / 255, green: 0xA3 / 255, blue: 0xA3 / 255)
  static let ghost = Color(red: 0x6B / 255, green: 0x6B / 255, blue: 0x6B / 255)
  static let accent = Color(red: 0xE2 / 255, green: 0x79 / 255, blue: 0x5B / 255)
  static let error = Color(red: 0xF0 / 255, green: 0x71 / 255, blue: 0x71 / 255)
}
