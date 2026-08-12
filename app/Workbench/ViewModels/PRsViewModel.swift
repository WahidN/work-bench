import Observation

protocol PRsAPI {
    func pullRequests() async throws -> [PullRequest]
    func pullRequest(id: Int) async throws -> PullRequest
    func diff(prId: Int) async throws -> DiffResponse
    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult
    func mergePr(id: Int) async throws -> PrChatResult
}

extension APIClient: PRsAPI {}

@Observable
@MainActor
final class PRsViewModel {
    private(set) var pullRequests: [PullRequest] = []
    var selectedPr: PullRequest?
    private(set) var diffText: String?
    private(set) var isBusy = false
    var errorMessage: String?

    private let api: any PRsAPI

    init(api: any PRsAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        do {
            pullRequests = try await api.pullRequests()
        } catch {
            present(error)
        }
    }

    func select(_ pr: PullRequest) async {
        diffText = nil
        do {
            let detail = try await api.pullRequest(id: pr.id)
            selectedPr = detail
            if detail.status != .merged {
                diffText = try await api.diff(prId: pr.id).diff
            }
        } catch {
            present(error)
        }
    }

    func sendMessage(_ text: String) async {
        guard let prId = selectedPr?.id else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.sendPrMessage(id: prId, text: text)
            selectedPr = try await api.pullRequest(id: prId)
            diffText = try? await api.diff(prId: prId).diff
        } catch {
            present(error)
        }
    }

    func merge() async {
        guard let prId = selectedPr?.id else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.mergePr(id: prId)
            selectedPr = try await api.pullRequest(id: prId)
            await load()
        } catch {
            present(error)
        }
    }
}
