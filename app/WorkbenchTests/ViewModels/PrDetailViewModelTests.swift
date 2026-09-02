import Testing
@testable import Workbench

private final class StubPrDetailAPI: PrDetailAPI {
    var detail: PrDetail?
    var detailError: Error?
    var postedText: String?
    var postError: Error?
    var mergeResult = PrChatResult(action: .merged, reply: "Merged.")
    var mergeError: Error?
    var prDetailCallCount = 0
    /// Lets a test suspend inside postReviewReply to observe state while the call is still in flight.
    var onPost: (() async -> Void)?

    func prDetail(id: Int) async throws -> PrDetail {
        prDetailCallCount += 1
        if let detailError { throw detailError }
        return detail!
    }
    func postReviewReply(prId: Int, commentId: Int, text: String) async throws {
        await onPost?()
        if let postError { throw postError }
        postedText = text
    }
    func mergePr(id: Int) async throws -> PrChatResult {
        if let mergeError { throw mergeError }
        return mergeResult
    }
}

private func makeDetail() -> PrDetail {
    PrDetail(
        title: "t", url: "u", state: "OPEN", isDraft: false, reviewState: .reviewRequired,
        author: "wahid", createdAt: "2026-08-12T15:11:00Z", baseRefName: "main",
        headRefName: "fix/x", commitCount: 1, changedFiles: 1, additions: 1, deletions: 0,
        files: [], threads: [], conversation: []
    )
}

@MainActor
@Suite(.serialized)
struct PrDetailViewModelTests {
    @Test func loadStoresTheDetail() async {
        let api = StubPrDetailAPI()
        api.detail = makeDetail()
        let model = PrDetailViewModel(api: api)
        await model.load(prId: 1)
        #expect(model.detail?.title == "t")
        #expect(model.errorMessage == nil)
    }

    @Test func loadSurfacesAnErrorAndKeepsTheScreenUsable() async {
        let api = StubPrDetailAPI()
        api.detailError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        await model.load(prId: 1)
        #expect(model.detail == nil)
        #expect(model.errorMessage != nil)
    }

    @Test func postingSendsTheTypedTextAndReportsSuccess() async {
        let api = StubPrDetailAPI()
        api.detail = makeDetail()
        let model = PrDetailViewModel(api: api)
        let posted = await model.postReply(prId: 1, commentId: 7, text: "typed by hand")
        #expect(api.postedText == "typed by hand")
        #expect(posted)
    }

    @Test func mergeReportsARefusalRatherThanClaimingSuccess() async {
        let api = StubPrDetailAPI()
        api.mergeResult = PrChatResult(action: .refused, reply: "Workbench only merges pull requests you authored.")
        let model = PrDetailViewModel(api: api)
        await model.merge(prId: 1)
        #expect(model.errorMessage?.contains("only merges") == true)
    }

    /// The box is only emptied on a true answer, so a refused post has to report
    /// failure or the text the user typed is thrown away.
    @Test func postingReportsFailureAndSurfacesTheError() async {
        let api = StubPrDetailAPI()
        api.postError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        let posted = await model.postReply(prId: 1, commentId: 7, text: "typed by hand")
        #expect(!posted)
        #expect(model.errorMessage != nil)
    }

    @Test func postReplyClearsBusyCommentIdWhenPostingFails() async {
        let api = StubPrDetailAPI()
        api.postError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        _ = await model.postReply(prId: 1, commentId: 7, text: "typed by hand")
        #expect(!model.busyCommentIds.contains(7))
    }

    @Test func busyCommentIdsTracksEachThreadIndependently() async {
        let api = StubPrDetailAPI()
        api.postError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        var thread7StillBusyWhileThread8Posted = false
        api.onPost = {
            api.onPost = nil
            _ = await model.postReply(prId: 1, commentId: 8, text: "other thread")
            thread7StillBusyWhileThread8Posted = model.busyCommentIds.contains(7)
        }
        _ = await model.postReply(prId: 1, commentId: 7, text: "typed by hand")
        #expect(thread7StillBusyWhileThread8Posted)
        #expect(model.busyCommentIds.isEmpty)
    }

    @Test func mergeClearsIsMergingWhenMergingFails() async {
        let api = StubPrDetailAPI()
        api.mergeError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        await model.merge(prId: 1)
        #expect(model.isMerging == false)
    }

    @Test func mergeReloadsTheDetailOnSuccess() async {
        let api = StubPrDetailAPI()
        api.detail = makeDetail()
        api.mergeResult = PrChatResult(action: .merged, reply: "Merged.")
        let model = PrDetailViewModel(api: api)
        await model.merge(prId: 1)
        #expect(api.prDetailCallCount == 1)
        #expect(model.isMerging == false)
    }
}
