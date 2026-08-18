enum PrConversationKind: String, Codable {
    case review
    case comment
}

struct PrDetailFile: Codable, Equatable, Identifiable {
    let path: String
    let status: String
    let additions: Int
    let deletions: Int
    /// Null when GitHub omitted the patch because the file is too large.
    let patch: String?

    var id: String { path }
}

struct PrReviewComment: Codable, Equatable, Identifiable {
    let id: Int
    let author: String
    let body: String
    let createdAt: String
}

struct PrReviewThread: Codable, Equatable, Identifiable {
    let path: String
    /// Null when the thread is outdated and no longer maps to a line in the diff.
    let line: Int?
    /// LEFT or RIGHT. A LEFT thread's line is a base-file number, so it must never
    /// be matched against the new-file numbers the diff rows carry.
    let diffSide: String
    let isResolved: Bool
    let isOutdated: Bool
    let comments: [PrReviewComment]

    var id: String { "\(path):\(line ?? -1):\(comments.first?.id ?? 0)" }
}

struct PrConversationItem: Codable, Equatable, Identifiable {
    let kind: PrConversationKind
    let author: String
    let body: String
    let createdAt: String
    let state: String?

    var id: String { "\(kind.rawValue):\(author):\(createdAt)" }
}

struct PrDetail: Codable, Equatable {
    let title: String
    let url: String
    let state: String
    let isDraft: Bool
    let reviewState: PrReviewState?
    let author: String
    let createdAt: String
    let baseRefName: String
    let headRefName: String
    let commitCount: Int
    let changedFiles: Int
    let additions: Int
    let deletions: Int
    let files: [PrDetailFile]
    let threads: [PrReviewThread]
    let conversation: [PrConversationItem]
}

struct ReviewReplyDraft: Codable, Equatable {
    let draft: String
}

struct PostedReviewComment: Codable, Equatable {
    let id: Int
}
