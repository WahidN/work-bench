import Testing
import Foundation
@testable import Workbench

/// Records what would have happened instead of doing it. Nothing here writes to
/// ~/Library/LaunchAgents or runs launchctl: a test that did would install a real
/// agent on whatever machine ran the suite.
final class FakeAgentEnvironment: AgentEnvironment {
    var validDirectories: Set<String> = []
    var portInUse = false
    var plistExists = false
    var runResults: [String: Result<String, Error>] = [:]

    private(set) var written: [(path: String, plist: [String: Any])] = []
    private(set) var deleted: [String] = []
    private(set) var commands: [[String]] = []

    func isEngineDirectory(_ path: String) -> Bool { validDirectories.contains(path) }
    func isPortInUse() -> Bool { portInUse }
    func plistFileExists() -> Bool { plistExists }

    func writePlist(_ plist: [String: Any], to path: String) throws {
        written.append((path, plist))
    }

    func deletePlist(at path: String) throws {
        deleted.append(path)
    }

    func run(_ arguments: [String]) throws -> String {
        commands.append(arguments)
        switch runResults[arguments.first ?? ""] {
        case .failure(let error): throw error
        case .success(let output): return output
        case nil: return ""
        }
    }
}

@Suite
struct EngineAgentInstallerTests {
    private let engineDir = "/Users/someone/workbench/engine"

    private func installer(_ environment: FakeAgentEnvironment) -> EngineAgentInstaller {
        EngineAgentInstaller(environment: environment)
    }

    @Test func installWritesThePlistThenBootstrapsIt() throws {
        let environment = FakeAgentEnvironment()
        environment.validDirectories = [engineDir]

        try installer(environment).install(engineDirectory: engineDir)

        #expect(environment.written.count == 1)
        #expect(environment.written[0].plist["Label"] as? String == EngineAgent.label)
        #expect(environment.commands.count == 1)
        #expect(environment.commands[0].contains("bootstrap"))
        #expect(environment.commands[0].contains(EngineAgent.plistPath))
    }

    @Test func installRefusesWithoutADirectory() {
        let environment = FakeAgentEnvironment()

        #expect(throws: EngineAgentError.noDirectoryChosen) {
            try installer(environment).install(engineDirectory: "")
        }
        #expect(environment.written.isEmpty)
        #expect(environment.commands.isEmpty)
    }

    @Test func installRefusesADirectoryThatIsNotTheEngine() {
        let environment = FakeAgentEnvironment()
        environment.validDirectories = []

        #expect(throws: EngineAgentError.notAnEngineDirectory) {
            try installer(environment).install(engineDirectory: "/somewhere/else")
        }
        #expect(environment.written.isEmpty)
        #expect(environment.commands.isEmpty)
    }

    // KeepAlive plus a port that cannot be bound is an endless restart loop that only
    // shows up as a growing log file. Refusing up front is the whole point.
    @Test func installRefusesWhileThePortIsTakenAndTouchesNothing() {
        let environment = FakeAgentEnvironment()
        environment.validDirectories = [engineDir]
        environment.portInUse = true

        #expect(throws: EngineAgentError.portAlreadyInUse) {
            try installer(environment).install(engineDirectory: engineDir)
        }
        #expect(environment.written.isEmpty, "no plist may be written when the port is taken")
        #expect(environment.commands.isEmpty, "launchctl must not be run when the port is taken")
    }

    @Test func installSurfacesALaunchctlFailureRatherThanSwallowingIt() {
        let environment = FakeAgentEnvironment()
        environment.validDirectories = [engineDir]
        environment.runResults["launchctl"] = .failure(
            EngineAgentError.commandFailed("Bootstrap failed: 5: Input/output error")
        )

        #expect(throws: EngineAgentError.commandFailed("Bootstrap failed: 5: Input/output error")) {
            try installer(environment).install(engineDirectory: engineDir)
        }
    }

    @Test func removeBootsOutThenDeletesThePlist() throws {
        let environment = FakeAgentEnvironment()
        environment.plistExists = true

        try installer(environment).remove()

        #expect(environment.commands.count == 1)
        #expect(environment.commands[0].contains("bootout"))
        #expect(environment.deleted == [EngineAgent.plistPath])
    }

    // launchctl exits non-zero when the job is not loaded, which is the normal state
    // after the engine has already died. Removal must still finish the job.
    @Test func removeSucceedsWhenTheJobIsAlreadyGone() throws {
        let environment = FakeAgentEnvironment()
        environment.plistExists = true
        environment.runResults["launchctl"] = .failure(
            EngineAgentError.commandFailed("Could not find service")
        )

        try installer(environment).remove()

        #expect(environment.deleted == [EngineAgent.plistPath])
    }

    @Test func removeIsHarmlessWhenNothingWasInstalled() throws {
        let environment = FakeAgentEnvironment()
        environment.plistExists = false

        try installer(environment).remove()

        #expect(environment.deleted.isEmpty)
    }

    @Test func isInstalledReflectsThePlistOnDisk() {
        let environment = FakeAgentEnvironment()

        environment.plistExists = false
        #expect(installer(environment).isInstalled() == false)

        environment.plistExists = true
        #expect(installer(environment).isInstalled())
    }
}
