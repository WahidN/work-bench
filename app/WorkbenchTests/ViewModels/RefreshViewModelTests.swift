import Testing
@testable import Workbench

@MainActor
final class MockRefreshAPI: RefreshAPI {
    var result: Result<PollSummary, Error> = .success(
        PollSummary(jiraTodos: 0, ticketsCreated: 0, prsSynced: 0, sourceErrors: [])
    )
    private(set) var callCount = 0
    var onCall: (() async -> Void)?

    func poll() async throws -> PollSummary {
        callCount += 1
        await onCall?()
        return try result.get()
    }
}

@MainActor
@Suite
struct RefreshViewModelTests {
    @Test func aSuccessfulRefreshTellsTheCallerToReload() async {
        let api = MockRefreshAPI()
        api.result = .success(PollSummary(jiraTodos: 12, ticketsCreated: 0, prsSynced: 3, sourceErrors: []))
        let viewModel = RefreshViewModel(api: api)

        let shouldReload = await viewModel.refresh()

        #expect(shouldReload)
        #expect(api.callCount == 1)
        #expect(viewModel.errorMessage == nil)
        #expect(viewModel.isRefreshing == false)
    }

    @Test func aFailedRefreshIsPresentedAndDoesNotAskForAReload() async {
        let api = MockRefreshAPI()
        api.result = .failure(APIError.serverError("gh exploded"))
        let viewModel = RefreshViewModel(api: api)

        let shouldReload = await viewModel.refresh()

        #expect(shouldReload == false)
        #expect(viewModel.errorMessage == "gh exploded")
        #expect(viewModel.isRefreshing == false)
    }

    // These reach only the engine's console today, so a stale Jira token is
    // invisible in the app. The refresh button is where that stops.
    @Test func sourceErrorsAreSurfacedEvenThoughThePollSucceeded() async {
        let api = MockRefreshAPI()
        api.result = .success(PollSummary(
            jiraTodos: 0, ticketsCreated: 0, prsSynced: 2,
            sourceErrors: ["jira: 401 unauthorized", "githubPrs: gh exploded"]
        ))
        let viewModel = RefreshViewModel(api: api)

        let shouldReload = await viewModel.refresh()

        // Still a reload: the pull requests half did land.
        #expect(shouldReload)
        #expect(viewModel.errorMessage == "jira: 401 unauthorized\ngithubPrs: gh exploded")
    }

    @Test func asecondRefreshIsIgnoredWhileTheFirstIsInFlight() async {
        let api = MockRefreshAPI()
        let viewModel = RefreshViewModel(api: api)
        var secondResult: Bool?

        api.onCall = { [weak viewModel] in
            guard let viewModel else { return }
            #expect(viewModel.isRefreshing)
            secondResult = await viewModel.refresh()
        }

        _ = await viewModel.refresh()

        #expect(api.callCount == 1, "the guard must stop a second poll")
        #expect(secondResult == false)
    }
}
