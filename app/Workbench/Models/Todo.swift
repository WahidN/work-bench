enum TodoSource: String, Codable {
    case manual
    case jira
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
}
