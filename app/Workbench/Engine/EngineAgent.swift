import Foundation

/// The launchd agent that keeps the engine running: what it is called, what its
/// plist says, and whether a directory actually holds the engine.
///
/// Deliberately pure. Nothing here touches the filesystem except `isEngineDirectory`,
/// and nothing runs a process, so the fiddly parts are testable without installing
/// anything on the machine running the tests.
enum EngineAgent {
    static let label = "nl.linku.workbench.engine"

    /// The engine is started the same way a person starts it, through a login shell.
    ///
    /// Not by resolving `pnpm` and `node` to absolute paths and baking those in: node
    /// here resolves through a version-manager shim, so a baked path goes stale the
    /// moment the user switches versions, and the app cannot discover the real one
    /// anyway because a launched app inherits a minimal PATH.
    ///
    /// `exec` is load-bearing. Without it zsh stays alive as the parent, launchd
    /// supervises the shell instead of the engine, and KeepAlive never sees a crash.
    static func plist(engineDirectory: String, logPath: String) -> [String: Any] {
        let command = "cd '\(engineDirectory)' && exec pnpm start"
        return [
            "Label": label,
            "ProgramArguments": ["/bin/zsh", "-lc", command],
            "RunAtLoad": true,
            // A dictionary rather than `true`: blanket KeepAlive races against removal
            // and revives an engine that exited deliberately. Restart only on a crash.
            "KeepAlive": ["SuccessfulExit": false],
            "StandardOutPath": logPath,
            "StandardErrorPath": logPath,
        ]
    }

    /// True when the directory looks like the engine. Checking for its package.json is
    /// what turns "that folder is not the engine" into a real answer rather than a guess.
    static func isEngineDirectory(_ path: String) -> Bool {
        guard !path.isEmpty else { return false }
        let packageJson = URL(fileURLWithPath: path).appendingPathComponent("package.json")
        return FileManager.default.fileExists(atPath: packageJson.path)
    }

    static var defaultLogPath: String {
        let logs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("Logs")
        return (logs ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("workbench-engine.log")
            .path
    }

    static var plistPath: String {
        let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library")
        return library
            .appendingPathComponent("LaunchAgents")
            .appendingPathComponent("\(label).plist")
            .path
    }
}
