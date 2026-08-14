import SwiftUI

enum TodayTaskSource: Equatable {
    case todo(Todo)
    case pinnedTodo(Todo)
    case pinnedTicket(Ticket)
    case pinnedPullRequest(PullRequest)
}

struct TodayTaskRow: Identifiable, Equatable {
    let id: String
    let source: TodayTaskSource
    let title: String
    let isDone: Bool
    let projectName: String
    let projectDot: Color
    let ref: String?
    let refSymbol: String
    let tag: String?
    let priority: TodoPriority?
}

struct TodaySection: Identifiable, Equatable {
    let label: String
    let color: Color
    let rows: [TodayTaskRow]

    var id: String { label }
    var count: Int { rows.count }
}

enum TodayRailTarget: Equatable {
    case ticket(Ticket)
    case pullRequest(PullRequest)
}

struct TodayRailItem: Identifiable, Equatable {
    let id: String
    let target: TodayRailTarget
    let title: String
    let meta: String
    let symbol: String
    let symbolColor: Color
    let isPinned: Bool
}

enum TodayLogic {
    static let issueSymbol = "list.bullet.rectangle"
    static let pullRequestSymbol = "arrow.triangle.pull"
    static let pinnedTag = "Pinned"
    static let jiraTag = "Jira"
    static let noProjectName = "No project"

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// The local calendar date, matching the engine's `localDate`.
    static func dayString(for date: Date) -> String {
        dayFormatter.string(from: date)
    }

    // MARK: - Sections

    static func sections(
        todos: [Todo],
        pinnedTickets: [Ticket],
        pinnedPullRequests: [PullRequest],
        tickets: [Ticket],
        projects: [Project],
        today: String
    ) -> [TodaySection] {
        let pinnedTodoRows = todos.filter(\.pinned).map { pinnedRow(for: $0, projects: projects) }
        let unpinned = todos.filter { !$0.pinned }
        let open = unpinned.filter { !$0.done }
        let overdue = open.filter { isOverdue($0, today: today) }.map { row(for: $0, projects: projects) }
        let dueToday = open.filter { !isOverdue($0, today: today) }.map { row(for: $0, projects: projects) }
        let done = unpinned.filter(\.done).map { row(for: $0, projects: projects) }
        let pinned = pinnedTodoRows
            + pinnedTickets.map { row(for: $0, projects: projects) }
            + pinnedPullRequests.map { row(for: $0, tickets: tickets, projects: projects) }

        var sections: [TodaySection] = []
        if !overdue.isEmpty {
            sections.append(TodaySection(label: "Overdue", color: Theme.Accent.a300, rows: overdue))
        }
        sections.append(TodaySection(label: "Today", color: Theme.Neutral.n500, rows: pinned + dueToday))
        if !done.isEmpty {
            sections.append(TodaySection(label: "Done", color: Theme.Neutral.n700, rows: done))
        }
        return sections
    }

    static func isOverdue(_ todo: Todo, today: String) -> Bool {
        guard let dueAt = todo.dueAt else { return false }
        return dueAt < today
    }

    static func row(for todo: Todo, projects: [Project]) -> TodayTaskRow {
        TodayTaskRow(
            id: "todo-\(todo.id)",
            source: .todo(todo),
            title: todo.text,
            isDone: todo.done,
            projectName: projectName(projectId: todo.projectId, projects: projects),
            projectDot: projectDot(projectId: todo.projectId, projects: projects),
            ref: WorkItemRef.todo(todo),
            refSymbol: issueSymbol,
            tag: todo.source == .jira ? jiraTag : nil,
            priority: todo.done ? nil : todo.priority
        )
    }

    /// A pinned todo, pulled onto Today from the Jira screen, renders like a pinned
    /// ticket or PR: accent dot, its ref as the link, tag "Pinned", no priority. Its
    /// checkbox unpins rather than completing, which the view routes on the source.
    static func pinnedRow(for todo: Todo, projects: [Project]) -> TodayTaskRow {
        TodayTaskRow(
            id: "todo-\(todo.id)",
            source: .pinnedTodo(todo),
            title: todo.text,
            isDone: false,
            projectName: projectName(projectId: todo.projectId, projects: projects),
            projectDot: Theme.nocturneAccent,
            ref: WorkItemRef.todo(todo),
            refSymbol: issueSymbol,
            tag: pinnedTag,
            priority: nil
        )
    }

    /// A pinned issue rendered as a pseudo-task: accent dot, its ref as the link, tag "Pinned".
    static func row(for ticket: Ticket, projects: [Project]) -> TodayTaskRow {
        TodayTaskRow(
            id: "ticket-\(ticket.id)",
            source: .pinnedTicket(ticket),
            title: ticket.title,
            isDone: false,
            projectName: projectName(projectId: ticket.projectId, projects: projects),
            projectDot: Theme.nocturneAccent,
            ref: WorkItemRef.ticket(ticket),
            refSymbol: issueSymbol,
            tag: pinnedTag,
            priority: nil
        )
    }

    static func row(for pr: PullRequest, tickets: [Ticket], projects: [Project]) -> TodayTaskRow {
        let project = projects.first { $0.id == pr.projectId }
        let ref = WorkItemRef.pullRequest(pr, project: project)
        return TodayTaskRow(
            id: "pr-\(pr.id)",
            source: .pinnedPullRequest(pr),
            title: linkedTitle(for: pr, tickets: tickets, fallback: ref),
            isDone: false,
            projectName: projectName(projectId: pr.projectId, projects: projects),
            projectDot: Theme.nocturneAccent,
            ref: ref,
            refSymbol: pullRequestSymbol,
            tag: pinnedTag,
            priority: nil
        )
    }

    // MARK: - Right rail

    static func issueRail(tickets: [Ticket], projects: [Project], limit: Int = 3) -> [TodayRailItem] {
        tickets
            .filter { $0.status != .done }
            .sorted(by: byAttentionThenNewest)
            .prefix(limit)
            .map { ticket in
                TodayRailItem(
                    id: "ticket-\(ticket.id)",
                    target: .ticket(ticket),
                    title: ticket.title,
                    meta: "\(WorkItemRef.ticket(ticket)) · \(WorkItemStatusLabel.ticket(ticket.status))",
                    symbol: issueSymbol,
                    symbolColor: statusColor(ticket.status),
                    isPinned: ticket.pinned
                )
            }
    }

    static func pullRequestRail(
        prs: [PullRequest],
        tickets: [Ticket],
        projects: [Project],
        limit: Int = 3
    ) -> [TodayRailItem] {
        prs
            .filter { $0.status != .merged }
            .sorted(by: byAttentionThenNewest)
            .prefix(limit)
            .map { pr in
                let ref = WorkItemRef.pullRequest(pr, project: projects.first { $0.id == pr.projectId })
                return TodayRailItem(
                    id: "pr-\(pr.id)",
                    target: .pullRequest(pr),
                    title: linkedTitle(for: pr, tickets: tickets, fallback: ref),
                    meta: "\(ref) · \(WorkItemStatusLabel.pullRequest(pr.status))",
                    symbol: pullRequestSymbol,
                    symbolColor: statusColor(pr.status),
                    isPinned: pr.pinned
                )
            }
    }

    static func statusColor(_ status: TicketStatus) -> Color {
        switch status {
        case .new: Theme.Status.needsReview
        case .sparring: Theme.Status.changesRequested
        case .inReview, .done: Theme.Status.approved
        case .needsAttention: Theme.Status.blocked
        }
    }

    static func statusColor(_ status: PrStatus) -> Color {
        switch status {
        case .open: Theme.Status.needsReview
        case .needsAttention: Theme.Status.changesRequested
        case .merged: Theme.Status.approved
        }
    }

    // MARK: - Priority

    static func priorityLabel(_ priority: TodoPriority) -> String {
        switch priority {
        case .high: "HIGH"
        case .med: "MED"
        case .low: "LOW"
        }
    }

    static func priorityColor(_ priority: TodoPriority) -> Color {
        switch priority {
        case .high: Theme.Accent.a300
        case .med: Theme.Neutral.n500
        case .low: Theme.Neutral.n700
        }
    }

    static func nextPriority(after priority: TodoPriority) -> TodoPriority {
        switch priority {
        case .high: .med
        case .med: .low
        case .low: .high
        }
    }

    // MARK: - Shared helpers

    static func projectName(projectId: Int?, projects: [Project]) -> String {
        guard let projectId, let project = projects.first(where: { $0.id == projectId }) else { return noProjectName }
        return project.name
    }

    static func projectDot(projectId: Int?, projects: [Project]) -> Color {
        guard let projectId, let index = projects.firstIndex(where: { $0.id == projectId }) else {
            return Theme.Neutral.n700
        }
        return SidebarLogic.projectDotColor(at: index)
    }

    /// A PR carries no title of its own; the issue it was created from supplies it.
    private static func linkedTitle(for pr: PullRequest, tickets: [Ticket], fallback: String) -> String {
        tickets.first { $0.id == pr.ticketId }?.title ?? fallback
    }

    private static func byAttentionThenNewest(_ left: Ticket, _ right: Ticket) -> Bool {
        let leftRank = left.status == .needsAttention ? 0 : 1
        let rightRank = right.status == .needsAttention ? 0 : 1
        if leftRank != rightRank { return leftRank < rightRank }
        return left.createdAt > right.createdAt
    }

    private static func byAttentionThenNewest(_ left: PullRequest, _ right: PullRequest) -> Bool {
        let leftRank = left.status == .needsAttention ? 0 : 1
        let rightRank = right.status == .needsAttention ? 0 : 1
        if leftRank != rightRank { return leftRank < rightRank }
        return left.createdAt > right.createdAt
    }
}
