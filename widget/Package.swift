// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "WorkbenchWidget",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "WidgetCore"),
    .testTarget(name: "WidgetCoreTests", dependencies: ["WidgetCore"]),
  ]
)
