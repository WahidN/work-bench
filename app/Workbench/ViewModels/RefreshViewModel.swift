import Observation

protocol RefreshAPI {
    func poll() async throws -> PollSummary
}

extension APIClient: RefreshAPI {}

@Observable
@MainActor
final class RefreshViewModel {
    private(set) var isRefreshing = false
    var errorMessage: String?

    private let api: any RefreshAPI

    init(api: any RefreshAPI = APIClient()) {
        self.api = api
    }

    /// Returns true when the caller should reload its lists. A poll that reported
    /// source errors still returns true: the sources that did work have new data,
    /// and the errors are surfaced separately rather than discarding the rest.
    func refresh() async -> Bool {
        guard !isRefreshing else { return false }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let summary = try await api.poll()
            if !summary.sourceErrors.isEmpty {
                errorMessage = summary.sourceErrors.joined(separator: "\n")
            }
            return true
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }
}
