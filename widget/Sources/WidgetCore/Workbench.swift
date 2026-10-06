import Foundation

/// An app started outside a terminal gets a bare `PATH`, without `bun`, `gh` or `claude`.
public func searchPath(home: String, current: String) -> String {
  var seen = Set<String>()
  let folders = ["/opt/homebrew/bin", "\(home)/.bun/bin", "\(home)/.local/bin"] + current.split(separator: ":").map(String.init)
  return folders.filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: ":")
}

public struct WorkbenchError: LocalizedError {
  public var message: String
  public var errorDescription: String? { message }

  public init(message: String) {
    self.message = message
  }
}

/// The Bun app in `folder`. The widget asks it for the list and gives it orders, and keeps no logic of its own.
public struct Workbench: Sendable {
  public var folder: URL

  public init(folder: URL) {
    self.folder = folder
  }

  @concurrent public func pullRequests() async throws -> [PullRequest] {
    try readPullRequests(run(["src/cli.ts", "prs"]))
  }

  /// Opens the pull request in Workbench, which starts the app when it is not running yet.
  public func open(_ url: String) throws {
    try bun(["src/app.tsx", "--pr", url]).run()
  }

  private func bun(_ arguments: [String]) -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["bun"] + arguments
    process.currentDirectoryURL = folder
    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = searchPath(home: NSHomeDirectory(), current: environment["PATH"] ?? "/usr/bin:/bin")
    process.environment = environment
    process.standardInput = FileHandle.nullDevice
    return process
  }

  private func run(_ arguments: [String]) throws -> Data {
    let process = bun(arguments)
    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    let message = errors.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      let text = String(decoding: message, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
      throw WorkbenchError(message: text.isEmpty ? "bun exited with \(process.terminationStatus)" : text)
    }
    return data
  }
}
