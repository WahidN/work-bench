import Observation

protocol PRsAPI {
    func pullRequests() async throws -> [PullRequest]
    func setPrPinned(id: Int, pinned: Bool) async throws -> PullRequest
}

extension APIClient: PRsAPI {}

@Observable
@MainActor
final class PRsViewModel {
    private(set) var pullRequests: [PullRequest] = []
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
            errorMessage = nil
        } catch {
            present(error)
        }
    }

    func togglePin(_ pr: PullRequest) async {
        do {
            let updated = try await api.setPrPinned(id: pr.id, pinned: !pr.pinned)
            if let index = pullRequests.firstIndex(where: { $0.id == updated.id }) {
                pullRequests[index] = updated
            }
        } catch {
            present(error)
        }
    }
}
