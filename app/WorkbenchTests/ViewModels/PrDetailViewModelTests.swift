import Testing
@testable import Workbench

private final class StubPrDetailAPI: PrDetailAPI {
    var detail: PrDetail?
    var detailError: Error?
    var draft = "suggested reply"
    var draftError: Error?
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
    func draftReviewReply(prId: Int, commentId: Int) async throws -> String {
        if let draftError { throw draftError }
        return draft
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

    @Test func draftingFillsTheBoxWithoutPosting() async {
        let api = StubPrDetailAPI()
        let model = PrDetailViewModel(api: api)
        await model.draftReply(prId: 1, commentId: 7)
        #expect(model.drafts[7] == "suggested reply")
        #expect(api.postedText == nil)
    }

    @Test func postingSendsTheEditedTextAndClearsTheBox() async {
        let api = StubPrDetailAPI()
        api.detail = makeDetail()
        let model = PrDetailViewModel(api: api)
        model.drafts[7] = "edited by hand"
        await model.postReply(prId: 1, commentId: 7, text: "edited by hand")
        #expect(api.postedText == "edited by hand")
        #expect(model.drafts[7] == nil)
    }

    @Test func mergeReportsARefusalRatherThanClaimingSuccess() async {
        let api = StubPrDetailAPI()
        api.mergeResult = PrChatResult(action: .refused, reply: "Workbench only merges pull requests you authored.")
        let model = PrDetailViewModel(api: api)
        await model.merge(prId: 1)
        #expect(model.errorMessage?.contains("only merges") == true)
    }

    @Test func postingKeepsTheDraftWhenPostingFails() async {
        let api = StubPrDetailAPI()
        api.postError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        model.drafts[7] = "edited by hand"
        await model.postReply(prId: 1, commentId: 7, text: "edited by hand")
        #expect(model.drafts[7] == "edited by hand")
        #expect(model.errorMessage != nil)
    }

    @Test func draftReplyClearsBusyCommentIdWhenDraftingFails() async {
        let api = StubPrDetailAPI()
        api.draftError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        await model.draftReply(prId: 1, commentId: 7)
        #expect(!model.busyCommentIds.contains(7))
    }

    @Test func postReplyClearsBusyCommentIdWhenPostingFails() async {
        let api = StubPrDetailAPI()
        api.postError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        model.drafts[7] = "edited by hand"
        await model.postReply(prId: 1, commentId: 7, text: "edited by hand")
        #expect(!model.busyCommentIds.contains(7))
    }

    @Test func busyCommentIdsTracksEachThreadIndependently() async {
        let api = StubPrDetailAPI()
        api.postError = APIError.transportFailed("gh down")
        let model = PrDetailViewModel(api: api)
        model.drafts[7] = "edited by hand"
        var thread7StillBusyWhileThread8Posted = false
        api.onPost = {
            await model.draftReply(prId: 1, commentId: 8)
            thread7StillBusyWhileThread8Posted = model.busyCommentIds.contains(7)
        }
        await model.postReply(prId: 1, commentId: 7, text: "edited by hand")
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
