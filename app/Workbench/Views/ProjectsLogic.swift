import SwiftUI

struct ProjectCard: Identifiable, Equatable {
    let id: Int
    let project: Project
    let name: String
    let dot: Color
    let statusLabel: String
    let blurb: String
    let openCount: Int
    let prCount: Int
    let activity: String
}

enum ProjectsLogic {
    static let emptyStateText = "No projects yet. Add one to get started."
    static let noActivityText = "no activity yet"

    private static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func statusLabel(_ status: ProjectStatus) -> String {
        switch status {
        case .active: "Active"
        case .paused: "Paused"
        case .planning: "Planning"
        }
    }

    static func prCountLabel(_ count: Int) -> String {
        "\(count) \(count == 1 ? "PR" : "PRs")"
    }

    static func activeCount(_ projects: [Project]) -> Int {
        projects.filter { $0.status == .active }.count
    }

    /// Cards keep the order of the projects array, because the dot colour is taken
    /// by index the same way the sidebar takes it, and the two must agree.
    static func cards(
        projects: [Project],
        todos: [Todo],
        tickets: [Ticket],
        prs: [PullRequest],
        now: Date
    ) -> [ProjectCard] {
        projects.enumerated().map { index, project in
            ProjectCard(
                id: project.id,
                project: project,
                name: project.name,
                dot: SidebarLogic.projectDotColor(at: index),
                statusLabel: statusLabel(project.status),
                blurb: project.blurb,
                openCount: todos.filter { $0.projectId == project.id && !$0.done }.count,
                prCount: prs.filter { $0.projectId == project.id && $0.status != .merged }.count,
                activity: activityText(
                    for: project,
                    todos: todos,
                    tickets: tickets,
                    prs: prs,
                    now: now
                )
            )
        }
    }

    /// Projects carry no timestamp of their own, so "updated" is the newest thing
    /// the project owns: a task, an issue or a pull request.
    private static func activityText(
        for project: Project,
        todos: [Todo],
        tickets: [Ticket],
        prs: [PullRequest],
        now: Date
    ) -> String {
        var stamps: [String] = []
        stamps += todos.filter { $0.projectId == project.id }.map(\.createdAt)
        stamps += tickets.filter { $0.projectId == project.id }.map(\.createdAt)
        stamps += prs.filter { $0.projectId == project.id }.map(\.createdAt)

        let dates = stamps.compactMap { timestampFormatter.date(from: $0) }
        guard let newest = dates.max() else { return noActivityText }
        return relativeTime(from: newest, to: now)
    }

    static func relativeTime(from date: Date, to now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        let minutes = Int(seconds / 60)
        let hours = minutes / 60
        let days = hours / 24

        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes)m ago" }
        if hours < 24 { return "\(hours)h ago" }
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days)d ago" }
        return "\(days / 7)w ago"
    }
}
