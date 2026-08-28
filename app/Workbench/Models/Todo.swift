enum TodoSource: String, Codable {
    case manual
    case jira
}

enum TodoPriority: String, Codable {
    case high, med, low
}

struct Todo: Codable, Identifiable, Equatable {
    let id: Int
    let source: TodoSource
    let sourceId: String?
    var text: String
    let body: String
    let url: String?
    let projectId: Int?
    let canPromote: Bool
    var done: Bool
    let promotedTicketId: Int?
    let createdAt: String
    var priority: TodoPriority = .med
    var dueAt: String?
    var doneAt: String?
    var pinned: Bool = false
    /// The Jira workflow status, exactly as Jira names it. Nil for a manual task, and
    /// nil for a mirrored issue stored before statuses were recorded.
    var statusName: String?
    /// One of `todo`, `in_progress` or `done`, as the engine normalises Atlassian's
    /// category keys. Deliberately a String rather than an enum: an unrecognised value
    /// would make a non-optional enum fail the whole decode, and this codebase has
    /// already been bitten by exactly that with an unknown PrChatAction case.
    var statusCategory: String?
}
