import CoreGraphics

public enum Spot: String, CaseIterable, Sendable {
  case notch
  case rightEdge
}

public struct Screen: Equatable, Sendable {
  public var frame: CGRect
  public var visibleFrame: CGRect
  public var hasNotch: Bool

  public init(frame: CGRect, visibleFrame: CGRect, hasNotch: Bool) {
    self.frame = frame
    self.visibleFrame = visibleFrame
    self.hasNotch = hasNotch
  }
}

public let circleSize: CGFloat = 40
let margin: CGFloat = 6

/// The screen with a notch, else the primary screen. Not the focused one, so the circle never jumps between monitors.
public func screenForCircle(_ screens: [Screen]) -> Screen? {
  screens.first(where: \.hasNotch) ?? screens.first
}

public func circleFrame(for spot: Spot, on screen: Screen) -> CGRect {
  let visible = screen.visibleFrame
  let origin = switch spot {
  case .notch: CGPoint(x: screen.frame.midX - circleSize / 2, y: visible.maxY - circleSize - margin)
  case .rightEdge: CGPoint(x: visible.maxX - circleSize - margin, y: visible.midY - circleSize / 2)
  }
  return CGRect(origin: origin, size: CGSize(width: circleSize, height: circleSize))
}

/// Under the circle at the notch, left of it on the right edge, and always inside the visible frame.
public func listFrame(for spot: Spot, circle: CGRect, size: CGSize, on screen: Screen) -> CGRect {
  let visible = screen.visibleFrame
  let width = min(size.width, visible.width - 2 * margin)
  let height = min(size.height, visible.height - 2 * margin)
  let origin = switch spot {
  case .notch: CGPoint(x: circle.midX - width / 2, y: circle.minY - margin - height)
  case .rightEdge: CGPoint(x: circle.minX - margin - width, y: circle.midY - height / 2)
  }
  return CGRect(
    x: min(max(origin.x, visible.minX + margin), visible.maxX - margin - width),
    y: min(max(origin.y, visible.minY + margin), visible.maxY - margin - height),
    width: width,
    height: height
  )
}
