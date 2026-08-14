import SwiftUI

struct JiraProjectGroup: Identifiable, Equatable {
    let key: String
    let displayName: String
    let dot: Color
    let openCount: Int

    var id: String { key }
}

struct JiraRow: Identifiable, Equatable {
    let id: Int
    let todo: Todo
    let title: String
    let ref: String
    let stateLabel: String?
    let stateColor: Color?
    let showsPromote: Bool
    let showsCreatePr: Bool
    let ticketId: Int?
    let isPinned: Bool
    let url: String?
}

enum JiraLogic {
    static let emptyStateText = "No Jira issues in this project."

    /// "JIRA-MR-123" becomes "MR". Nil for a manual task, or a reference without a
    /// project prefix, so callers can skip anything that is not a mirrored issue.
    static func projectKey(for todo: Todo) -> String? {
        guard let ref = WorkItemRef.todo(todo), let dash = ref.firstIndex(of: "-") else { return nil }
        let key = String(ref[ref.startIndex..<dash])
        return key.isEmpty ? nil : key
    }

    static func groups(todos: [Todo], projects: [Project]) -> [JiraProjectGroup] {
        var counts: [String: Int] = [:]
        for todo in todos {
            guard let key = projectKey(for: todo) else { continue }
            // Every mirrored issue makes a group, but only work not yet started counts.
            counts[key, default: 0] += todo.promotedTicketId == nil ? 1 : 0
        }
        return counts.keys
            .sorted { left, right in
                let leftCount = counts[left] ?? 0
                let rightCount = counts[right] ?? 0
                if leftCount != rightCount { return leftCount > rightCount }
                return left < right
            }
            .map { key in
                let index = projects.firstIndex { $0.jiraProjectKey == key }
                return JiraProjectGroup(
                    key: key,
                    displayName: index.map { projects[$0].name } ?? key,
                    dot: index.map { SidebarLogic.projectDotColor(at: $0) } ?? Theme.Neutral.n700,
                    openCount: counts[key] ?? 0
                )
            }
    }

    static func initialSelection(todos: [Todo]) -> String? {
        groups(todos: todos, projects: []).first?.key
    }

    static func rows(todos: [Todo], key: String, tickets: [Ticket]) -> [JiraRow] {
        todos
            .filter { projectKey(for: $0) == key }
            .sorted { left, right in
                let leftNumber = issueNumber(for: left) ?? -1
                let rightNumber = issueNumber(for: right) ?? -1
                if leftNumber != rightNumber { return leftNumber > rightNumber }
                return (WorkItemRef.todo(left) ?? "") < (WorkItemRef.todo(right) ?? "")
            }
            .map { todo in
                let ticket = todo.promotedTicketId.flatMap { id in tickets.first { $0.id == id } }
                return JiraRow(
                    id: todo.id,
                    todo: todo,
                    title: todo.text,
                    ref: WorkItemRef.todo(todo) ?? "",
                    stateLabel: ticket.map { WorkItemStatusLabel.ticket($0.status) },
                    stateColor: ticket.map { TodayLogic.statusColor($0.status) },
                    showsPromote: todo.canPromote && todo.promotedTicketId == nil,
                    showsCreatePr: canCreatePr(ticket),
                    ticketId: ticket?.id,
                    isPinned: todo.pinned,
                    url: (todo.url?.isEmpty ?? true) ? nil : todo.url
                )
            }
    }

    /// The trailing digits of a reference: "MR-123" gives 123, so a project's
    /// newest issues lead instead of sorting "MR-12" before "MR-2".
    private static func issueNumber(for todo: Todo) -> Int? {
        guard let ref = WorkItemRef.todo(todo), let dash = ref.lastIndex(of: "-") else { return nil }
        return Int(ref[ref.index(after: dash)...])
    }

    /// A PR can be created once an issue has been analysed and has no PR yet. The
    /// engine rejects the rest with a 409, so do not offer the action then.
    private static func canCreatePr(_ ticket: Ticket?) -> Bool {
        guard let ticket else { return false }
        return ticket.prId == nil && (ticket.status == .new || ticket.status == .sparring)
    }
}
