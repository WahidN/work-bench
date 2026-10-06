// swift-tools-version: 6.2
import PackageDescription

let onMainActor: [SwiftSetting] = [.defaultIsolation(MainActor.self)]

let package = Package(
  name: "WorkbenchWidget",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "WidgetCore"),
    .target(name: "WidgetUI", dependencies: ["WidgetCore"], swiftSettings: onMainActor),
    .executableTarget(name: "WorkbenchWidget", dependencies: ["WidgetCore", "WidgetUI"], swiftSettings: onMainActor),
    .executableTarget(name: "RenderPreviews", dependencies: ["WidgetCore", "WidgetUI"], swiftSettings: onMainActor),
    .testTarget(name: "WidgetCoreTests", dependencies: ["WidgetCore"]),
  ]
)
