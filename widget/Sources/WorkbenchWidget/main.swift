import AppKit

let app = NSApplication.shared
// No Dock icon, and the app you work in keeps focus.
app.setActivationPolicy(.accessory)
let widget = Widget()
app.run()
