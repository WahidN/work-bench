import Testing
@testable import Workbench

private final class StubPrReviewAPI: PrReviewAPI {
    var review = PrReview.empty
    var reviewError: Error?
    var startError: Error?
    var postError: Error?
    var discardError: Error?
    var startCallCount = 0
    var postCallCount = 0
    var postedBodies: [String] = []
    var discardedIds: [Int] = []

    func startReview(prId: Int) async throws {
        startCallCount += 1
        if let startError { throw startError }
    }

    func review(prId: Int) async throws -> PrReview {
        if let reviewError { throw reviewError }
        return review
    }

    func postReviewFinding(prId: Int, findingId: Int, body: String) async throws {
        postCallCount += 1
        postedBodies.append(body)
        if let postError { throw postError }
    }

    func discardReviewFinding(prId: Int, findingId: Int) async throws {
        if let discardError { throw discardError }
        discardedIds.append(findingId)
    }
}

private func finding(_ id: Int, _ body: String = "a remark", posted: Bool = false) -> ReviewFinding {
    ReviewFinding(id: id, path: "src/a.ts", line: id, body: body, posted: posted)
}

@Suite @MainActor
struct PrReviewViewModelTests {
    // Starting only starts it. Nothing comes back, because the work outlives the call.
    @Test func startingAReviewDoesNotReturnFindings() async {
        let api = StubPrReviewAPI()
        let model = PrReviewViewModel(api: api)

        await model.start(prId: 1)

        #expect(api.startCallCount == 1)
        #expect(model.findings.isEmpty)
        #expect(model.errorMessage == nil)
    }

    @Test func aFailedStartSurfacesTheError() async {
        let api = StubPrReviewAPI()
        api.startError = APIError.serverError("engine down")
        let model = PrReviewViewModel(api: api)

        await model.start(prId: 1)

        #expect(model.errorMessage != nil)
        #expect(model.isStarting == false)
    }

    @Test func loadingReturnsWhatIsStored() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7), finding(8, posted: true)], outdated: false)
        let model = PrReviewViewModel(api: api)

        await model.load(prId: 1)

        #expect(model.findings.count == 2)
        #expect(model.outdated == false)
    }

    @Test func loadingCarriesTheOutdatedFlag() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7)], outdated: true)
        let model = PrReviewViewModel(api: api)

        await model.load(prId: 1)

        #expect(model.outdated)
    }

    @Test func postingOneMarksOnlyThatOne() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7), finding(8)], outdated: false)
        let model = PrReviewViewModel(api: api)
        await model.load(prId: 1)

        await model.post(prId: 1, findingId: 7)

        #expect(model.findings.first { $0.id == 7 }?.posted == true)
        #expect(model.findings.first { $0.id == 8 }?.posted == false)
        #expect(api.postCallCount == 1)
    }

    @Test func anEditedBodyIsWhatGetsPosted() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7, "original")], outdated: false)
        let model = PrReviewViewModel(api: api)
        await model.load(prId: 1)

        model.edit(findingId: 7, body: "edited by the user")
        await model.post(prId: 1, findingId: 7)

        #expect(api.postedBodies == ["edited by the user"])
    }

    // The remark has to stay in front of the user, unposted, or it is lost.
    @Test func aFailedPostKeepsTheFindingUnpostedAndPutsTheErrorOnIt() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7), finding(8)], outdated: false)
        api.postError = APIError.serverError("422 Unprocessable Entity")
        let model = PrReviewViewModel(api: api)
        await model.load(prId: 1)

        await model.post(prId: 1, findingId: 7)

        #expect(model.findings.first { $0.id == 7 }?.posted == false)
        #expect(model.error(forFinding: 7)?.contains("422") == true)
        #expect(model.error(forFinding: 8) == nil)
    }

    @Test func aRetryAfterAFailureClearsTheOldError() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7)], outdated: false)
        api.postError = APIError.serverError("422")
        let model = PrReviewViewModel(api: api)
        await model.load(prId: 1)
        await model.post(prId: 1, findingId: 7)

        api.postError = nil
        await model.post(prId: 1, findingId: 7)

        #expect(model.error(forFinding: 7) == nil)
        #expect(model.findings.first { $0.id == 7 }?.posted == true)
    }

    @Test func discardingRemovesOnlyThatOne() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7), finding(8)], outdated: false)
        let model = PrReviewViewModel(api: api)
        await model.load(prId: 1)

        await model.discard(prId: 1, findingId: 7)

        #expect(model.findings.count == 1)
        #expect(model.findings[0].id == 8)
        #expect(api.discardedIds == [7])
        #expect(api.postCallCount == 0)
    }

    @Test func aFailedDiscardKeepsTheFinding() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7)], outdated: false)
        api.discardError = APIError.serverError("engine down")
        let model = PrReviewViewModel(api: api)
        await model.load(prId: 1)

        await model.discard(prId: 1, findingId: 7)

        #expect(model.findings.count == 1)
        #expect(model.errorMessage != nil)
    }

    @Test func nothingIsPostedByLoading() async {
        let api = StubPrReviewAPI()
        api.review = PrReview(findings: [finding(7)], outdated: false)
        let model = PrReviewViewModel(api: api)

        await model.load(prId: 1)

        #expect(api.postCallCount == 0)
    }
}
