enum TicketSource: String, Codable {
    case sentry, github, jira
}

enum TicketStatus: String, Codable {
    case new
    case sparring
    case inReview = "in_review"
    case done
    case needsAttention = "needs_attention"
}

enum AnalysisConfidence: String, Codable {
    case low, medium, high
}

struct Analysis: Codable, Equatable {
    let summary: String
    let rootCause: String
    let proposedFix: String
    let affectedFiles: [String]
    let confidence: AnalysisConfidence
}

enum ChatRole: String, Codable {
    case user, assistant
}

struct TicketMessage: Codable, Identifiable, Equatable {
    let id: Int
    let ticketId: Int
    let role: ChatRole
    let content: String
    let createdAt: String
}

struct Ticket: Codable, Identifiable, Equatable {
    let id: Int
    let source: TicketSource
    let sourceId: String
    let projectId: Int
    let title: String
    let body: String
    let url: String
    let analysis: Analysis?
    var status: TicketStatus
    var prId: Int?
    let createdAt: String
    var messages: [TicketMessage]?
}
