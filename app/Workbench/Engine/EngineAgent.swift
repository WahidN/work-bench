import Foundation

/// The launchd agent that keeps the engine running: what it is called, what its
/// plist says, and whether a directory actually holds the engine.
///
/// Deliberately pure. Nothing here touches the filesystem except `isEngineDirectory`,
/// and nothing runs a process, so the fiddly parts are testable without installing
/// anything on the machine running the tests.
enum EngineAgent {
    static let label = "nl.linku.workbench.engine"

    /// The engine is started the same way a person starts it, through their own shell.
    ///
    /// `-i`, not `-l`. This was originally `-l` on the assumption that a login shell
    /// gives what the user's terminal gives. It does not, at least here: a login shell
    /// resolved Homebrew's node v26 while the interactive shell resolves the version
    /// manager's v24, and v24 is the one that compiled better-sqlite3. The login shell
    /// therefore started the engine with a node that could not load its own native
    /// module, failing with ERR_DLOPEN_FAILED on every retry.
    ///
    /// Not by baking absolute paths in either: node resolves through a version-manager
    /// shim, so a captured path goes stale the moment the user switches versions.
    ///
    /// `exec` is load-bearing. Without it zsh stays alive as the parent, launchd
    /// supervises the shell instead of the engine, and KeepAlive never sees a crash.
    static func plist(engineDirectory: String, logPath: String) -> [String: Any] {
        let command = "cd '\(engineDirectory)' && exec pnpm start"
        return [
            "Label": label,
            "ProgramArguments": ["/bin/zsh", "-ic", command],
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
