import Testing
@testable import Workbench

@Suite
struct PrReviewLogicTests {
    private func finding(_ id: Int, posted: Bool = false) -> ReviewFinding {
        ReviewFinding(id: id, path: "src/a.ts", line: id, body: "remark \(id)", posted: posted)
    }

    @Test func anUnpostedFindingCanBePosted() {
        #expect(PrReviewLogic.canPost(finding(1)))
    }

    // Posting the same remark twice would duplicate the comment on GitHub, and the
    // engine refuses it anyway, so the button must not offer it.
    @Test func aPostedFindingCannotBePostedAgain() {
        #expect(PrReviewLogic.canPost(finding(1, posted: true)) == false)
    }

    @Test func aReviewWithUnpostedFindingsIsNotDone() {
        #expect(PrReviewLogic.isDone(findings: [finding(1)]) == false)
    }

    @Test func aReviewWhereEverythingIsPostedIsDone() {
        #expect(PrReviewLogic.isDone(findings: [finding(1, posted: true), finding(2, posted: true)]))
    }

    @Test func aReviewWithNothingInItIsDone() {
        #expect(PrReviewLogic.isDone(findings: []))
    }

    // The count is what is left to act on, not what the review produced, or it
    // would keep promising work that is already finished.
    @Test func theSummaryCountsWhatIsLeftToPost() {
        let summary = PrReviewLogic.summary(findings: [finding(1), finding(2), finding(3, posted: true)])

        #expect(summary.contains("2"))
        #expect(summary.lowercased().contains("comment"))
    }

    @Test func theSummaryIsSingularForOne() {
        #expect(PrReviewLogic.summary(findings: [finding(1)]).contains("1 comment"))
    }

    @Test func anOutdatedReviewIsLabelled() {
        let label = PrReviewLogic.outdatedLabel(outdated: true)

        #expect(label != nil)
        #expect(label?.lowercased().contains("earlier commit") == true)
    }

    @Test func aCurrentReviewIsNotLabelled() {
        #expect(PrReviewLogic.outdatedLabel(outdated: false) == nil)
    }

    // An outdated review stays postable: whether the remark still applies is the
    // user's judgement, not the app's.
    @Test func anOutdatedFindingIsStillPostable() {
        #expect(PrReviewLogic.canPost(finding(1)))
    }
}
