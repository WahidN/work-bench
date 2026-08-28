import Testing
import Foundation
@testable import Workbench

@Suite
struct EngineAgentPlistTests {
    private let engineDir = "/Users/someone/Projecten/workbench/engine"

    private func plist() -> [String: Any] {
        EngineAgent.plist(engineDirectory: engineDir, logPath: "/Users/someone/Library/Logs/workbench-engine.log")
    }

    @Test func labelIsTheReverseDnsIdentifier() {
        #expect(EngineAgent.label == "nl.linku.workbench.engine")
        #expect(plist()["Label"] as? String == EngineAgent.label)
    }

    @Test func programRunsALoginShell() {
        let arguments = plist()["ProgramArguments"] as? [String]

        #expect(arguments?.first == "/bin/zsh")
        // -l so the user's own shell configuration is sourced: node resolves through a
        // version-manager shim that a launched app's minimal PATH cannot see.
        #expect(arguments?[1] == "-lc")
        #expect(arguments?.count == 3)
    }

    @Test func commandChangesToTheEngineDirectoryAndExecs() {
        let command = (plist()["ProgramArguments"] as? [String])?[2] ?? ""

        #expect(command.contains("cd '\(engineDir)'"))
        #expect(command.contains("pnpm start"))
        // Load-bearing: without exec, zsh remains the supervised process and launchd
        // sees the shell exit rather than the engine crashing, so KeepAlive misfires.
        #expect(command.contains("exec pnpm start"))
    }

    @Test func startsAtLoginAndRestartsOnlyAfterACrash() {
        #expect(plist()["RunAtLoad"] as? Bool == true)

        // A dictionary, not `true`: blanket KeepAlive races against removal and
        // resurrects an engine that exited on purpose.
        let keepAlive = plist()["KeepAlive"] as? [String: Any]
        #expect(keepAlive != nil)
        #expect(plist()["KeepAlive"] as? Bool == nil)
        #expect(keepAlive?["SuccessfulExit"] as? Bool == false)
    }

    @Test func sendsOutputToTheLogSoAFailureIsDiagnosable() {
        let log = "/Users/someone/Library/Logs/workbench-engine.log"

        #expect(plist()["StandardOutPath"] as? String == log)
        #expect(plist()["StandardErrorPath"] as? String == log)
    }

    @Test func quotesTheDirectoryAgainstASpaceInThePath() {
        let spaced = EngineAgent.plist(
            engineDirectory: "/Users/someone/My Projects/workbench/engine",
            logPath: "/tmp/log"
        )
        let command = (spaced["ProgramArguments"] as? [String])?[2] ?? ""

        #expect(command.contains("cd '/Users/someone/My Projects/workbench/engine'"))
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
