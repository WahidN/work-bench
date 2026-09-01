import Testing
@testable import Workbench

@Suite
struct ReviewNotificationLogicTests {
    private func finding(_ id: Int, posted: Bool = false) -> ReviewFinding {
        ReviewFinding(id: id, path: "src/a.ts", line: id, body: "remark", posted: posted)
    }

    @Test func aFinishedReviewWithSomethingToPostIsAnnounced() {
        let announce = ReviewNotificationLogic.toAnnounce(
            reviews: [1: PrReview(findings: [finding(7)], outdated: false, running: false)],
            alreadyAnnounced: []
        )

        #expect(announce == [1])
    }

    // Announcing the same review on every 15-second poll would be a notification
    // every 15 seconds until the user dealt with it.
    @Test func anAlreadyAnnouncedReviewIsNotAnnouncedAgain() {
        let announce = ReviewNotificationLogic.toAnnounce(
            reviews: [1: PrReview(findings: [finding(7)], outdated: false, running: false)],
            alreadyAnnounced: [1]
        )

        #expect(announce.isEmpty)
    }

    @Test func aReviewWithNothingToPostIsNotAnnounced() {
        let announce = ReviewNotificationLogic.toAnnounce(
            reviews: [1: PrReview(findings: [], outdated: false, running: false)],
            alreadyAnnounced: []
        )

        #expect(announce.isEmpty)
    }

    // Everything posted or discarded means the user has already dealt with it.
    @Test func aReviewWhoseRemarksAreAllPostedIsNotAnnounced() {
        let announce = ReviewNotificationLogic.toAnnounce(
            reviews: [1: PrReview(findings: [finding(7, posted: true)], outdated: false, running: false)],
            alreadyAnnounced: []
        )

        #expect(announce.isEmpty)
    }

    @Test func severalPullRequestsAreEachAnnouncedOnce() {
        let announce = ReviewNotificationLogic.toAnnounce(
            reviews: [
                1: PrReview(findings: [finding(7)], outdated: false, running: false),
                2: PrReview(findings: [finding(8)], outdated: false, running: false),
                3: PrReview(findings: [], outdated: false, running: false),
            ],
            alreadyAnnounced: [2]
        )

        #expect(announce == [1])
    }

    @Test func nothingToAnnounceWhenThereAreNoReviews() {
        #expect(ReviewNotificationLogic.toAnnounce(reviews: [:], alreadyAnnounced: []).isEmpty)
    }

    @Test func theMessageNamesThePullRequest() {
        let body = ReviewNotificationLogic.body(prTitle: "[ACV-38] Herbouw meldingsbalk", count: 3)

        #expect(body.contains("Herbouw meldingsbalk"))
        #expect(body.contains("3"))
    }

    @Test func theMessageIsSingularForOneRemark() {
        let body = ReviewNotificationLogic.body(prTitle: "t", count: 1)

        #expect(body.contains("1 comment"))
        #expect(body.contains("comments") == false)
    }
}
