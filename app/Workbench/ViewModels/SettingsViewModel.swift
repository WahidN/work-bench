import Foundation
import Observation

protocol SettingsAPI {
    func jiraConnection() async throws -> JiraConnection
    func saveJiraClient(clientId: String, clientSecret: String) async throws
    func authorizeJira() async throws -> String
    func chooseJiraSite(cloudId: String) async throws
    func disconnectJira() async throws
}

extension APIClient: SettingsAPI {}

@Observable
@MainActor
final class SettingsViewModel {
    private(set) var connection: JiraConnection?
    private(set) var isBusy = false
    private(set) var isWaitingForBrowser = false
    var errorMessage: String?

    private let api: any SettingsAPI

    init(api: any SettingsAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        do {
            connection = try await api.jiraConnection()
            errorMessage = nil
        } catch {
            present(error)
        }
    }

    func saveClient(clientId: String, clientSecret: String) async {
        let id = clientId.trimmingCharacters(in: .whitespacesAndNewlines)
        let secret = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, !secret.isEmpty else {
            errorMessage = "Both the client ID and the client secret are needed."
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            try await api.saveJiraClient(clientId: id, clientSecret: secret)
            await load()
        } catch {
            present(error)
        }
    }

    /// Returns the URL for the view to open. Opening a browser is the one thing no
    /// test can do, so the view model stops at handing the address over.
    func connect() async -> String? {
        isBusy = true
        defer { isBusy = false }
        do {
            let url = try await api.authorizeJira()
            isWaitingForBrowser = true
            errorMessage = nil
            return url
        } catch {
            isWaitingForBrowser = false
            present(error)
            return nil
        }
    }

    /// Polls until the connection finishes or a site choice appears. Both are ends of
    /// the browser trip, so both stop the wait.
    func pollUntilConnected(every interval: Duration = .seconds(2), attempts: Int = 90) async {
        for _ in 0..<attempts {
            guard isWaitingForBrowser else { return }
            await load()
            if connection?.connected == true || connection?.availableSites.isEmpty == false {
                isWaitingForBrowser = false
                return
            }
            try? await Task.sleep(for: interval)
        }
        isWaitingForBrowser = false
        errorMessage = "No response from Atlassian yet. Try Connect again."
    }

    func stopPolling() {
        isWaitingForBrowser = false
    }

    func chooseSite(_ cloudId: String) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await api.chooseJiraSite(cloudId: cloudId)
            await load()
        } catch {
            present(error)
        }
    }

    func disconnect() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await api.disconnectJira()
            await load()
        } catch {
            present(error)
        }
    }
}
