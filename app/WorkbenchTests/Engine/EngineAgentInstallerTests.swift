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
    var agentLoaded = false
    var runResults: [String: Result<String, Error>] = [:]
    var toolchain: Result<EngineToolchain, Error> = .success(
        EngineToolchain(nodePath: "/opt/runtimes/node/24.20.0/bin/node", pnpmPath: "/opt/homebrew/bin/pnpm")
    )

    private(set) var written: [(path: String, plist: [String: Any])] = []
    private(set) var deleted: [String] = []
    private(set) var commands: [[String]] = []

    func isEngineDirectory(_ path: String) -> Bool { validDirectories.contains(path) }
    func isPortInUse() -> Bool { portInUse }

    func resolveToolchain() throws -> EngineToolchain {
        try toolchain.get()
    }

    func plistFileExists() -> Bool { plistExists }
    func isAgentLoaded() -> Bool { agentLoaded }

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

    // Without a resolvable toolchain the plist would name a program that does not
    // exist, and the failure would only show up as a launchd job that never listens.
    @Test func installRefusesWhenTheToolchainCannotBeFoundAndTouchesNothing() {
        let environment = FakeAgentEnvironment()
        environment.validDirectories = [engineDir]
        environment.toolchain = .failure(EngineAgentError.toolchainNotFound("pnpm"))

        #expect(throws: EngineAgentError.toolchainNotFound("pnpm")) {
            try installer(environment).install(engineDirectory: engineDir)
        }
        #expect(environment.written.isEmpty, "no plist may be written without a toolchain")
        #expect(environment.commands.isEmpty, "launchctl must not be run without a toolchain")
    }

    @Test func installBakesTheResolvedToolchainIntoThePlist() throws {
        let environment = FakeAgentEnvironment()
        environment.validDirectories = [engineDir]
        environment.toolchain = .success(
            EngineToolchain(nodePath: "/opt/runtimes/node/24.20.0/bin/node", pnpmPath: "/opt/homebrew/bin/pnpm")
        )

        try installer(environment).install(engineDirectory: engineDir)

        let arguments = environment.written[0].plist["ProgramArguments"] as? [String]
        #expect(arguments?.first == "/opt/runtimes/node/24.20.0/bin/node")
        #expect(arguments?.contains("/opt/homebrew/bin/pnpm") == true)
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

    // Starting an agent that is already bootstrapped is a kickstart, not a second
    // bootstrap: launchctl refuses to bootstrap a label it already knows, so using
    // install() for the banner's Start button made the button silently do nothing.
    @Test func startKickstartsAnAgentThatIsLoaded() throws {
        let environment = FakeAgentEnvironment()
        environment.plistExists = true
        environment.agentLoaded = true

        try installer(environment).start()

        #expect(environment.commands.count == 1)
        #expect(environment.commands[0].contains("kickstart"))
        #expect(environment.commands[0].contains("-k"))
        #expect(environment.commands[0].contains("gui/\(getuid())/\(EngineAgent.label)"))
        #expect(environment.written.isEmpty, "starting must not rewrite the plist")
    }

    // A plist on disk does not mean launchd knows about it: booting the agent out
    // leaves the file behind, and kickstarting then fails with "Could not find
    // service". Conflating the two is what made the Start button break after a bootout.
    @Test func startBootstrapsAnAgentThatIsInstalledButNotLoaded() throws {
        let environment = FakeAgentEnvironment()
        environment.plistExists = true
        environment.agentLoaded = false

        try installer(environment).start()

        #expect(environment.commands.count == 1)
        #expect(environment.commands[0].contains("bootstrap"))
        #expect(environment.commands[0].contains(EngineAgent.plistPath))
        #expect(environment.written.isEmpty, "starting must not rewrite the plist")
    }

    @Test func startRefusesWhenNothingIsInstalled() {
        let environment = FakeAgentEnvironment()
        environment.plistExists = false

        #expect(throws: EngineAgentError.notInstalled) {
            try installer(environment).start()
        }
        #expect(environment.commands.isEmpty)
    }

    @Test func startSurfacesAKickstartFailure() {
        let environment = FakeAgentEnvironment()
        environment.plistExists = true
        environment.agentLoaded = true
        environment.runResults["launchctl"] = .failure(EngineAgentError.commandFailed("No such process"))

        #expect(throws: EngineAgentError.commandFailed("No such process")) {
            try installer(environment).start()
        }
    }

    @Test func isInstalledReflectsThePlistOnDisk() {
        let environment = FakeAgentEnvironment()

        environment.plistExists = false
        #expect(installer(environment).isInstalled() == false)

        environment.plistExists = true
        #expect(installer(environment).isInstalled())
    }
}
