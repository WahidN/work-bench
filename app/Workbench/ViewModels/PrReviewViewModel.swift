import Foundation

protocol PrReviewAPI {
    func startReview(prId: Int) async throws
    func review(prId: Int) async throws -> PrReview
    func postReviewFinding(prId: Int, findingId: Int, body: String) async throws
    func discardReviewFinding(prId: Int, findingId: Int) async throws
}

extension APIClient: PrReviewAPI {}

/// One pull request's stored review, while the user works through it.
///
/// Unlike the first cut, this holds nothing the engine does not: the findings are
/// on disk, and every action here is a call that changes them there. What is local
/// is the in-progress edit and the per-finding error, neither of which should
/// outlive the screen.
@MainActor
final class PrReviewViewModel: ObservableObject {
    @Published private(set) var findings: [ReviewFinding] = []
    @Published private(set) var outdated = false
    @Published private(set) var isStarting = false
    @Published private(set) var isLoading = false
    @Published private(set) var postingIds: Set<Int> = []
    @Published var errorMessage: String?

    /// Errors belong to the remark that failed, not to the screen: one bad anchor
    /// says nothing about the other five.
    @Published private(set) var findingErrors: [Int: String] = [:]

    private let api: any PrReviewAPI

    init(api: any PrReviewAPI = APIClient()) {
        self.api = api
    }

    func error(forFinding id: Int) -> String? {
        findingErrors[id]
    }

    /// Starts a review. Returns as soon as the engine has taken it; the findings
    /// arrive later, through `load`, after the notification.
    func start(prId: Int) async {
        isStarting = true
        errorMessage = nil
        defer { isStarting = false }

        do {
            try await api.startReview(prId: prId)
        } catch {
            errorMessage = message(from: error)
        }
    }

    func load(prId: Int) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let review = try await api.review(prId: prId)
            findings = review.findings
            outdated = review.outdated
        } catch {
            errorMessage = message(from: error)
        }
    }

    func edit(findingId: Int, body: String) {
        guard let index = findings.firstIndex(where: { $0.id == findingId }) else { return }
        findings[index].body = body
    }

    func post(prId: Int, findingId: Int) async {
        guard let index = findings.firstIndex(where: { $0.id == findingId }) else { return }
        let finding = findings[index]
        guard PrReviewLogic.canPost(finding) else { return }

        postingIds.insert(findingId)
        findingErrors[findingId] = nil
        defer { postingIds.remove(findingId) }

        do {
            try await api.postReviewFinding(prId: prId, findingId: findingId, body: finding.body)
            // Rebuilt rather than mutated in place because `posted` is a let: the
            // engine owns it, and this mirrors what it just recorded.
            findings[index] = ReviewFinding(
                id: finding.id, path: finding.path, line: finding.line, body: finding.body, posted: true
            )
        } catch {
            findingErrors[findingId] = message(from: error)
        }
    }

    func discard(prId: Int, findingId: Int) async {
        do {
            try await api.discardReviewFinding(prId: prId, findingId: findingId)
            findings.removeAll { $0.id == findingId }
            findingErrors[findingId] = nil
        } catch {
            errorMessage = message(from: error)
        }
    }

    private func message(from error: Error) -> String {
        (error as? APIError)?.localizedDescription ?? String(describing: error)
    }
}
