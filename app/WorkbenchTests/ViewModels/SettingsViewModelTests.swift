import Testing
@testable import Workbench

private let disconnected = JiraConnection(
    hasClientCredentials: false, connected: false, siteUrl: nil, siteName: nil,
    availableSites: [], callbackUrl: "http://localhost:4173/oauth/jira/callback"
)

private let connectedSite = JiraConnection(
    hasClientCredentials: true, connected: true, siteUrl: "https://demo.atlassian.net",
    siteName: "Demo", availableSites: [], callbackUrl: "http://localhost:4173/oauth/jira/callback"
)

private let awaitingChoice = JiraConnection(
    hasClientCredentials: true, connected: false, siteUrl: nil, siteName: nil,
    availableSites: [
        JiraSite(id: "cloud-1", url: "https://one.atlassian.net", name: "One"),
        JiraSite(id: "cloud-2", url: "https://two.atlassian.net", name: "Two"),
    ],
    callbackUrl: "http://localhost:4173/oauth/jira/callback"
)

@MainActor
final class MockSettingsAPI: SettingsAPI {
    var connectionResults: [JiraConnection] = [disconnected]
    var authorizeResult: Result<String, Error> = .success("https://auth.atlassian.com/authorize?state=s")
    var saveResult: Result<Void, Error> = .success(())
    var chooseResult: Result<Void, Error> = .success(())
    var disconnectResult: Result<Void, Error> = .success(())

    private(set) var connectionCalls = 0
    private(set) var savedClients: [(String, String)] = []
    private(set) var chosenSites: [String] = []
    private(set) var disconnectCalls = 0

    func jiraConnection() async throws -> JiraConnection {
        connectionCalls += 1
        return connectionResults[min(connectionCalls - 1, connectionResults.count - 1)]
    }

    func saveJiraClient(clientId: String, clientSecret: String) async throws {
        savedClients.append((clientId, clientSecret))
        try saveResult.get()
    }

    func authorizeJira() async throws -> String { try authorizeResult.get() }

    func chooseJiraSite(cloudId: String) async throws {
        chosenSites.append(cloudId)
        try chooseResult.get()
    }

    func disconnectJira() async throws {
        disconnectCalls += 1
        try disconnectResult.get()
    }
}

@MainActor
@Suite
struct SettingsViewModelTests {
    @Test func loadStoresTheConnection() async {
        let api = MockSettingsAPI()
        api.connectionResults = [connectedSite]
        let viewModel = SettingsViewModel(api: api)

        await viewModel.load()

        #expect(viewModel.connection?.connected == true)
        #expect(viewModel.connection?.siteName == "Demo")
        #expect(viewModel.errorMessage == nil)
    }

    @Test func aFailedConnectIsPresented() async {
        let api = MockSettingsAPI()
        api.authorizeResult = .failure(APIError.serverError("engine down"))
        let viewModel = SettingsViewModel(api: api)

        _ = await viewModel.connect()

        #expect(viewModel.errorMessage == "engine down")
    }

    @Test func savingRejectsEmptyFieldsWithoutCallingTheApi() async {
        let api = MockSettingsAPI()
        let viewModel = SettingsViewModel(api: api)

        await viewModel.saveClient(clientId: "  ", clientSecret: "secret")

        #expect(api.savedClients.isEmpty)
        #expect(viewModel.errorMessage != nil)
    }

    @Test func savingTrimsAndReloads() async {
        let api = MockSettingsAPI()
        api.connectionResults = [JiraConnection(
            hasClientCredentials: true, connected: false, siteUrl: nil, siteName: nil,
            availableSites: [], callbackUrl: disconnected.callbackUrl
        )]
        let viewModel = SettingsViewModel(api: api)

        await viewModel.saveClient(clientId: " client-abc ", clientSecret: " secret-xyz ")

        #expect(api.savedClients.first?.0 == "client-abc")
        #expect(api.savedClients.first?.1 == "secret-xyz")
        #expect(viewModel.connection?.hasClientCredentials == true)
    }

    @Test func connectReturnsTheUrlForTheViewToOpen() async {
        let api = MockSettingsAPI()
        let viewModel = SettingsViewModel(api: api)

        let url = await viewModel.connect()

        #expect(url == "https://auth.atlassian.com/authorize?state=s")
        #expect(viewModel.isWaitingForBrowser)
    }

    @Test func aFailedConnectDoesNotLeaveItWaiting() async {
        let api = MockSettingsAPI()
        api.authorizeResult = .failure(APIError.badRequest("Set the client ID and secret first"))
        let viewModel = SettingsViewModel(api: api)

        let url = await viewModel.connect()

        #expect(url == nil)
        #expect(viewModel.isWaitingForBrowser == false)
        #expect(viewModel.errorMessage == "Set the client ID and secret first")
    }

    @Test func pollingStopsOnceConnected() async {
        let api = MockSettingsAPI()
        api.connectionResults = [disconnected, disconnected, connectedSite]
        let viewModel = SettingsViewModel(api: api)
        _ = await viewModel.connect()

        await viewModel.pollUntilConnected(every: .zero, attempts: 10)

        #expect(viewModel.connection?.connected == true)
        #expect(viewModel.isWaitingForBrowser == false)
        #expect(api.connectionCalls == 3)
    }

    @Test func pollingStopsOnceASiteChoiceIsNeeded() async {
        let api = MockSettingsAPI()
        api.connectionResults = [disconnected, awaitingChoice]
        let viewModel = SettingsViewModel(api: api)
        _ = await viewModel.connect()

        await viewModel.pollUntilConnected(every: .zero, attempts: 10)

        #expect(viewModel.connection?.availableSites.count == 2)
        #expect(viewModel.isWaitingForBrowser == false)
        #expect(api.connectionCalls == 2)
    }

    @Test func pollingGivesUpAndSaysSo() async {
        let api = MockSettingsAPI()
        api.connectionResults = [disconnected]
        let viewModel = SettingsViewModel(api: api)
        _ = await viewModel.connect()

        await viewModel.pollUntilConnected(every: .zero, attempts: 3)

        #expect(api.connectionCalls == 3)
        #expect(viewModel.isWaitingForBrowser == false)
        #expect(viewModel.errorMessage?.contains("No response from Atlassian") == true)
    }

    @Test func stopPollingEndsTheWait() async {
        let api = MockSettingsAPI()
        let viewModel = SettingsViewModel(api: api)
        _ = await viewModel.connect()

        viewModel.stopPolling()

        #expect(viewModel.isWaitingForBrowser == false)
    }

    @Test func choosingASiteReloads() async {
        let api = MockSettingsAPI()
        api.connectionResults = [awaitingChoice, connectedSite]
        let viewModel = SettingsViewModel(api: api)
        await viewModel.load()

        await viewModel.chooseSite("cloud-2")

        #expect(api.chosenSites == ["cloud-2"])
        #expect(viewModel.connection?.connected == true)
    }

    @Test func disconnectingReloads() async {
        let api = MockSettingsAPI()
        api.connectionResults = [connectedSite, disconnected]
        let viewModel = SettingsViewModel(api: api)
        await viewModel.load()

        await viewModel.disconnect()

        #expect(api.disconnectCalls == 1)
        #expect(viewModel.connection?.connected == false)
    }
}
