enum AgentChatTarget: Equatable {
    case project(Project)
    case ticket(Ticket)
    case pullRequest(PullRequest)
    case todo(Todo)

    /// Nil for a mirrored Jira issue whose project key maps to no project. Most
    /// issues in a real database are in that state, so callers must handle it.
    var projectId: Int? {
        switch self {
        case .project(let project): project.id
        case .ticket(let ticket): ticket.projectId
        case .pullRequest(let pr): pr.projectId
        case .todo(let todo): todo.projectId
        }
    }

    var isItem: Bool {
        if case .project = self { return false }
        return true
    }
}

struct AgentChatSubject: Equatable {
    let kicker: String
    let title: String
    let placeholder: String
    let quickPrompts: [String]
    let backToProjectName: String?
    /// One line shown above the transcript when the thread is working under a
    /// limitation the user should know about. Nil for every target but an
    /// unmapped Jira issue.
    let note: String?
}

enum AgentChatLogic {
    static func subject(
        for target: AgentChatTarget,
        project: Project?,
        linkedTicket: Ticket?
    ) -> AgentChatSubject {
        switch target {
        case .project(let project):
            return AgentChatSubject(
                kicker: "Project · \(project.name)",
                title: project.name,
                placeholder: "Ask about \(project.name)",
                quickPrompts: ["What should I do first?", "Catch me up", "Draft standup"],
                backToProjectName: nil,
                note: nil
            )
        case .ticket(let ticket):
            let ref = WorkItemRef.ticket(ticket)
            return AgentChatSubject(
                kicker: "\(ref) · \(WorkItemStatusLabel.ticket(ticket.status))",
                title: ticket.title,
                placeholder: "Tell the agent what to do on \(ref)",
                quickPrompts: ["Draft a fix plan", "Reply for me", "Make this a task"],
                backToProjectName: project?.name,
                note: nil
            )
        case .pullRequest(let pr):
            let ref = WorkItemRef.pullRequest(pr, project: project)
            return AgentChatSubject(
                kicker: "\(ref) · \(WorkItemStatusLabel.pullRequest(pr.status))",
                title: linkedTicket?.title ?? ref,
                placeholder: "Tell the agent what to do on \(ref)",
                quickPrompts: ["Summarise the review comments", "Reply for me", "Make this a task"],
                backToProjectName: project?.name,
                note: nil
            )
        case .todo(let todo):
            let ref = WorkItemRef.todo(todo)
            return AgentChatSubject(
                kicker: ref.map { "\($0) · Jira" } ?? "Jira",
                title: todo.text,
                placeholder: "Tell the agent what to do on \(ref ?? "this issue")",
                quickPrompts: ["What is this about?", "Draft a plan", "Is this worth doing?"],
                backToProjectName: project?.name,
                note: todo.projectId == nil ? "No repo mapped, discussing the issue text only." : nil
            )
        }
    }

    /// A promoted issue's thread lives on the ticket it became, so the row opens the
    /// ticket chat once that ticket is known. A promoted issue whose ticket has not
    /// loaded falls back to its own thread rather than dropping the click: the thread
    /// reads back empty and a send is refused with an error, which beats a dead button.
    static func target(for todo: Todo, tickets: [Ticket]) -> AgentChatTarget {
        if let id = todo.promotedTicketId, let ticket = tickets.first(where: { $0.id == id }) {
            return .ticket(ticket)
        }
        return .todo(todo)
    }

    /// Merging squashes and deletes the branch, which cannot be undone, so it is
    /// only offered on a pull request the user wrote. The inbox is full of other
    /// people's pull requests, and the default pill even leads with them.
    static func canMerge(_ target: AgentChatTarget?) -> Bool {
        guard case .pullRequest(let pr) = target else { return false }
        return pr.status != .merged && pr.authoredByMe
    }

    static func authorLabel(for role: ChatRole) -> String {
        role == .user ? "YOU" : "AGENT"
    }
}
