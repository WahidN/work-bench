import Testing
@testable import Workbench

private func samplePr(id: Int = 1, status: PrStatus = .open) -> PullRequest {
    PullRequest(id: id, ticketId: 1, projectId: 1, branch: "fix/gh-1", number: id,
                url: "https://x/pull/\(id)", status: status, lastReviewScore: 4.6,
                createdAt: "2026-08-12T00:00:00.000Z")
}

@MainActor
final class MockPRsAPI: PRsAPI {
    var pullRequestsResult: Result<[PullRequest], Error> = .success([])
    var pullRequestHandler: (Int) throws -> PullRequest = { samplePr(id: $0) }
    var diffResult: Result<DiffResponse, Error> = .success(DiffResponse(diff: "--- a\n+++ b"))
    var sendMessageResult: Result<PrChatResult, Error> = .success(PrChatResult(action: .revised, reply: "done"))
    var mergeResult: Result<PrChatResult, Error> = .success(PrChatResult(action: .merged, reply: "Merged."))
    var setPrPinnedResult: Result<PullRequest, Error>?
    private(set) var diffCalls: [Int] = []
    private(set) var mergeCalls: [Int] = []
    private(set) var setPrPinnedCalls: [(id: Int, pinned: Bool)] = []

    func pullRequests() async throws -> [PullRequest] { try pullRequestsResult.get() }
    func pullRequest(id: Int) async throws -> PullRequest { try pullRequestHandler(id) }
    func diff(prId: Int) async throws -> DiffResponse {
        diffCalls.append(prId)
        return try diffResult.get()
    }
    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult { try sendMessageResult.get() }
    func mergePr(id: Int) async throws -> PrChatResult {
        mergeCalls.append(id)
        return try mergeResult.get()
    }
    func setPrPinned(id: Int, pinned: Bool) async throws -> PullRequest {
        setPrPinnedCalls.append((id, pinned))
        return try setPrPinnedResult!.get()
    }
}

@MainActor
@Suite
struct PRsViewModelTests {
    @Test func selectFetchesTheDetailOnlyAndNeverTheDiff() async {
        let api = MockPRsAPI()
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        #expect(viewModel.selectedPr?.id == 1)
        #expect(api.diffCalls.isEmpty, "a diff fetch would take the PR job lock the agent panel needs")
    }

    @Test func selectOnAnAlreadyMergedPrSkipsTheDiffCall() async {
        let api = MockPRsAPI()
        api.pullRequestHandler = { id in samplePr(id: id, status: .merged) }
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        #expect(viewModel.diffText == nil)
        #expect(api.diffCalls.isEmpty, "should never call diff for a PR already known to be merged")
    }

    @Test func sendMessageRefreshesDetailAndDiff() async {
        let api = MockPRsAPI()
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        await viewModel.sendMessage("also guard the email field")
        #expect(viewModel.diffText != nil)
    }

    @Test func mergeCallsMergeAndReloadsListWithoutFetchingDiff() async {
        let api = MockPRsAPI()
        api.pullRequestHandler = { id in samplePr(id: id, status: .open) }
        api.pullRequestsResult = .success([samplePr(id: 1, status: .merged)])
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        let diffCallsBeforeMerge = api.diffCalls.count
        await viewModel.merge()
        #expect(api.mergeCalls == [1])
        #expect(api.diffCalls.count == diffCallsBeforeMerge, "merging should never attempt a diff fetch")
        #expect(viewModel.pullRequests.first?.status == .merged)
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
