import Testing
@testable import Workbench

private final class StubPrDetailAPI: PrDetailAPI {
    var detail: PrDetail?
    var detailError: Error?
    var draft = "suggested reply"
    var postedText: String?
    var mergeResult = PrChatResult(action: .merged, reply: "Merged.")

    func prDetail(id: Int) async throws -> PrDetail {
        if let detailError { throw detailError }
        return detail!
    }
    func draftReviewReply(prId: Int, commentId: Int) async throws -> String { draft }
    func postReviewReply(prId: Int, commentId: Int, text: String) async throws { postedText = text }
    func mergePr(id: Int) async throws -> PrChatResult { mergeResult }
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
}
