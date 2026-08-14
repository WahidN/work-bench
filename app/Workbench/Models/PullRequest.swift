enum PrStatus: String, Codable {
    case open
    case needsAttention = "needs_attention"
    case merged
}

struct PullRequestMessage: Codable, Identifiable, Equatable {
    let id: Int
    let prId: Int
    let role: ChatRole
    let content: String
    let createdAt: String
}

struct PullRequest: Codable, Identifiable, Equatable {
    let id: Int
    let ticketId: Int
    let projectId: Int
    let branch: String
    let number: Int?
    let url: String?
    var status: PrStatus
    var lastReviewScore: Double?
    let createdAt: String
    var messages: [PullRequestMessage]?
    var pinned: Bool = false
}
