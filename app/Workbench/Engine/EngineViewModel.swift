import Foundation
import Observation

/// Whether a failure means the engine is absent, or merely unhappy.
///
/// Only a transport-level failure means absent. Every other APIError came back from
/// the engine, so the engine is running: reporting "unreachable" for a 500 would send
/// the user to Settings to fix something that is not broken.
enum EngineReachability {
    static func isDown(_ error: Error) -> Bool {
        if case .transportFailed = error as? APIError { return true }
        return false
    }
}

protocol EngineProbe {
    /// Succeeds when the engine answers, throws otherwise. A thrown APIError that is
    /// not transportFailed still means the engine is there.
    func ping() async throws
}

/// Reuses a request the app is already entitled to make, so this adds no endpoint and
/// in particular no second unauthenticated route.
struct APIEngineProbe: EngineProbe {
    private let client: APIClient

    init(client: APIClient = APIClient()) {
        self.client = client
    }

    func ping() async throws {
        _ = try await client.projects()
    }
}

enum EngineState: Equatable {
    case unknown
    case reachable
    case unreachable
}

/// Owns everything about the engine: whether it answers, where its source lives, and
/// whether the managed agent is installed. One type on purpose, so the Settings sheet
/// and the unreachable banner cannot disagree about whether the engine is up.
@Observable
@MainActor
final class EngineViewModel {
    private(set) var state: EngineState = .unknown
    private(set) var isAgentInstalled = false
    var errorMessage: String?

    /// Persisted, because the app is built into DerivedData and has no reliable path
    /// back to the checkout it came from.
    var engineDirectory: String {
        didSet { defaults.set(engineDirectory, forKey: Self.directoryKey) }
    }

    /// Deliberately false while unknown: a banner must not flash on launch before the
    /// first ping has had a chance to answer.
    var isDown: Bool { state == .unreachable }

    var isDirectoryValid: Bool { EngineAgent.isEngineDirectory(engineDirectory) }
    var logPath: String { EngineAgent.defaultLogPath }

    private static let directoryKey = "engineDirectory"

    private let probe: any EngineProbe
    private let installer: EngineAgentInstaller
    private let defaults: UserDefaults
    private var isPolling = false

    init(
        probe: any EngineProbe = APIEngineProbe(),
        installer: EngineAgentInstaller = EngineAgentInstaller(),
        defaults: UserDefaults = .standard
    ) {
        self.probe = probe
        self.installer = installer
        self.defaults = defaults
        self.engineDirectory = defaults.string(forKey: Self.directoryKey) ?? ""
        self.isAgentInstalled = installer.isInstalled()
    }

    func install() async {
        errorMessage = nil
        do {
            try installer.install(engineDirectory: engineDirectory)
            isAgentInstalled = installer.isInstalled()
            // launchd needs a moment to start the process before a ping can succeed.
            try? await Task.sleep(for: .seconds(2))
            await check()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func remove() async {
        errorMessage = nil
        do {
            try installer.remove()
            isAgentInstalled = installer.isInstalled()
            await check()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func check() async {
        do {
            try await probe.ping()
            state = .reachable
        } catch {
            state = EngineReachability.isDown(error) ? .unreachable : .reachable
        }
    }

    /// Thirty seconds satisfies the one-minute bound the spec asks for without being
    /// chatty. `attempts` exists so a test can bound the loop.
    func poll(every interval: Duration = .seconds(30), attempts: Int = Int.max) async {
        isPolling = true
        var done = 0
        while isPolling, done < attempts {
            await check()
            done += 1
            guard isPolling, done < attempts else { break }
            try? await Task.sleep(for: interval)
        }
        isPolling = false
    }

    func stopPolling() {
        isPolling = false
    }
}
