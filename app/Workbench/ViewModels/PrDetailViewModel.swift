import Observation

protocol PrDetailAPI {
    func prDetail(id: Int) async throws -> PrDetail
    func postReviewReply(prId: Int, commentId: Int, text: String) async throws
    func mergePr(id: Int) async throws -> PrChatResult
}

extension APIClient: PrDetailAPI {}

@Observable
@MainActor
final class PrDetailViewModel {
    private(set) var detail: PrDetail?
    private(set) var isLoading = true
    private(set) var isMerging = false
    private(set) var busyCommentIds: Set<Int> = []
    var errorMessage: String?

    private let api: any PrDetailAPI

    init(api: any PrDetailAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load(prId: Int) async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await api.prDetail(id: prId)
            errorMessage = nil
        } catch {
            present(error)
        }
    }

    /// Answers whether the reply reached GitHub, so the box is only emptied on a
    /// post that actually landed and a failed one leaves the text to retry.
    func postReply(prId: Int, commentId: Int, text: String) async -> Bool {
        guard !busyCommentIds.contains(commentId) else { return false }
        busyCommentIds.insert(commentId)
        defer { busyCommentIds.remove(commentId) }
        do {
            try await api.postReviewReply(prId: prId, commentId: commentId, text: text)
            await load(prId: prId)
            return true
        } catch {
            present(error)
            return false
        }
    }

    /// The engine answers a refusal with 200 and an action, so a refusal has to be
    /// read off the result rather than caught as an error.
    func merge(prId: Int) async {
        isMerging = true
        defer { isMerging = false }
        do {
            let result = try await api.mergePr(id: prId)
            if result.action == .refused {
                errorMessage = result.reply
            } else {
                await load(prId: prId)
            }
        } catch {
            present(error)
        }
    }
}
