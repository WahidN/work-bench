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
    let showsPin: Bool
    let url: String?
}

struct JiraStatusGroup: Identifiable, Equatable {
    /// The status name, or a sentinel for the issues whose status is not known.
    let id: String
    let label: String
    let count: Int
    let rows: [JiraRow]
}

enum JiraLogic {
    static let emptyStateText = "No Jira issues in this project."
    static let unknownStatusLabel = "Status not known yet"

    /// Category order: active work first, then waiting, then finished, then anything
    /// this code does not recognise. An unrecognised category sorts last rather than
    /// being guessed into a bucket, because filing closed work as active is worse than
    /// filing it at the bottom.
    private static func categoryRank(_ category: String?) -> Int {
        switch category {
        case "in_progress": 0
        case "todo": 1
        case "done": 2
        default: 3
        }
    }

    /// Splits one project's rows into a group per distinct status name. Every row comes
    /// out exactly once: an issue with no status lands in a single trailing group rather
    /// than being dropped, which matters because every issue mirrored before statuses
    /// were recorded has none until the next poll.
    static func statusGroups(rows: [JiraRow]) -> [JiraStatusGroup] {
        guard !rows.isEmpty else { return [] }

        // Keyed by status name so two issues in "Blocked" share a group. Nil name is
        // its own key, and its category is nil too, so it ranks last.
        var buckets: [String: [JiraRow]] = [:]
        for row in rows {
            buckets[row.todo.statusName ?? unknownStatusLabel, default: []].append(row)
        }

        return buckets
            .map { name, grouped in
                JiraStatusGroup(
                    id: name,
                    label: name,
                    count: grouped.count,
                    rows: grouped
                )
            }
            .sorted { left, right in
                let leftRank = categoryRank(left.rows.first?.todo.statusCategory)
                let rightRank = categoryRank(right.rows.first?.todo.statusCategory)
                if leftRank != rightRank { return leftRank < rightRank }
                if left.count != right.count { return left.count > right.count }
                return left.label < right.label
            }
    }

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
                    showsPin: todo.promotedTicketId == nil,
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
