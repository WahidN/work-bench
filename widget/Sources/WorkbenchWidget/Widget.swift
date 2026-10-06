import AppKit
import Observation
import SwiftUI
import WidgetCore
import WidgetUI

@Observable final class WidgetState {
  var list: ListState = .loading
  var place: Place

  init(place: Place) {
    self.place = place
  }

  var count: Int? {
    if case .loaded(let prs) = list { prs.count } else { nil }
  }
}

/// Takes the first click, although the panel never becomes the active window.
final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

struct CircleButton: View {
  let state: WidgetState
  let toggle: () -> Void
  let move: @MainActor (Spot?) -> Void
  let drag: () -> Void
  let drop: () -> Void
  let refresh: () -> Void
  let quit: () -> Void

  var body: some View {
    CircleView(count: state.count)
      .contentShape(Circle())
      .onTapGesture(perform: toggle)
      // Past 3 points it is a drag, so a click stays a click.
      .gesture(DragGesture(minimumDistance: 3).onChanged { _ in drag() }.onEnded { _ in drop() })
      .contextMenu {
        Picker("Spot", selection: Binding(get: { state.place.spot }, set: move)) {
          Text("At the notch").tag(Spot?.some(.notch))
          Text("On the right edge").tag(Spot?.some(.rightEdge))
        }
        .pickerStyle(.inline)
        Divider()
        Button("Refresh", action: refresh)
        Button("Quit Workbench Widget", action: quit)
      }
  }
}

struct ListContent: View {
  let state: WidgetState
  let open: (PullRequest) -> Void

  var body: some View {
    ListView(state: state.list, onOpen: open)
  }
}

final class Widget: NSObject {
  private let state: WidgetState
  private let workbench: Workbench
  private let circle = Widget.panel(size: CGSize(width: circleSize, height: circleSize))
  private let list = Widget.panel(size: listSize)
  private var dragStart: (mouse: CGPoint, origin: CGPoint)?

  init(defaults: UserDefaults = .standard) {
    let folder = defaults.string(forKey: "workbenchFolder") ?? NSString(string: "~/Documents/Projecten/workbench").expandingTildeInPath
    workbench = Workbench(folder: URL(fileURLWithPath: folder))
    state = WidgetState(place: readPlace(
      edge: defaults.string(forKey: "edge"),
      along: defaults.object(forKey: "along") as? Double,
      screen: defaults.object(forKey: "screen") as? Int,
      spot: defaults.string(forKey: "spot")
    ))
    super.init()

    // The panels hold these closures and the widget holds the panels, for as long as the app runs.
    circle.contentView = FirstClickHostingView(rootView: CircleButton(
      state: state,
      toggle: { [unowned self] in toggleList() },
      move: { [unowned self] in if let spot = $0 { move(to: Place(screen: nil, anchor: spot.anchor)) } },
      drag: { [unowned self] in drag() },
      drop: { [unowned self] in drop() },
      refresh: { [unowned self] in refresh() },
      quit: { NSApp.terminate(nil) }
    ))
    list.contentView = FirstClickHostingView(rootView: ListContent(state: state, open: { [unowned self] in open($0) }))

    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    place()
    circle.orderFrontRegardless()
    refresh()
  }

  private static func panel(size: CGSize) -> NSPanel {
    let panel = NSPanel(
      contentRect: CGRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    return panel
  }

  @objc private func screensChanged() {
    place()
  }

  private var screens: [Screen] {
    NSScreen.screens.map {
      Screen(
        id: ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0,
        frame: $0.frame,
        visibleFrame: $0.visibleFrame,
        hasNotch: $0.safeAreaInsets.top > 0
      )
    }
  }

  private func place() {
    guard let (screen, anchor) = resolve(state.place, in: screens) else { return }
    let frame = circleFrame(at: anchor, on: screen)
    circle.setFrame(frame, display: true)
    list.setFrame(listFrame(at: anchor, circle: frame, size: listSize, on: screen), display: true)
  }

  /// Follows the pointer in screen points. The gesture's own offset is measured in the window, which moves.
  private func drag() {
    let mouse = NSEvent.mouseLocation
    guard let start = dragStart else {
      dragStart = (mouse, circle.frame.origin)
      list.orderOut(nil)
      return
    }
    circle.setFrameOrigin(CGPoint(x: start.origin.x + mouse.x - start.mouse.x, y: start.origin.y + mouse.y - start.mouse.y))
  }

  private func drop() {
    dragStart = nil
    let center = CGPoint(x: circle.frame.midX, y: circle.frame.midY)
    guard let screen = screen(containing: center, in: screens) else { return }
    move(to: Place(screen: screen.id, anchor: snap(center, on: screen)))
  }

  private func toggleList() {
    if list.isVisible {
      list.orderOut(nil)
      return
    }
    place()
    list.orderFrontRegardless()
    refresh()
  }

  private func move(to place: Place) {
    state.place = place
    let defaults = UserDefaults.standard
    defaults.set(place.anchor.edge.rawValue, forKey: "edge")
    defaults.set(place.anchor.along, forKey: "along")
    defaults.set(place.screen, forKey: "screen")
    defaults.removeObject(forKey: "spot")
    self.place()
  }

  private func refresh() {
    // Keep the last list on screen while it loads again.
    if case .loaded = state.list {} else { state.list = .loading }
    Task {
      do {
        state.list = .loaded(try await workbench.pullRequests())
      } catch {
        state.list = .failed(error.localizedDescription)
      }
    }
  }

  private func open(_ pr: PullRequest) {
    do {
      try workbench.open(pr.url)
      list.orderOut(nil)
    } catch {
      state.list = .failed(error.localizedDescription)
    }
  }
}
