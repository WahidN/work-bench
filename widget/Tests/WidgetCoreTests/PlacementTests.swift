import CoreGraphics
import Testing

@testable import WidgetCore

let dell = Screen(
  id: 1,
  frame: CGRect(x: 0, y: 0, width: 1080, height: 1920),
  visibleFrame: CGRect(x: 0, y: 0, width: 1080, height: 1890),
  hasNotch: false
)
let lg = Screen(
  id: 2,
  frame: CGRect(x: -2560, y: 275, width: 2560, height: 1080),
  visibleFrame: CGRect(x: -2560, y: 275, width: 2560, height: 1080),
  hasNotch: false
)
let laptop = Screen(
  id: 3,
  frame: CGRect(x: 1080, y: 0, width: 1512, height: 982),
  visibleFrame: CGRect(x: 1080, y: 0, width: 1512, height: 944),
  hasNotch: true
)

@Test func `the notch spot is centred just under the menu bar`() {
  #expect(circleFrame(at: Spot.notch.anchor, on: dell) == CGRect(x: 520, y: 1844, width: 40, height: 40))
}

@Test func `the right spot is on the right edge, centred top to bottom`() {
  #expect(circleFrame(at: Spot.rightEdge.anchor, on: dell) == CGRect(x: 1034, y: 925, width: 40, height: 40))
}

@Test func `the circle goes on the screen with the notch`() {
  #expect(screenForCircle([dell, laptop]) == laptop)
}

@Test func `without a notch the circle goes on the primary screen`() {
  #expect(screenForCircle([dell]) == dell)
  #expect(screenForCircle([]) == nil)
}

@Test func `the list opens under the circle at the notch, and left of it on the right edge`() {
  let size = CGSize(width: 360, height: 440)
  let underNotch = listFrame(at: Spot.notch.anchor, circle: circleFrame(at: Spot.notch.anchor, on: dell), size: size, on: dell)
  #expect(underNotch == CGRect(x: 360, y: 1398, width: 360, height: 440))

  let leftOfEdge = listFrame(at: Spot.rightEdge.anchor, circle: circleFrame(at: Spot.rightEdge.anchor, on: dell), size: size, on: dell)
  #expect(leftOfEdge == CGRect(x: 668, y: 725, width: 360, height: 440))
}

@Test func `the list stays inside the screen`() {
  let small = Screen(id: 4, frame: CGRect(x: 0, y: 0, width: 500, height: 400), visibleFrame: CGRect(x: 0, y: 0, width: 500, height: 380), hasNotch: false)
  let frame = listFrame(at: Spot.rightEdge.anchor, circle: circleFrame(at: Spot.rightEdge.anchor, on: small), size: CGSize(width: 360, height: 440), on: small)
  #expect(small.visibleFrame.contains(CGPoint(x: frame.minX, y: frame.minY)))
  #expect(frame.maxY <= small.visibleFrame.maxY)
}

@Test func `a place along the top edge keeps its spot, and stays inside the screen`() {
  #expect(circleFrame(at: Anchor(edge: .top, along: 0.25), on: dell) == CGRect(x: 250, y: 1844, width: 40, height: 40))
  #expect(circleFrame(at: Anchor(edge: .top, along: 0), on: dell).minX == 6)
}

@Test func `the bottom and left edges`() {
  #expect(circleFrame(at: Anchor(edge: .bottom, along: 0.5), on: dell) == CGRect(x: 520, y: 6, width: 40, height: 40))
  #expect(circleFrame(at: Anchor(edge: .left, along: 0.5), on: dell) == CGRect(x: 6, y: 925, width: 40, height: 40))
}

let drops: [(center: CGPoint, edge: Edge, along: Double)] = [
  (CGPoint(x: 540, y: 1880), .top, 540.0 / 1080),
  (CGPoint(x: 500, y: 30), .bottom, 500.0 / 1080),
  (CGPoint(x: 20, y: 900), .left, 900.0 / 1890),
  (CGPoint(x: 1070, y: 400), .right, 400.0 / 1890),
]

@Test(arguments: drops)
func `a drop snaps to the nearest edge, at the place where it fell`(center: CGPoint, edge: Edge, along: Double) {
  let anchor = snap(center, on: dell)
  #expect(anchor.edge == edge)
  #expect(abs(anchor.along - along) < 0.0001)
}

@Test func `the list opens away from the edge`() {
  let size = CGSize(width: 360, height: 440)
  let bottom = circleFrame(at: Anchor(edge: .bottom, along: 0.5), on: dell)
  #expect(listFrame(at: Anchor(edge: .bottom, along: 0.5), circle: bottom, size: size, on: dell).minY == bottom.maxY + 6)
  let left = circleFrame(at: Anchor(edge: .left, along: 0.5), on: dell)
  #expect(listFrame(at: Anchor(edge: .left, along: 0.5), circle: left, size: size, on: dell).minX == left.maxX + 6)
}

@Test func `a drop belongs to the screen it is on, or else the nearest one`() {
  #expect(screen(containing: CGPoint(x: -1000, y: 800), in: [dell, lg]) == lg)
  #expect(screen(containing: CGPoint(x: -3000, y: 500), in: [dell, lg]) == lg)
  #expect(screen(containing: CGPoint(x: 500, y: 500), in: [dell, lg]) == dell)
}

@Test func `a remembered place comes back on its screen, and falls back to the notch without it`() {
  let dropped = Place(screen: 2, anchor: Anchor(edge: .bottom, along: 0.3))
  #expect(resolve(dropped, in: [dell, lg])! == (lg, dropped.anchor))
  #expect(resolve(dropped, in: [dell])! == (dell, Spot.notch.anchor))
  #expect(resolve(Place(screen: nil, anchor: Spot.rightEdge.anchor), in: [dell, laptop])! == (laptop, Spot.rightEdge.anchor))
}

@Test func `reads the saved place, and the spot an older widget saved`() {
  #expect(readPlace(edge: "bottom", along: 0.3, screen: 2, spot: nil) == Place(screen: 2, anchor: Anchor(edge: .bottom, along: 0.3)))
  #expect(readPlace(edge: nil, along: nil, screen: nil, spot: "rightEdge") == Place(screen: nil, anchor: Spot.rightEdge.anchor))
  #expect(readPlace(edge: nil, along: nil, screen: nil, spot: nil) == Place(screen: nil, anchor: Spot.notch.anchor))
}

@Test func `a menu spot is checked only when the circle is there`() {
  #expect(Place(screen: nil, anchor: Spot.notch.anchor).spot == .notch)
  #expect(Place(screen: 1, anchor: Spot.notch.anchor).spot == nil)
  #expect(Place(screen: nil, anchor: Anchor(edge: .top, along: 0.2)).spot == nil)
}
