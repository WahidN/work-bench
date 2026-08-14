enum WorkItemRef {
    private static func stripping(_ prefix: String, from id: String) -> String {
        id.hasPrefix(prefix) ? String(id.dropFirst(prefix.count)) : id
    }

    /// "acme/atlas" -> "atlas". Nil for an unset or empty repo.
    static func repoShortName(from githubRepo: String?) -> String? {
        guard let githubRepo, !githubRepo.isEmpty else { return nil }
        let name = githubRepo.split(separator: "/").last.map(String.init) ?? githubRepo
        return name.isEmpty ? nil : name
    }

    /// The handle used in refs: the GitHub repo name when known, otherwise the
    /// first word of the project name, lowercased.
    static func projectSlug(_ project: Project) -> String {
        if let repo = repoShortName(from: project.githubRepo) { return repo }
        let firstWord = project.name.split(separator: " ").first.map(String.init) ?? project.name
        return firstWord.lowercased()
    }

    /// "atlas#1284". Falls back to the branch while GitHub has not assigned a number.
    static func pullRequest(_ pr: PullRequest, project: Project?) -> String {
        guard let number = pr.number else { return pr.branch }
        guard let project else { return "#\(number)" }
        return "\(projectSlug(project))#\(number)"
    }

    /// Strips the engine's source prefix: "JIRA-ATL-441" -> "ATL-441",
    /// "GH-acme/beacon#57" -> "beacon#57", "SENTRY-9912" -> "9912".
    static func ticket(_ ticket: Ticket) -> String {
        switch ticket.source {
        case .jira:
            return stripping("JIRA-", from: ticket.sourceId)
        case .sentry:
            return stripping("SENTRY-", from: ticket.sourceId)
        case .github:
            let withoutPrefix = stripping("GH-", from: ticket.sourceId)
            guard let lastSlash = withoutPrefix.lastIndex(of: "/") else { return withoutPrefix }
            return String(withoutPrefix[withoutPrefix.index(after: lastSlash)...])
        }
    }

    /// "JIRA-ATL-441" -> "ATL-441". Nil for a manual task, which has no source reference.
    static func todo(_ todo: Todo) -> String? {
        guard todo.source == .jira, let sourceId = todo.sourceId else { return nil }
        return stripping("JIRA-", from: sourceId)
    }
}

enum WorkItemStatusLabel {
    /// Phase 6 replaces this with the real GitHub review state once the engine
    /// syncs it. Until then the local pipeline status stands in for it.
    static func pullRequest(_ status: PrStatus) -> String {
        switch status {
        case .open: "Needs review"
        case .needsAttention: "Changes requested"
        case .merged: "Merged"
        }
    }

    static func ticket(_ status: TicketStatus) -> String {
        switch status {
        case .new: "To do"
        case .sparring: "In progress"
        case .inReview: "In review"
        case .done: "Done"
        case .needsAttention: "Blocked"
        }
    }
}
