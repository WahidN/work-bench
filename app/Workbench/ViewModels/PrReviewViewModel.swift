import Foundation

protocol PrReviewAPI {
    func reviewPr(id: Int) async throws -> PrReviewResult
    func publishReview(id: Int, findings: [ReviewFinding]) async throws -> PublishReviewResult
}

extension APIClient: PrReviewAPI {}

/// Holds one pull request's review while the user reads it.
///
/// Nothing here is persisted. A review is run, read, published or thrown away,
/// which is why a failed publish has to keep what failed: there is nowhere else
/// for those remarks to survive.
@MainActor
final class PrReviewViewModel: ObservableObject {
    @Published private(set) var findings: [ReviewFinding] = []
    @Published private(set) var discarded: [DiscardedFinding] = []
    @Published private(set) var isReviewing = false
    @Published private(set) var isPublishing = false
    @Published private(set) var didPublish = false
    @Published var errorMessage: String?

    private let api: any PrReviewAPI

    init(api: any PrReviewAPI = APIClient()) {
        self.api = api
    }

    func review(prId: Int) async {
        isReviewing = true
        errorMessage = nil
        didPublish = false
        defer { isReviewing = false }

        do {
            let result = try await api.reviewPr(id: prId)
            findings = result.findings
            discarded = result.discarded
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? String(describing: error)
            findings = []
            discarded = []
        }
    }

    func edit(findingAt index: Int, body: String) {
        guard findings.indices.contains(index) else { return }
        findings[index].body = body
    }

    func discard(findingAt index: Int) {
        guard findings.indices.contains(index) else { return }
        findings.remove(at: index)
    }

    /// Posts what is left. On a partial failure the posted ones are dropped and
    /// the failed ones stay, so what remains on screen is exactly what still has
    /// not reached the pull request.
    func publish(prId: Int) async {
        guard PrReviewLogic.canPublish(findings: findings) else { return }
        isPublishing = true
        errorMessage = nil
        defer { isPublishing = false }

        do {
            let result = try await api.publishReview(id: prId, findings: findings)
            guard result.failed.isEmpty else {
                let failedLines = Set(result.failed.map(\.line))
                findings = findings.filter { failedLines.contains($0.line) }
                errorMessage = result.failed
                    .map { "\($0.path):\($0.line) — \($0.error)" }
                    .joined(separator: "\n")
                return
            }
            findings = []
            discarded = []
            didPublish = true
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? String(describing: error)
        }
    }

    func reset() {
        findings = []
        discarded = []
        errorMessage = nil
        didPublish = false
    }
}
