import Testing
@testable import Workbench

private final class StubPrReviewAPI: PrReviewAPI {
    var result = PrReviewResult(findings: [], discarded: [], commitSha: "abc")
    var reviewError: Error?
    var publishResult = PublishReviewResult(posted: [], failed: [])
    var publishError: Error?
    var reviewCallCount = 0
    var publishCallCount = 0
    var publishedFindings: [ReviewFinding]?

    func reviewPr(id: Int) async throws -> PrReviewResult {
        reviewCallCount += 1
        if let reviewError { throw reviewError }
        return result
    }

    func publishReview(id: Int, findings: [ReviewFinding]) async throws -> PublishReviewResult {
        publishCallCount += 1
        publishedFindings = findings
        if let publishError { throw publishError }
        return publishResult
    }
}

private func finding(_ line: Int, _ body: String = "a remark") -> ReviewFinding {
    ReviewFinding(path: "src/a.ts", line: line, body: body)
}

@Suite @MainActor
struct PrReviewViewModelTests {
    @Test func aSuccessfulReviewKeepsTheFindingsAndClearsTheRunningState() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12)], discarded: [], commitSha: "abc")
        let model = PrReviewViewModel(api: api)

        await model.review(prId: 1)

        #expect(model.isReviewing == false)
        #expect(model.findings.count == 1)
        #expect(model.errorMessage == nil)
    }

    @Test func aFailedReviewSurfacesTheErrorAndOffersNothing() async {
        let api = StubPrReviewAPI()
        api.reviewError = APIError.serverError("claude exploded")
        let model = PrReviewViewModel(api: api)

        await model.review(prId: 1)

        #expect(model.isReviewing == false)
        #expect(model.errorMessage != nil)
        #expect(model.findings.isEmpty)
    }

    // The whole point of the draft: a review must never post by itself.
    @Test func reviewingNeverPublishes() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12)], discarded: [], commitSha: "abc")
        let model = PrReviewViewModel(api: api)

        await model.review(prId: 1)

        #expect(api.publishCallCount == 0)
    }

    @Test func anEditedRemarkIsWhatGetsPublished() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12, "original")], discarded: [], commitSha: "abc")
        let model = PrReviewViewModel(api: api)
        await model.review(prId: 1)

        model.edit(findingAt: 0, body: "edited by the user")
        await model.publish(prId: 1)

        #expect(api.publishedFindings?.first?.body == "edited by the user")
    }

    @Test func aDiscardedFindingIsNotPublished() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12, "keep"), finding(13, "drop")], discarded: [], commitSha: "abc")
        let model = PrReviewViewModel(api: api)
        await model.review(prId: 1)

        model.discard(findingAt: 1)
        await model.publish(prId: 1)

        #expect(api.publishedFindings?.count == 1)
        #expect(api.publishedFindings?.first?.body == "keep")
    }

    // What failed has to stay in front of the user, or the remark is lost with
    // no way to try again.
    @Test func aPartialPublishFailureKeepsTheFailedFindingsAndNamesThem() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12, "ok"), finding(13, "bad")], discarded: [], commitSha: "abc")
        api.publishResult = PublishReviewResult(
            posted: [finding(12, "ok")],
            failed: [FailedFinding(path: "src/a.ts", line: 13, body: "bad", error: "422 Unprocessable Entity")]
        )
        let model = PrReviewViewModel(api: api)
        await model.review(prId: 1)

        await model.publish(prId: 1)

        #expect(model.findings.count == 1)
        #expect(model.findings.first?.line == 13)
        #expect(model.errorMessage?.contains("422") == true)
    }

    @Test func aFullySuccessfulPublishClearsTheReview() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12)], discarded: [], commitSha: "abc")
        api.publishResult = PublishReviewResult(posted: [finding(12)], failed: [])
        let model = PrReviewViewModel(api: api)
        await model.review(prId: 1)

        await model.publish(prId: 1)

        #expect(model.findings.isEmpty)
        #expect(model.errorMessage == nil)
        #expect(model.didPublish)
    }

    @Test func aFailedPublishSurfacesTheErrorAndKeepsEverything() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12)], discarded: [], commitSha: "abc")
        api.publishError = APIError.serverError("github unreachable")
        let model = PrReviewViewModel(api: api)
        await model.review(prId: 1)

        await model.publish(prId: 1)

        #expect(model.findings.count == 1)
        #expect(model.errorMessage != nil)
        #expect(model.didPublish == false)
    }

    @Test func discardingTheReviewLeavesNothingBehind() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(findings: [finding(12)], discarded: [], commitSha: "abc")
        let model = PrReviewViewModel(api: api)
        await model.review(prId: 1)

        model.reset()

        #expect(model.findings.isEmpty)
        #expect(api.publishCallCount == 0)
    }

    @Test func theDiscardedFindingsAreKeptSoTheUserSeesTheReviewWasTrimmed() async {
        let api = StubPrReviewAPI()
        api.result = PrReviewResult(
            findings: [],
            discarded: [DiscardedFinding(path: "src/a.ts", line: 999, body: "x", reason: "line 999 is not part of the changes")],
            commitSha: "abc"
        )
        let model = PrReviewViewModel(api: api)

        await model.review(prId: 1)

        #expect(model.discarded.count == 1)
    }
}
