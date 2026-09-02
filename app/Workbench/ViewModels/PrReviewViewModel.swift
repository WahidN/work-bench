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

    /// What the engine last said about work on this pull request.
    @Published private(set) var isRunning = false

    /// Set the moment a review is started, before any load has reported the job.
    /// Without it the button flickers back to enabled between the start call
    /// returning and the next load, which is most of the time the review takes.
    @Published private(set) var didStart = false

    /// Whether a review can be started. The engine's answer wins once it has one,
    /// so an interrupted job releases the button rather than disabling it forever.
    var isBusy: Bool { isStarting || isRunning || didStart }

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
            didStart = true
        } catch {
            // Nothing was started, so the button has to come back.
            didStart = false
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
            isRunning = review.isRunning
            // The engine's answer replaces the optimistic flag. This is what
            // releases the button when a review finishes, and also when one was
            // interrupted by a restart and is never coming back.
            didStart = false
        } catch {
            errorMessage = message(from: error)
        }
    }

    /// Reloads until the engine stops reporting work, so the button re-enables and
    /// the findings appear without the user having to leave and come back.
    func followUntilFinished(prId: Int, pollSeconds: UInt64 = 5) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(pollSeconds))
            if Task.isCancelled { return }
            await load(prId: prId)
            if !isRunning { return }
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
