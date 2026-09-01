import Foundation

/// The rules the review sheet follows, kept out of the view so they can be tested.
enum PrReviewLogic {
    /// Publishing is offered only when something would actually be posted. An
    /// empty publish is refused by the engine, so the button must not offer it.
    static func canPublish(findings: [ReviewFinding]) -> Bool {
        !findings.isEmpty
    }

    /// Counts what would be posted, never what the review produced. Showing the
    /// larger number would promise comments that were already thrown away.
    static func summary(findings: [ReviewFinding], discarded: [DiscardedFinding]) -> String {
        let comments = findings.count == 1 ? "1 comment" : "\(findings.count) comments"
        guard !discarded.isEmpty else { return comments }
        let dropped = discarded.count == 1 ? "1 was dropped" : "\(discarded.count) were dropped"
        return "\(comments) · \(dropped)"
    }

    /// Why there is nothing to publish, or nil when there is.
    ///
    /// The two cases read differently on purpose: a clean review is a result,
    /// while a review whose every remark was dropped is a sign the line numbers
    /// were wrong and worth reporting.
    static func emptyState(findings: [ReviewFinding], discarded: [DiscardedFinding]) -> String? {
        guard findings.isEmpty else { return nil }
        if discarded.isEmpty {
            return "The review found nothing worth commenting on."
        }
        return "Nothing can be posted: every remark pointed at a line that is not part of this pull request."
    }
}
