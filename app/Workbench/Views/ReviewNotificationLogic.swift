import Foundation

/// Which finished reviews are worth interrupting the user about.
///
/// Deliberately not routed through `needsInput`, which the engine filters
/// review-requested pull requests out of on purpose: a colleague's pull request
/// arriving is not worth a notification. This is the opposite case, work the user
/// started themselves finishing, so it gets its own signal rather than widening
/// that list and dragging those pull requests back into the badge.
enum ReviewNotificationLogic {
    /// Pull requests whose review has something left to post and has not been
    /// announced yet. Sorted so the order is stable rather than dictionary order.
    static func toAnnounce(reviews: [Int: PrReview], alreadyAnnounced: Set<Int>) -> [Int] {
        reviews
            .filter { !alreadyAnnounced.contains($0.key) && !PrReviewLogic.isDone(findings: $0.value.findings) }
            .keys
            .sorted()
    }

    static func title() -> String {
        "Review ready"
    }

    static func body(prTitle: String, count: Int) -> String {
        let comments = count == 1 ? "1 comment" : "\(count) comments"
        return "\(comments) to post on \(prTitle)"
    }
}
