import AppKit
import Observation

@Observable
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = MenuBarIconRenderer.image(badgeCount: 0)
        item.button?.action = #selector(statusItemClicked)
        item.button?.target = self
        statusItem = item
    }

    func updateBadge(count: Int) {
        statusItem?.button?.image = MenuBarIconRenderer.image(badgeCount: count)
    }

    @objc private func statusItemClicked() {
        NSApp.activate(ignoringOtherApps: true)
        for window in NSApp.windows {
            window.makeKeyAndOrderFront(nil)
        }
    }
}
