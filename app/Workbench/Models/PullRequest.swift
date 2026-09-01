enum PrStatus: String, Codable {
    case open
    case needsAttention = "needs_attention"
    case merged
}

enum PrReviewState: String, Codable {
    case approved
    case changesRequested = "changes_requested"
    case reviewRequired = "review_required"
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
    let ticketId: Int?
    let projectId: Int
    let branch: String
    let number: Int?
    let url: String?
    var status: PrStatus
    var lastReviewScore: Double?
    let createdAt: String
    var messages: [PullRequestMessage]?
    var pinned: Bool = false
    var title: String
    var reviewState: PrReviewState?
    var isDraft: Bool
    var githubUpdatedAt: String?
    var authoredByMe: Bool
    var assignedToMe: Bool
    var reviewRequestedByMe: Bool?
    var messageCount: Int
}
