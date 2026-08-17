enum AgentChatTarget: Equatable {
    case project(Project)
    case ticket(Ticket)
    case pullRequest(PullRequest)

    var projectId: Int {
        switch self {
        case .project(let project): project.id
        case .ticket(let ticket): ticket.projectId
        case .pullRequest(let pr): pr.projectId
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
                backToProjectName: nil
            )
        case .ticket(let ticket):
            let ref = WorkItemRef.ticket(ticket)
            return AgentChatSubject(
                kicker: "\(ref) · \(WorkItemStatusLabel.ticket(ticket.status))",
                title: ticket.title,
                placeholder: "Tell the agent what to do on \(ref)",
                quickPrompts: ["Draft a fix plan", "Reply for me", "Make this a task"],
                backToProjectName: project?.name
            )
        case .pullRequest(let pr):
            let ref = WorkItemRef.pullRequest(pr, project: project)
            return AgentChatSubject(
                kicker: "\(ref) · \(WorkItemStatusLabel.pullRequest(pr.status))",
                title: linkedTicket?.title ?? ref,
                placeholder: "Tell the agent what to do on \(ref)",
                quickPrompts: ["Summarise the review comments", "Reply for me", "Make this a task"],
                backToProjectName: project?.name
            )
        }
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
