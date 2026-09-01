import Testing
@testable import Workbench

@Suite
struct PrReviewLogicTests {
    private func finding(_ line: Int, _ body: String = "a remark") -> ReviewFinding {
        ReviewFinding(path: "src/a.ts", line: line, body: body)
    }

    private func discarded(_ line: Int) -> DiscardedFinding {
        DiscardedFinding(path: "src/a.ts", line: line, body: "invented", reason: "line \(line) is not part of the changes")
    }

    @Test func aReviewWithFindingsOffersPublishing() {
        #expect(PrReviewLogic.canPublish(findings: [finding(12)]))
    }

    @Test func aReviewWithNoFindingsDoesNotOfferPublishing() {
        #expect(PrReviewLogic.canPublish(findings: []) == false)
    }

    // Discarding the last one has to close publishing too, or the button posts
    // an empty review and the engine rejects it.
    @Test func discardingTheLastFindingStopsOfferingPublishing() {
        var findings = [finding(12)]
        findings.removeAll { $0.line == 12 }

        #expect(PrReviewLogic.canPublish(findings: findings) == false)
    }

    // The count has to be what would actually be posted. Showing the number the
    // review produced would promise comments that were already thrown away.
    @Test func theCountIsWhatWouldBePostedNotWhatTheReviewProduced() {
        let summary = PrReviewLogic.summary(findings: [finding(12), finding(13)], discarded: [discarded(999), discarded(998)])

        #expect(summary.contains("2"))
        #expect(summary.lowercased().contains("comment"))
    }

    @Test func aReviewWhereEverythingWasDiscardedSaysSoAndOffersNothing() {
        let state = PrReviewLogic.emptyState(findings: [], discarded: [discarded(999)])

        #expect(state != nil)
        #expect(state?.lowercased().contains("nothing") == true || state?.lowercased().contains("no ") == true)
        #expect(PrReviewLogic.canPublish(findings: []) == false)
    }

    @Test func aReviewThatFoundNothingAtAllSaysSo() {
        let state = PrReviewLogic.emptyState(findings: [], discarded: [])

        #expect(state != nil)
    }

    // A review with something to post is not an empty state, whatever was
    // discarded alongside it.
    @Test func aReviewWithSomethingToPostIsNotAnEmptyState() {
        #expect(PrReviewLogic.emptyState(findings: [finding(12)], discarded: [discarded(999)]) == nil)
    }

    @Test func theTwoEmptyStatesReadDifferently() {
        let foundNothing = PrReviewLogic.emptyState(findings: [], discarded: [])
        let allDiscarded = PrReviewLogic.emptyState(findings: [], discarded: [discarded(999)])

        #expect(foundNothing != allDiscarded)
    }
}
