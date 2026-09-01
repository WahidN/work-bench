import Foundation

/// A remark about one line of a pull request, on its way to being posted there.
///
/// `id` is local and not decoded: the engine sends no identifier, and the sheet
/// needs something stable to key rows and edits off while the user works.
struct ReviewFinding: Codable, Identifiable, Equatable {
    let id: UUID
    let path: String
    let line: Int
    var body: String

    init(path: String, line: Int, body: String) {
        self.id = UUID()
        self.path = path
        self.line = line
        self.body = body
    }

    private enum CodingKeys: String, CodingKey { case path, line, body }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = UUID()
        self.path = try container.decode(String.self, forKey: .path)
        self.line = try container.decode(Int.self, forKey: .line)
        self.body = try container.decode(String.self, forKey: .body)
    }
}

/// A finding the engine refused to post, with the reason. Shown alongside the
/// publishable ones so a trimmed review is visible rather than silent.
struct DiscardedFinding: Codable, Identifiable, Equatable {
    var id: String { "\(path):\(line)" }
    let path: String
    let line: Int
    let body: String
    let reason: String
}

/// A finding that reached GitHub and was rejected there.
struct FailedFinding: Codable, Equatable {
    let path: String
    let line: Int
    let body: String
    let error: String
}

struct PrReviewResult: Codable {
    let findings: [ReviewFinding]
    let discarded: [DiscardedFinding]
    let commitSha: String
}

struct PublishReviewResult: Codable {
    let posted: [ReviewFinding]
    let failed: [FailedFinding]
}
