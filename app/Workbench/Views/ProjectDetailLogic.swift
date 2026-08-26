import SwiftUI

struct ProjectFacts: Equatable {
    let status: String
    let openTasks: Int
    let openPrs: Int
    let lastActivity: String
}

enum OpenWorkTarget: Equatable {
    case pullRequest(PullRequest)
    case ticket(Ticket)
}

struct OpenWorkItem: Identifiable, Equatable {
    let id: String
    let target: OpenWorkTarget
    let ref: String
    let title: String
    let symbol: String
}

enum ProjectDetailLogic {
    static let noTasksText = "No tasks for this project yet."
    static let noOpenWorkText = "Nothing open."
    static let notesPlaceholder = "Notes for this project. Saved as you type."

    /// "Overdue" or "Today" for a dated task, nil for one with no due date. This takes the
    /// tag slot on the shared row, the same way Today puts "Pinned" and "Jira" there.
    static func dueLabel(_ todo: Todo, today: String) -> String? {
        guard let dueAt = todo.dueAt else { return nil }
        if dueAt < today { return "Overdue" }
        if dueAt == today { return "Today" }
        return nil
    }

    /// Manual tasks and pinned Jira issues for this project. Overdue first, then the rest by
    /// creation, then anything completed today. A pinned issue routes through TodayLogic so it
    /// keeps the pseudo-task look and the unpin checkbox it already has on Today.
    static func taskRows(
        todos: [Todo],
        project: Project,
        projects: [Project],
        today: String
    ) -> [TodayTaskRow] {
        let mine = todos.filter { $0.projectId == project.id && ($0.source == .manual || $0.pinned) }
        let open = mine.filter { !$0.done }.sorted { left, right in
            let leftOverdue = dueLabel(left, today: today) == "Overdue"
            let rightOverdue = dueLabel(right, today: today) == "Overdue"
            if leftOverdue != rightOverdue { return leftOverdue }
            return left.createdAt < right.createdAt
        }
        let done = mine.filter(\.done).sorted { $0.createdAt < $1.createdAt }
        return (open + done).map { todo in
            if todo.pinned { return TodayLogic.pinnedRow(for: todo, projects: projects) }
            return row(for: todo, projects: projects, today: today)
        }
    }

    private static func row(for todo: Todo, projects: [Project], today: String) -> TodayTaskRow {
        TodayTaskRow(
            id: "todo-\(todo.id)",
            source: .todo(todo),
            title: todo.text,
            isDone: todo.done,
            projectName: TodayLogic.projectName(projectId: todo.projectId, projects: projects),
            projectDot: TodayLogic.projectDot(projectId: todo.projectId, projects: projects),
            ref: WorkItemRef.todo(todo),
            refSymbol: TodayLogic.issueSymbol,
            tag: todo.done ? nil : dueLabel(todo, today: today),
            priority: nil
        )
    }

    static func facts(
        project: Project,
        todos: [Todo],
        tickets: [Ticket],
        prs: [PullRequest],
        now: Date
    ) -> ProjectFacts {
        ProjectFacts(
            status: ProjectsLogic.statusLabel(project.status),
            openTasks: todos.filter { $0.projectId == project.id && ProjectsLogic.isOpenTask($0) }.count,
            openPrs: prs.filter { $0.projectId == project.id && $0.status != .merged }.count,
            lastActivity: ProjectsLogic.activityText(
                for: project, todos: todos, tickets: tickets, prs: prs, now: now
            )
        )
    }

    static func openWork(project: Project, tickets: [Ticket], prs: [PullRequest]) -> [OpenWorkItem] {
        let prItems = prs
            .filter { $0.projectId == project.id && $0.status != .merged }
            .map { pr in
                OpenWorkItem(
                    id: "pr-\(pr.id)",
                    target: .pullRequest(pr),
                    ref: WorkItemRef.pullRequest(pr, project: project),
                    title: pr.title.isEmpty ? WorkItemRef.pullRequest(pr, project: project) : pr.title,
                    symbol: TodayLogic.pullRequestSymbol
                )
            }
        let ticketItems = tickets
            .filter { $0.projectId == project.id && $0.status != .done }
            .map { ticket in
                OpenWorkItem(
                    id: "ticket-\(ticket.id)",
                    target: .ticket(ticket),
                    ref: WorkItemRef.ticket(ticket),
                    title: ticket.title.isEmpty ? WorkItemRef.ticket(ticket) : ticket.title,
                    symbol: TodayLogic.issueSymbol
                )
            }
        return prItems + ticketItems
    }
}
