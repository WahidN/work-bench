import Testing
import Foundation
@testable import Workbench

@Suite
struct EngineReachabilityTests {
    // Only a transport failure means the engine is not there. Every other error came
    // from the engine answering, so the engine is by definition up.
    @Test func aTransportFailureMeansUnreachable() {
        #expect(EngineReachability.isDown(APIError.transportFailed("Could not connect")))
    }

    @Test func anErrorFromTheEngineMeansItIsUp() {
        #expect(EngineReachability.isDown(APIError.serverError("boom")) == false)
        #expect(EngineReachability.isDown(APIError.unauthorized) == false)
        #expect(EngineReachability.isDown(APIError.notFound("nope")) == false)
        #expect(EngineReachability.isDown(APIError.badRequest("bad")) == false)
        #expect(EngineReachability.isDown(APIError.conflict("busy")) == false)
        #expect(EngineReachability.isDown(APIError.decodingFailed("odd")) == false)
    }

    @Test func anUnrelatedErrorIsNotTreatedAsTheEngineBeingDown() {
        struct Other: Error {}
        #expect(EngineReachability.isDown(Other()) == false)
    }
}

@MainActor
final class MockEngineProbe: EngineProbe {
    var results: [Result<Void, Error>] = []
    /// Runs inside a ping, so a test can act while the poll loop is genuinely running.
    var onPing: (() -> Void)?
    private(set) var calls = 0

    func ping() async throws {
        calls += 1
        onPing?()
        let result = results[min(calls - 1, max(results.count - 1, 0))]
        try result.get()
    }
}

/// Isolated on both counts: a fake environment so nothing can install a real agent,
/// and a throwaway defaults suite so a test can never write into the user's own
/// preferences.
@MainActor
private func testViewModel(_ probe: MockEngineProbe) -> EngineViewModel {
    EngineViewModel(
        probe: probe,
        installer: EngineAgentInstaller(environment: FakeAgentEnvironment()),
        defaults: UserDefaults(suiteName: "workbench-tests-\(UUID().uuidString)")!
    )
}

@MainActor
@Suite
struct EngineViewModelTests {
    @Test func startsOutUnknown() {
        let viewModel = EngineViewModel(probe: MockEngineProbe())

        #expect(viewModel.state == .unknown)
        #expect(viewModel.isDown == false)
    }

    @Test func becomesReachableAfterASuccessfulPing() async {
        let probe = MockEngineProbe()
        probe.results = [.success(())]
        let viewModel = testViewModel(probe)

        await viewModel.check()

        #expect(viewModel.state == .reachable)
        #expect(viewModel.isDown == false)
    }

    @Test func becomesUnreachableAfterATransportFailure() async {
        let probe = MockEngineProbe()
        probe.results = [.failure(APIError.transportFailed("refused"))]
        let viewModel = testViewModel(probe)

        await viewModel.check()

        #expect(viewModel.state == .unreachable)
        #expect(viewModel.isDown)
    }

    // The engine answering with an error still means it is running, so the banner must
    // not appear: showing "engine unreachable" for a 500 would send the user to Settings
    // to fix something that is not broken.
    @Test func staysReachableWhenTheEngineAnswersWithAnError() async {
        let probe = MockEngineProbe()
        probe.results = [.failure(APIError.serverError("claude exploded"))]
        let viewModel = testViewModel(probe)

        await viewModel.check()

        #expect(viewModel.state == .reachable)
        #expect(viewModel.isDown == false)
    }

    @Test func recoversOnItsOwnWhenTheEngineComesBack() async {
        let probe = MockEngineProbe()
        probe.results = [.failure(APIError.transportFailed("refused")), .success(())]
        let viewModel = testViewModel(probe)

        await viewModel.check()
        #expect(viewModel.isDown)

        await viewModel.check()
        #expect(viewModel.isDown == false)
    }

    // Stopping is asked of a poll that is already running, which is what the app does
    // when the last window closes. A stop before poll() is not the scenario: poll() is
    // the entry point that starts polling, so it must not be permanently disabled by an
    // earlier stop.
    @Test func pollingStopsWhenAskedMidFlight() async {
        let probe = MockEngineProbe()
        probe.results = [.success(())]
        let viewModel = testViewModel(probe)
        probe.onPing = { [weak viewModel] in viewModel?.stopPolling() }

        await viewModel.poll(every: .zero, attempts: 5)

        #expect(probe.calls == 1, "the loop must exit after the stop rather than run to attempts")
    }

    @Test func anEarlierStopDoesNotDisableALaterPoll() async {
        let probe = MockEngineProbe()
        probe.results = [.success(())]
        let viewModel = testViewModel(probe)

        viewModel.stopPolling()
        await viewModel.poll(every: .zero, attempts: 2)

        #expect(probe.calls == 2)
    }

    @Test func pollingKeepsCheckingWhileItRuns() async {
        let probe = MockEngineProbe()
        probe.results = [.success(())]
        let viewModel = testViewModel(probe)

        await viewModel.poll(every: .zero, attempts: 3)

        #expect(probe.calls == 3)
    }
}
