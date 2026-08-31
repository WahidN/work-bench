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

@Observable
@MainActor
final class EngineStatusViewModel {
    private(set) var state: EngineState = .unknown

    /// Deliberately false while unknown: a banner must not flash on launch before the
    /// first ping has had a chance to answer.
    var isDown: Bool { state == .unreachable }

    private let probe: any EngineProbe
    private var isPolling = false

    init(probe: any EngineProbe = APIEngineProbe()) {
        self.probe = probe
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
