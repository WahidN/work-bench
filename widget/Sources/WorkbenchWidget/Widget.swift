import AppKit
import Observation
import SwiftUI
import WidgetCore
import WidgetUI

@Observable final class WidgetState {
  var list: ListState = .loading
  var spot: Spot

  init(spot: Spot) {
    self.spot = spot
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
  let move: @MainActor (Spot) -> Void
  let refresh: () -> Void
  let quit: () -> Void

  var body: some View {
    CircleView(count: state.count)
      .contentShape(Circle())
      .onTapGesture(perform: toggle)
      .contextMenu {
        Picker("Spot", selection: Binding(get: { state.spot }, set: move)) {
          Text("At the notch").tag(Spot.notch)
          Text("On the right edge").tag(Spot.rightEdge)
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

  init(defaults: UserDefaults = .standard) {
    let folder = defaults.string(forKey: "workbenchFolder") ?? NSString(string: "~/Documents/Projecten/workbench").expandingTildeInPath
    workbench = Workbench(folder: URL(fileURLWithPath: folder))
    state = WidgetState(spot: Spot(rawValue: defaults.string(forKey: "spot") ?? "") ?? .notch)
    super.init()

    // The panels hold these closures and the widget holds the panels, for as long as the app runs.
    circle.contentView = FirstClickHostingView(rootView: CircleButton(
      state: state,
      toggle: { [unowned self] in toggleList() },
      move: { [unowned self] in move(to: $0) },
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

  private func place() {
    let screens = NSScreen.screens.map {
      Screen(frame: $0.frame, visibleFrame: $0.visibleFrame, hasNotch: $0.safeAreaInsets.top > 0)
    }
    guard let screen = screenForCircle(screens) else { return }
    let frame = circleFrame(for: state.spot, on: screen)
    circle.setFrame(frame, display: true)
    list.setFrame(listFrame(for: state.spot, circle: frame, size: listSize, on: screen), display: true)
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

  private func move(to spot: Spot) {
    state.spot = spot
    UserDefaults.standard.set(spot.rawValue, forKey: "spot")
    place()
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
