import CoreGraphics

public enum Spot: String, CaseIterable, Sendable {
  case notch
  case rightEdge

  public var anchor: Anchor {
    switch self {
    case .notch: Anchor(edge: .top, along: 0.5)
    case .rightEdge: Anchor(edge: .right, along: 0.5)
    }
  }
}

public enum Edge: String, CaseIterable, Sendable {
  case top, bottom, left, right
}

/// A place on an edge: 0 is its left or bottom end, 1 its right or top end.
/// A fraction, so the circle keeps its place when a screen changes size.
public struct Anchor: Equatable, Sendable {
  public var edge: Edge
  public var along: Double

  public init(edge: Edge, along: Double) {
    self.edge = edge
    self.along = along
  }
}

/// Where the circle sits. No screen means a menu spot on the notch or primary screen.
public struct Place: Equatable, Sendable {
  public var screen: Int?
  public var anchor: Anchor

  public init(screen: Int?, anchor: Anchor) {
    self.screen = screen
    self.anchor = anchor
  }

  /// The menu spot to check, if the circle is exactly there.
  public var spot: Spot? {
    screen == nil ? Spot.allCases.first { $0.anchor == anchor } : nil
  }
}

public struct Screen: Equatable, Sendable {
  public var id: Int
  public var frame: CGRect
  public var visibleFrame: CGRect
  public var hasNotch: Bool

  public init(id: Int, frame: CGRect, visibleFrame: CGRect, hasNotch: Bool) {
    self.id = id
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

/// The screen a dropped circle belongs to: the one it is on, or else the nearest.
public func screen(containing point: CGPoint, in screens: [Screen]) -> Screen? {
  func distance(_ frame: CGRect) -> CGFloat {
    hypot(max(frame.minX - point.x, 0, point.x - frame.maxX), max(frame.minY - point.y, 0, point.y - frame.maxY))
  }
  return screens.first { $0.frame.contains(point) } ?? screens.min { distance($0.frame) < distance($1.frame) }
}

public func resolve(_ place: Place, in screens: [Screen]) -> (screen: Screen, anchor: Anchor)? {
  if let id = place.screen, let screen = screens.first(where: { $0.id == id }) { return (screen, place.anchor) }
  guard let fallback = screenForCircle(screens) else { return nil }
  // A dragged place on a screen that is gone goes back to the notch spot.
  return (fallback, place.screen == nil ? place.anchor : Spot.notch.anchor)
}

public func readPlace(edge: String?, along: Double?, screen: Int?, spot: String?) -> Place {
  if let edge = edge.flatMap(Edge.init(rawValue:)), let along {
    return Place(screen: screen, anchor: Anchor(edge: edge, along: along))
  }
  // An older widget saved only one of the two menu spots.
  return Place(screen: nil, anchor: (spot.flatMap(Spot.init(rawValue:)) ?? .notch).anchor)
}

public func circleFrame(at anchor: Anchor, on screen: Screen) -> CGRect {
  let visible = screen.visibleFrame
  // The menu bar spans the whole screen, so the top and bottom measure along the full width.
  let x = screen.frame.minX + anchor.along * screen.frame.width - circleSize / 2
  let y = visible.minY + anchor.along * visible.height - circleSize / 2
  let origin = switch anchor.edge {
  case .top: CGPoint(x: x, y: visible.maxY - circleSize - margin)
  case .bottom: CGPoint(x: x, y: visible.minY + margin)
  case .left: CGPoint(x: visible.minX + margin, y: y)
  case .right: CGPoint(x: visible.maxX - circleSize - margin, y: y)
  }
  return CGRect(
    x: min(max(origin.x, visible.minX + margin), visible.maxX - margin - circleSize),
    y: min(max(origin.y, visible.minY + margin), visible.maxY - margin - circleSize),
    width: circleSize,
    height: circleSize
  )
}

/// The nearest edge of the screen's visible frame, at the place along it where the circle fell.
public func snap(_ center: CGPoint, on screen: Screen) -> Anchor {
  let visible = screen.visibleFrame
  let distances: [(Edge, CGFloat)] = [
    (.top, visible.maxY - center.y),
    (.bottom, center.y - visible.minY),
    (.left, center.x - visible.minX),
    (.right, visible.maxX - center.x),
  ]
  let edge = distances.min { $0.1 < $1.1 }!.0
  let along = switch edge {
  case .top, .bottom: (center.x - screen.frame.minX) / screen.frame.width
  case .left, .right: (center.y - visible.minY) / visible.height
  }
  return Anchor(edge: edge, along: min(max(along, 0), 1))
}

/// Opens away from the circle's edge, and always inside the visible frame.
public func listFrame(at anchor: Anchor, circle: CGRect, size: CGSize, on screen: Screen) -> CGRect {
  let visible = screen.visibleFrame
  let width = min(size.width, visible.width - 2 * margin)
  let height = min(size.height, visible.height - 2 * margin)
  let origin = switch anchor.edge {
  case .top: CGPoint(x: circle.midX - width / 2, y: circle.minY - margin - height)
  case .bottom: CGPoint(x: circle.midX - width / 2, y: circle.maxY + margin)
  case .left: CGPoint(x: circle.maxX + margin, y: circle.midY - height / 2)
  case .right: CGPoint(x: circle.minX - margin - width, y: circle.midY - height / 2)
  }
  return CGRect(
    x: min(max(origin.x, visible.minX + margin), visible.maxX - margin - width),
    y: min(max(origin.y, visible.minY + margin), visible.maxY - margin - height),
    width: width,
    height: height
  )
}
