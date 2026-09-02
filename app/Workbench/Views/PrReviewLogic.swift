import Foundation

/// The rules the review section follows, kept out of the view so they can be tested.
enum PrReviewLogic {
    /// A remark already on GitHub is not offered again. Posting it twice would
    /// duplicate the comment, and the engine refuses it anyway.
    static func canPost(_ finding: ReviewFinding) -> Bool {
        !finding.posted
    }

    static func unposted(_ findings: [ReviewFinding]) -> [ReviewFinding] {
        findings.filter { !$0.posted }
    }

    /// Nothing left to act on. Distinct from "no review": a review every remark of
    /// which has been posted is finished, not absent.
    static func isDone(findings: [ReviewFinding]) -> Bool {
        unposted(findings).isEmpty
    }

    /// Counts what is still to post, never the total the review produced, which
    /// would keep promising work already finished.
    static func summary(findings: [ReviewFinding]) -> String {
        let left = unposted(findings).count
        return left == 1 ? "1 comment to post" : "\(left) comments to post"
    }

    /// Says the branch moved on. Reporting only: the remarks stay postable,
    /// because whether they still apply is the user's call.
    static func outdatedLabel(outdated: Bool) -> String? {
        guard outdated else { return nil }
        return "Written against an earlier commit"
    }
}
