struct PollSummary: Codable, Equatable {
    let jiraTodos: Int
    let ticketsCreated: Int
    let prsSynced: Int
    /// One entry per source that failed. The engine only logs these to its own
    /// console, so this is the app's single window onto a stale Jira token.
    let sourceErrors: [String]
}
