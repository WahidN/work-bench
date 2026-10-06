import CoreGraphics
import Testing

@testable import WidgetCore

let dell = Screen(
  frame: CGRect(x: 0, y: 0, width: 1080, height: 1920),
  visibleFrame: CGRect(x: 0, y: 0, width: 1080, height: 1890),
  hasNotch: false
)
let laptop = Screen(
  frame: CGRect(x: 1080, y: 0, width: 1512, height: 982),
  visibleFrame: CGRect(x: 1080, y: 0, width: 1512, height: 944),
  hasNotch: true
)

@Test func `the notch spot is centred just under the menu bar`() {
  #expect(circleFrame(for: .notch, on: dell) == CGRect(x: 520, y: 1844, width: 40, height: 40))
}

@Test func `the right spot is on the right edge, centred top to bottom`() {
  #expect(circleFrame(for: .rightEdge, on: dell) == CGRect(x: 1034, y: 925, width: 40, height: 40))
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
  let underNotch = listFrame(for: .notch, circle: circleFrame(for: .notch, on: dell), size: size, on: dell)
  #expect(underNotch == CGRect(x: 360, y: 1398, width: 360, height: 440))

  let leftOfEdge = listFrame(for: .rightEdge, circle: circleFrame(for: .rightEdge, on: dell), size: size, on: dell)
  #expect(leftOfEdge == CGRect(x: 668, y: 725, width: 360, height: 440))
}

@Test func `the list stays inside the screen`() {
  let small = Screen(frame: CGRect(x: 0, y: 0, width: 500, height: 400), visibleFrame: CGRect(x: 0, y: 0, width: 500, height: 380), hasNotch: false)
  let frame = listFrame(for: .rightEdge, circle: circleFrame(for: .rightEdge, on: small), size: CGSize(width: 360, height: 440), on: small)
  #expect(small.visibleFrame.contains(CGPoint(x: frame.minX, y: frame.minY)))
  #expect(frame.maxY <= small.visibleFrame.maxY)
}
