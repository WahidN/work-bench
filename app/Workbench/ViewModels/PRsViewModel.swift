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
    private var selectToken = 0

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

    // No view reads the diff from this screen any more, and fetching one takes the
    // PR job lock that the agent panel needs, so selecting a row loads the detail only.
    func select(_ pr: PullRequest) async {
        selectToken += 1
        let token = selectToken
        do {
            let detail = try await api.pullRequest(id: pr.id)
            guard token == selectToken else { return }
            selectedPr = detail
        } catch {
            guard token == selectToken else { return }
            present(error)
        }
    }

    func sendMessage(_ text: String) async {
        guard let prId = selectedPr?.id else { return }
        let token = selectToken
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.sendPrMessage(id: prId, text: text)
            let detail = try await api.pullRequest(id: prId)
            guard token == selectToken else { return }
            selectedPr = detail
            let diff = try? await api.diff(prId: prId).diff
            guard token == selectToken else { return }
            diffText = diff
        } catch {
            guard token == selectToken else { return }
            present(error)
        }
    }

    func merge() async {
        guard let prId = selectedPr?.id else { return }
        let token = selectToken
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.mergePr(id: prId)
            let detail = try await api.pullRequest(id: prId)
            if token == selectToken { selectedPr = detail }
            await load()
        } catch {
            if token == selectToken { present(error) }
        }
    }
}
