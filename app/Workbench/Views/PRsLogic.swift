import Foundation

enum PrFilter: String, CaseIterable, Identifiable {
    case assignedToMe
    case needsReview
    case mine

    var id: String { rawValue }
}

struct PrRow: Identifiable, Equatable {
    let id: Int
    let pr: PullRequest
    let title: String
    let ref: String
    let projectName: String
    let statusLabel: String
    let updatedText: String
    let pinned: Bool
    let messageCount: Int
}

enum PRsLogic {
    static let emptyStateText = "Nothing here. Pull requests you open, get assigned, or are asked to review show up automatically."

    private static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func label(_ filter: PrFilter) -> String {
        switch filter {
        case .assignedToMe: "Assigned to me"
        case .needsReview: "Needs review"
        case .mine: "Mine"
        }
    }

    /// A draft is a draft whatever the reviewers said, so it wins.
    static func statusLabel(_ pr: PullRequest) -> String {
        if pr.isDraft { return "Draft" }
        switch pr.reviewState {
        case .approved: return "Approved"
        case .changesRequested: return "Changes requested"
        case .reviewRequired, .none: return "Needs review"
        }
    }

    /// The row shows the bare repository name, so "acv-website#24" rather than
    /// the owner-qualified slug the project stores.
    static func repoName(from githubRepo: String) -> String {
        let trimmed = githubRepo.hasSuffix("/") ? String(githubRepo.dropLast()) : githubRepo
        return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
    }

    /// Combines the bare repo name and the PR number into "acv-website#24".
    /// Either half can be missing: no number drops the "#24", no repo drops
    /// the repo name, and both missing gives back an empty string.
    static func ref(for pr: PullRequest, githubRepo: String?) -> String {
        let repo = githubRepo.map(repoName(from:)) ?? ""
        return pr.number.map { "\(repo)#\($0)" } ?? repo
    }

    static func rows(prs: [PullRequest], projects: [Project], filter: PrFilter, now: Date) -> [PrRow] {
        prs.filter { keep($0, filter) }.map { pr in
            let project = projects.first { $0.id == pr.projectId }
            return PrRow(
                id: pr.id,
                pr: pr,
                title: pr.title,
                ref: ref(for: pr, githubRepo: project?.githubRepo),
                projectName: project?.name ?? "",
                statusLabel: statusLabel(pr),
                updatedText: updatedText(pr, now: now),
                pinned: pr.pinned,
                messageCount: pr.messageCount
            )
        }
    }

    private static func keep(_ pr: PullRequest, _ filter: PrFilter) -> Bool {
        switch filter {
        case .assignedToMe: pr.assignedToMe
        case .mine: pr.authoredByMe
        // Whether GitHub asks this user for a review, not what the pull request's
        // overall review decision is. statusLabel still reports the latter, so a row
        // here can read "Approved" when a colleague approved it and this request stands.
        // Nil is a payload from an engine that predates the field: not my review.
        case .needsReview: pr.reviewRequestedByMe == true
        }
    }

    private static func updatedText(_ pr: PullRequest, now: Date) -> String {
        guard let stamp = pr.githubUpdatedAt, let date = timestampFormatter.date(from: stamp) else { return "" }
        return ProjectsLogic.relativeTime(from: date, to: now)
    }
}
