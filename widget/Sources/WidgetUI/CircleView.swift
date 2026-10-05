import SwiftUI
import WidgetCore

public struct CircleView: View {
  var count: Int?

  public init(count: Int?) {
    self.count = count
  }

  public var body: some View {
    ZStack(alignment: .topTrailing) {
      Circle()
        .fill(Palette.accent)
        .overlay {
          Image(systemName: "arrow.triangle.pull")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
        }
      if let count {
        Text("\(count)")
          .font(.system(size: 9, weight: .bold))
          .monospacedDigit()
          .foregroundStyle(.white)
          .padding(.horizontal, 3)
          .frame(minWidth: 15, minHeight: 15)
          .background(Capsule().fill(Palette.canvas))
          .overlay(Capsule().stroke(Palette.accent, lineWidth: 1))
      }
    }
    .frame(width: circleSize, height: circleSize)
  }
}
