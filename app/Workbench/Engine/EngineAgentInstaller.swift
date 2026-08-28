import Foundation

enum EngineAgentError: Error, Equatable, LocalizedError {
    case noDirectoryChosen
    case notAnEngineDirectory
    case portAlreadyInUse
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .noDirectoryChosen:
            return "Choose the engine folder first."
        case .notAnEngineDirectory:
            return "That folder does not look like the engine: it has no package.json."
        case .portAlreadyInUse:
            return "Something is already listening on port 4173. Stop the engine you started by hand first, "
                + "otherwise launchd would restart a copy that can never claim the port."
        case .commandFailed(let message):
            return message
        }
    }
}

/// Everything the installer needs from the outside world, behind one seam so the
/// rules above it can be tested without installing an agent on the test machine.
protocol AgentEnvironment {
    func isEngineDirectory(_ path: String) -> Bool
    func isPortInUse() -> Bool
    func plistFileExists() -> Bool
    func writePlist(_ plist: [String: Any], to path: String) throws
    func deletePlist(at path: String) throws
    func run(_ arguments: [String]) throws -> String
}

struct EngineAgentInstaller {
    private let environment: any AgentEnvironment

    init(environment: any AgentEnvironment = SystemAgentEnvironment()) {
        self.environment = environment
    }

    func isInstalled() -> Bool {
        environment.plistFileExists()
    }

    /// Order matters: every refusal happens before anything is written or run, so a
    /// rejected install leaves the machine exactly as it was.
    func install(engineDirectory: String) throws {
        guard !engineDirectory.isEmpty else { throw EngineAgentError.noDirectoryChosen }
        guard environment.isEngineDirectory(engineDirectory) else { throw EngineAgentError.notAnEngineDirectory }
        guard !environment.isPortInUse() else { throw EngineAgentError.portAlreadyInUse }

        let plist = EngineAgent.plist(
            engineDirectory: engineDirectory,
            logPath: EngineAgent.defaultLogPath
        )
        try environment.writePlist(plist, to: EngineAgent.plistPath)
        _ = try environment.run(["launchctl", "bootstrap", "gui/\(getuid())", EngineAgent.plistPath])
    }

    func remove() throws {
        guard environment.plistFileExists() else { return }

        // launchctl exits non-zero when the job is not loaded, which is exactly the
        // state after the engine has already died. Removing the plist is the part that
        // must happen, so a failure here is not allowed to stop it.
        _ = try? environment.run(["launchctl", "bootout", "gui/\(getuid())/\(EngineAgent.label)"])
        try environment.deletePlist(at: EngineAgent.plistPath)
    }
}
