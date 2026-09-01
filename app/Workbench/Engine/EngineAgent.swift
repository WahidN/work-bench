import Foundation

/// Where the engine's toolchain actually lives: a real node binary, the pnpm
/// script it should run, and the claude binary its agent features shell out to.
///
/// `nodePath` must be a real executable, never a version-manager shim. On this
/// machine `~/.vite-plus/bin/node` is a symlink to a single multiplexed `vp`
/// binary, and under launchd that shim hangs forever on a unix socket waiting for
/// a service that is not there: the job reports "running" while nothing ever
/// listens and nothing is ever logged. `EngineToolchain` exists to make the
/// distinction between a shim and the binary behind it explicit.
struct EngineToolchain: Equatable {
    let nodePath: String
    let pnpmPath: String
    /// Resolved as the symlink `command -v claude` reports, not the versioned binary
    /// behind it: Claude Code repoints that symlink on every update, so capturing the
    /// stable name keeps the agent working across upgrades.
    let claudePath: String

    /// The directory holding the real node, put first on the agent's PATH so that
    /// pnpm's `#!/usr/bin/env node` shebang and every child process it spawns
    /// resolve the same node that compiled the engine's native modules.
    var nodeDirectory: String {
        URL(fileURLWithPath: nodePath).deletingLastPathComponent().path
    }

    var pnpmDirectory: String {
        URL(fileURLWithPath: pnpmPath).deletingLastPathComponent().path
    }

    var claudeDirectory: String {
        URL(fileURLWithPath: claudePath).deletingLastPathComponent().path
    }
}

/// The launchd agent that keeps the engine running: what it is called, what its
/// plist says, and whether a directory actually holds the engine.
///
/// Deliberately pure. Nothing here touches the filesystem except `isEngineDirectory`,
/// and nothing runs a process, so the fiddly parts are testable without installing
/// anything on the machine running the tests.
enum EngineAgent {
    static let label = "nl.linku.workbench.engine"

    /// Runs the engine with no shell at all: launchd executes the real node binary
    /// directly on the pnpm script.
    ///
    /// Two shell wrappers were tried first and both failed, for opposite reasons.
    /// A login shell (`-lc`) sources `.zprofile`, which supplies Homebrew's pnpm but
    /// also Homebrew's node v26, and v26 cannot load the `better-sqlite3` that node
    /// v24 compiled: `ERR_DLOPEN_FAILED` on every KeepAlive retry. An interactive
    /// shell (`-ic`) sources `.zshrc`, which supplies node v24 but not Homebrew, so
    /// the job died with `command not found: pnpm` and exit code 127.
    ///
    /// The deeper problem is that a shell wrapper makes the engine depend on the
    /// user's shell configuration surviving launchd's near-empty environment, and
    /// here it does not: `.zshrc` failed partway through, on `pyenv` not being
    /// found, before it finished building PATH. Sourcing both configurations
    /// (`-lic`) does resolve both tools, but it still lands on the version-manager
    /// shim described in `EngineToolchain`, which hangs headless.
    ///
    /// So the shell is used once, at install time, to ask the toolchain where it
    /// really lives, and never again at launch time. What launchd runs is fixed,
    /// explicit and independent of any dotfile.
    ///
    /// `WorkingDirectory` replaces the old `cd '<dir>' && exec ...`, which removes
    /// the shell quoting question entirely, and there is no wrapper process left
    /// for launchd to supervise instead of the engine, so `exec` is no longer needed.
    static func plist(engineDirectory: String, toolchain: EngineToolchain, logPath: String) -> [String: Any] {
        // claudeDirectory is here because the engine shells out to `claude` for chat,
        // analyze, implement and review. launchd's own PATH is /usr/bin:/bin:/usr/sbin:
        // /sbin, and Claude Code installs to ~/.local/bin, so without this entry every
        // agent call failed with `spawn claude ENOENT` while the engine itself looked
        // perfectly healthy: it started, it served, and `gh` and `git` both resolved.
        //
        // Deduplicated because two tools often share a directory, pnpm and claude both
        // being common in /opt/homebrew/bin, and a repeated PATH entry reads like a bug
        // when someone is debugging this plist at 2am.
        var seen = Set<String>()
        let path = [
            toolchain.nodeDirectory,
            toolchain.pnpmDirectory,
            toolchain.claudeDirectory,
            "/usr/bin", "/bin", "/usr/sbin", "/sbin",
        ].filter { seen.insert($0).inserted }.joined(separator: ":")

        return [
            "Label": label,
            "ProgramArguments": [toolchain.nodePath, toolchain.pnpmPath, "start"],
            "WorkingDirectory": engineDirectory,
            "EnvironmentVariables": ["PATH": path],
            "RunAtLoad": true,
            // Blanket `true`, not `["SuccessfulExit": false]`. That narrower form was
            // tried first, to restart on a crash while respecting a deliberate exit,
            // and it never restarted anything: the supervised process is pnpm, which
            // traps SIGTERM and exits 0, so launchd recorded `last exit code = 0` and
            // correctly declined to revive what looked like a clean shutdown. Every
            // engine death arrives through that wrapper, so the distinction the key
            // depends on is not observable here.
            //
            // Removal does not race with this: `remove()` boots the job out of the
            // domain, and a job launchd no longer knows cannot be restarted.
            "KeepAlive": true,
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
