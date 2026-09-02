import Foundation

/// One stored remark about a line of a pull request, waiting to be posted.
///
/// `id` comes from the engine now, unlike the first cut where findings only ever
/// lived in memory and needed a local UUID. It is what every per-finding action
/// addresses, so it has to be the engine's.
///
/// `body` is var because the user edits it in place before posting.
struct ReviewFinding: Codable, Identifiable, Equatable {
    let id: Int
    let path: String
    let line: Int
    var body: String
    let posted: Bool
}

/// A stored review as the engine reports it.
///
/// `outdated` means the branch has moved past the commit these were written
/// against. It is reported, never acted on: the remarks stay postable, because
/// whether they still apply is the user's call.
struct PrReview: Codable {
    let findings: [ReviewFinding]
    let outdated: Bool

    /// Whether the engine is working on this pull request right now. Cannot be
    /// inferred from the findings: a review still running and one that finished
    /// with nothing to say both come back as an empty list.
    ///
    /// Optional so a payload written before the engine sent it still decodes;
    /// Swift's synthesized `Decodable` ignores property defaults.
    let running: Bool?

    var isRunning: Bool { running ?? false }

    static let empty = PrReview(findings: [], outdated: false, running: false)
}
