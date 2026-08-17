import Testing
@testable import Workbench

private func samplePr(id: Int = 1, status: PrStatus = .open) -> PullRequest {
    PullRequest(id: id, ticketId: 1, projectId: 1, branch: "fix/gh-1", number: id,
                url: "https://x/pull/\(id)", status: status, lastReviewScore: 4.6,
                createdAt: "2026-08-12T00:00:00.000Z", title: "Sample PR", isDraft: false,
                authoredByMe: false, assignedToMe: false, messageCount: 0)
}

@MainActor
final class MockPRsAPI: PRsAPI {
    var pullRequestsResult: Result<[PullRequest], Error> = .success([])
    var setPrPinnedResult: Result<PullRequest, Error>?
    private(set) var setPrPinnedCalls: [(id: Int, pinned: Bool)] = []

    func pullRequests() async throws -> [PullRequest] { try pullRequestsResult.get() }
    func setPrPinned(id: Int, pinned: Bool) async throws -> PullRequest {
        setPrPinnedCalls.append((id, pinned))
        return try setPrPinnedResult!.get()
    }
}

@MainActor
@Suite
struct PRsViewModelTests {
    @Test func loadClearsAPriorErrorOnceTheEngineIsBackUp() async {
        let api = MockPRsAPI()
        api.pullRequestsResult = .failure(APIError.transportFailed("no engine"))
        let viewModel = PRsViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.errorMessage != nil)

        api.pullRequestsResult = .success([samplePr(id: 1)])
        await viewModel.load()
        #expect(viewModel.errorMessage == nil)
    }

    @Test func togglePinFlipsTheFlagAndStoresTheUpdatedPr() async {
        var pinned = samplePr(id: 1)
        pinned.pinned = true
        let api = MockPRsAPI()
        api.pullRequestsResult = .success([samplePr(id: 1)])
        api.setPrPinnedResult = .success(pinned)
        let viewModel = PRsViewModel(api: api)
        await viewModel.load()
        await viewModel.togglePin(samplePr(id: 1))

        #expect(api.setPrPinnedCalls.first?.pinned == true)
        #expect(viewModel.pullRequests[0].pinned)
    }
}
