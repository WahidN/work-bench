import AppKit
import SwiftUI
import WidgetCore
import WidgetUI

// Draws the widget's views into PNGs, because nobody but the user can see the real widget on screen.
// Usage: RenderPreviews <output folder> <workbench folder>

let arguments = CommandLine.arguments
let output = URL(fileURLWithPath: arguments[1])
let workbench = Workbench(folder: URL(fileURLWithPath: arguments[2]))

func write(_ view: some View, to name: String) throws {
  let renderer = ImageRenderer(content: view)
  renderer.scale = 2
  guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
    let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
  else { throw WorkbenchError(message: "could not render \(name)") }
  try png.write(to: output.appending(path: name))
  print("\(name): \(Int(image.size.width))x\(Int(image.size.height))")
}

let state: ListState
do {
  let prs = try await workbench.pullRequests()
  print("loaded \(prs.count) pull requests through bun")
  state = .loaded(prs)
} catch {
  print("the list failed: \(error.localizedDescription)")
  state = .failed(error.localizedDescription)
}

if case .loaded(let prs) = state {
  try write(CircleView(count: prs.count), to: "widget-circle.png")
  try write(
    PullRequestRows(prs: Array(prs.prefix(8))) { _ in }.frame(width: listSize.width).background(Color(white: 0.1)),
    to: "widget-rows.png")
}
try write(ListView(state: state) { _ in }, to: "widget-list.png")
try write(ListView(state: .failed("gh: To get started with GitHub CLI, please run: gh auth login")) { _ in }, to: "widget-list-error.png")
