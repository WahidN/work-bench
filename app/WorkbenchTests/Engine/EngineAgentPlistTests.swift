import Testing
import Foundation
@testable import Workbench

@Suite
struct EngineAgentPlistTests {
    private let engineDir = "/Users/someone/Projecten/workbench/engine"
    private let toolchain = EngineToolchain(
        nodePath: "/Users/someone/.vite-plus/js_runtime/node/24.20.0/bin/node",
        pnpmPath: "/opt/homebrew/bin/pnpm",
        claudePath: "/Users/someone/.local/bin/claude"
    )

    private func plist() -> [String: Any] {
        EngineAgent.plist(
            engineDirectory: engineDir,
            toolchain: toolchain,
            logPath: "/Users/someone/Library/Logs/workbench-engine.log"
        )
    }

    @Test func labelIsTheReverseDnsIdentifier() {
        #expect(EngineAgent.label == "nl.linku.workbench.engine")
        #expect(plist()["Label"] as? String == EngineAgent.label)
    }

    // No shell, in any form. Both wrappers that were tried failed under launchd: a
    // login shell gave Homebrew's node v26, which cannot load the better-sqlite3 that
    // v24 compiled, and an interactive shell gave v24 but no pnpm, so the job died
    // with exit code 127. Sourcing both still landed on a version-manager shim that
    // hangs headless. The regression guard is that /bin/zsh never appears here again.
    @Test func programRunsTheRealNodeBinaryWithNoShell() {
        let arguments = plist()["ProgramArguments"] as? [String]

        #expect(arguments?.first == toolchain.nodePath)
        #expect(arguments?[1] == toolchain.pnpmPath)
        #expect(arguments?[2] == "start")
        #expect(arguments?.count == 3)

        #expect(arguments?.contains("/bin/zsh") == false)
        #expect(arguments?.contains(where: { $0.hasPrefix("-") && $0.contains("c") }) == false)
    }

    // WorkingDirectory rather than `cd '<dir>' && exec`, which takes the shell quoting
    // question away entirely.
    @Test func runsInTheEngineDirectory() {
        #expect(plist()["WorkingDirectory"] as? String == engineDir)
    }

    // pnpm's shebang is `#!/usr/bin/env node`, and tsx spawns node again, so the PATH
    // the agent runs with decides which node the children get. The real node's own
    // directory has to come first or a system node wins and the ABI mismatch is back.
    @Test func putsTheRealNodeFirstOnThePath() throws {
        let environment = plist()["EnvironmentVariables"] as? [String: String]
        let path = try #require(environment?["PATH"])

        #expect(path.hasPrefix(toolchain.nodeDirectory + ":"))
        #expect(path.contains(toolchain.pnpmDirectory))
        #expect(path.contains("/usr/bin"))
    }

    // The engine shells out to `claude` for every agent feature, and launchd's PATH did
    // not include the ~/.local/bin where it is installed. Measured before this was
    // fixed: the engine ran fine and `gh`, `git` and `security` all resolved, so the app
    // looked healthy, while every agent call died with `spawn claude ENOENT` and chat,
    // analyze, implement and review silently did nothing.
    @Test func putsClaudeOnThePathSoTheAgentCanRun() throws {
        let environment = plist()["EnvironmentVariables"] as? [String: String]
        let path = try #require(environment?["PATH"])

        #expect(path.contains(toolchain.claudeDirectory))
    }

    // Two tools sharing a directory must not double it up: pnpm and claude are both
    // commonly in /opt/homebrew/bin.
    @Test func doesNotRepeatADirectorySharedByTwoTools() throws {
        let shared = EngineAgent.plist(
            engineDirectory: engineDir,
            toolchain: EngineToolchain(
                nodePath: "/opt/homebrew/bin/node",
                pnpmPath: "/opt/homebrew/bin/pnpm",
                claudePath: "/opt/homebrew/bin/claude"
            ),
            logPath: "/tmp/log"
        )
        let path = try #require((shared["EnvironmentVariables"] as? [String: String])?["PATH"])

        let entries = path.split(separator: ":").map(String.init)
        #expect(entries.count == Set(entries).count, "PATH has a duplicate entry: \(path)")
    }

    // Measured under launchd: killing the engine left it dead, because the supervised
    // process is pnpm, which traps SIGTERM and exits 0. `["SuccessfulExit": false]`
    // then reads that as a deliberate shutdown and restarts nothing, which defeats the
    // point of supervising it at all. Blanket KeepAlive is what actually revives it.
    @Test func startsAtLoginAndAlwaysRestarts() {
        #expect(plist()["RunAtLoad"] as? Bool == true)

        #expect(plist()["KeepAlive"] as? Bool == true)
        #expect(plist()["KeepAlive"] as? [String: Any] == nil, "the conditional form never fires through pnpm")
    }

    @Test func sendsOutputToTheLogSoAFailureIsDiagnosable() {
        let log = "/Users/someone/Library/Logs/workbench-engine.log"

        #expect(plist()["StandardOutPath"] as? String == log)
        #expect(plist()["StandardErrorPath"] as? String == log)
    }

    // A space in the path was a quoting hazard while the command went through a shell.
    // WorkingDirectory takes the raw string, so it is passed through untouched.
    @Test func handlesASpaceInThePathWithoutQuoting() {
        let spaced = EngineAgent.plist(
            engineDirectory: "/Users/someone/My Projects/workbench/engine",
            toolchain: toolchain,
            logPath: "/tmp/log"
        )

        #expect(spaced["WorkingDirectory"] as? String == "/Users/someone/My Projects/workbench/engine")
    }

    @Test func serialisesToARealPlist() throws {
        let data = try PropertyListSerialization.data(
            fromPropertyList: plist(), format: .xml, options: 0
        )
        let round = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]

        #expect(round?["Label"] as? String == EngineAgent.label)
    }
}

@Suite
struct EngineDirectoryValidationTests {
    @Test func aDirectoryHoldingTheEnginePackageIsValid() throws {
        let base = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("wb-engine-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        FileManager.default.createFile(atPath: base.appendingPathComponent("package.json").path, contents: nil)

        #expect(EngineAgent.isEngineDirectory(base.path))
    }

    @Test func aDirectoryWithoutThePackageIsNotTheEngine() throws {
        let base = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("wb-empty-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }

        #expect(EngineAgent.isEngineDirectory(base.path) == false)
    }

    @Test func aPathThatDoesNotExistIsNotTheEngine() {
        #expect(EngineAgent.isEngineDirectory("/no/such/place/engine") == false)
    }

    @Test func anEmptyPathIsNotTheEngine() {
        #expect(EngineAgent.isEngineDirectory("") == false)
    }
}
