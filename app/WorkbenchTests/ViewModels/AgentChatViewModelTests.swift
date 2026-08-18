import Testing
@testable import Workbench

private let atlas = Project(id: 3, name: "Atlas Payments", repoPath: "/repos/atlas", defaultBranch: "main",
                            githubRepo: "acme/atlas", jiraProjectKey: "ATL", sentryProjectSlug: nil)

private func sampleTicket(messages: [TicketMessage]? = nil, status: TicketStatus = .sparring) -> Ticket {
    Ticket(id: 4, source: .jira, sourceId: "JIRA-ATL-441", projectId: 3, title: "Refunds double-charge",
           body: "b", url: "u", analysis: nil, status: status, prId: nil,
           createdAt: "2026-08-13T00:00:00.000Z", messages: messages)
}

private func samplePr(messages: [PullRequestMessage]? = nil, status: PrStatus = .open) -> PullRequest {
    PullRequest(id: 9, ticketId: 4, projectId: 3, branch: "fix/atl-441", number: 1284, url: nil,
                status: status, lastReviewScore: nil, createdAt: "2026-08-13T00:00:00.000Z",
                messages: messages, title: "Refunds double-charge", isDraft: false,
                authoredByMe: false, assignedToMe: false, messageCount: 0)
}

private func ticketMessage(_ id: Int, _ role: ChatRole, _ content: String) -> TicketMessage {
    TicketMessage(id: id, ticketId: 4, role: role, content: content, createdAt: "")
}

private func prMessage(_ id: Int, _ role: ChatRole, _ content: String) -> PullRequestMessage {
    PullRequestMessage(id: id, prId: 9, role: role, content: content, createdAt: "")
}

@MainActor
final class MockAgentChatAPI: AgentChatAPI {
    var projectThread: [ProjectMessage] = []
    var ticketResult: Ticket = sampleTicket()
    var prResult: PullRequest = samplePr()
    var diffResult: Result<DiffResponse, Error> = .success(DiffResponse(diff: "--- a\n+++ b"))
    var sendProjectResult: Result<ChatReply, Error> = .success(ChatReply(reply: "ok"))
    var sendTicketResult: Result<ChatReply, Error> = .success(ChatReply(reply: "ok"))
    var sendPrResult: Result<PrChatResult, Error> = .success(PrChatResult(action: .revised, reply: "ok"))
    var mergeResult: Result<PrChatResult, Error> = .success(PrChatResult(action: .merged, reply: "Merged."))

    private(set) var sentProjectMessages: [String] = []
    private(set) var sentTicketMessages: [String] = []
    private(set) var sentPrMessages: [String] = []
    private(set) var diffCalls: [Int] = []
    private(set) var mergeCalls: [Int] = []

    // A one-shot gate that lets a test suspend `projectMessages(id:)` mid-flight,
    // then release it deterministically once the test has done whatever it needed
    // to do while the call was in flight (close, or a superseding open).
    var gateArmed = false
    private(set) var gateEngaged = false
    private var gateContinuation: CheckedContinuation<Void, Never>?

    func releaseGate() {
        gateEngaged = false
        gateContinuation?.resume()
        gateContinuation = nil
    }

    func projectMessages(id: Int) async throws -> [ProjectMessage] {
        if gateArmed {
            gateArmed = false
            await withCheckedContinuation { continuation in
                gateContinuation = continuation
                gateEngaged = true
            }
        }
        return projectThread
    }

    func sendProjectMessage(id: Int, text: String) async throws -> ChatReply {
        sentProjectMessages.append(text)
        return try sendProjectResult.get()
    }

    func ticket(id: Int) async throws -> Ticket { ticketResult }

    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply {
        sentTicketMessages.append(text)
        return try sendTicketResult.get()
    }

    func pullRequest(id: Int) async throws -> PullRequest { prResult }

    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult {
        sentPrMessages.append(text)
        return try sendPrResult.get()
    }

    func diff(prId: Int) async throws -> DiffResponse {
        diffCalls.append(prId)
        return try diffResult.get()
    }

    func mergePr(id: Int) async throws -> PrChatResult {
        mergeCalls.append(id)
        return try mergeResult.get()
    }
}

@MainActor
@Suite
struct AgentChatViewModelTests {
    @Test func openingAProjectLoadsItsThread() async {
        let api = MockAgentChatAPI()
        api.projectThread = [
            ProjectMessage(id: 1, projectId: 3, role: .user, content: "catch me up", createdAt: ""),
            ProjectMessage(id: 2, projectId: 3, role: .assistant, content: "two PRs waiting", createdAt: "")
        ]
        let viewModel = AgentChatViewModel(api: api)

        await viewModel.open(.project(atlas))

        #expect(viewModel.isOpen)
        #expect(viewModel.messages.map(\.content) == ["catch me up", "two PRs waiting"])
        #expect(api.diffCalls.isEmpty, "a project thread must never fetch a diff")
    }

    @Test func openingATicketLoadsItsMessagesAndRefreshesTheTarget() async {
        let api = MockAgentChatAPI()
        api.ticketResult = sampleTicket(messages: [ticketMessage(1, .user, "add a test")], status: .inReview)
        let viewModel = AgentChatViewModel(api: api)

        await viewModel.open(.ticket(sampleTicket(status: .new)))

        #expect(viewModel.messages.map(\.content) == ["add a test"])
        #expect(viewModel.target == .ticket(api.ticketResult), "the fetched detail replaces the stale target")
    }

    @Test func openingAPullRequestLoadsMessagesAndDiff() async {
        let api = MockAgentChatAPI()
        api.prResult = samplePr(messages: [prMessage(1, .assistant, "pushed the test")])
        let viewModel = AgentChatViewModel(api: api)

        await viewModel.open(.pullRequest(samplePr()))

        #expect(viewModel.messages.map(\.content) == ["pushed the test"])
        #expect(viewModel.diffText == "--- a\n+++ b")
        #expect(api.diffCalls == [9])
    }

    @Test func openingAMergedPullRequestSkipsTheDiff() async {
        let api = MockAgentChatAPI()
        api.prResult = samplePr(status: .merged)
        let viewModel = AgentChatViewModel(api: api)

        await viewModel.open(.pullRequest(samplePr(status: .merged)))

        #expect(viewModel.diffText == nil)
        #expect(api.diffCalls.isEmpty)
    }

    @Test func aFailingDiffFetchLeavesTheThreadUsable() async {
        let api = MockAgentChatAPI()
        api.prResult = samplePr(messages: [prMessage(1, .user, "fix it")])
        api.diffResult = .failure(APIError.conflict("already working on this"))
        let viewModel = AgentChatViewModel(api: api)

        await viewModel.open(.pullRequest(samplePr()))

        #expect(viewModel.diffText == nil)
        #expect(viewModel.messages.count == 1)
        #expect(viewModel.errorMessage == nil, "a locked diff is expected, not an error to show")
    }

    @Test func sendRoutesToTheProjectEndpointAndReloads() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.project(atlas))

        api.projectThread = [ProjectMessage(id: 5, projectId: 3, role: .user, content: "hi", createdAt: "")]
        await viewModel.send("hi")

        #expect(api.sentProjectMessages == ["hi"])
        #expect(viewModel.messages.map(\.content) == ["hi"])
        #expect(viewModel.isSending == false)
    }

    @Test func sendRoutesToTheTicketEndpoint() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.ticket(sampleTicket()))

        await viewModel.send("draft a fix plan")

        #expect(api.sentTicketMessages == ["draft a fix plan"])
        #expect(api.sentProjectMessages.isEmpty)
    }

    @Test func sendRoutesToThePullRequestEndpoint() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.pullRequest(samplePr()))

        await viewModel.send("summarise the review comments")

        #expect(api.sentPrMessages == ["summarise the review comments"])
    }

    @Test func sendIgnoresBlankText() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.project(atlas))

        await viewModel.send("   ")

        #expect(api.sentProjectMessages.isEmpty)
    }

    @Test func sendIgnoresANewlineOnlyMessage() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.project(atlas))

        await viewModel.send("\n\n")

        #expect(api.sentProjectMessages.isEmpty)
    }

    @Test func aSecondSendIsRefusedWhileTheFirstIsStillInFlight() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.project(atlas))

        api.gateArmed = true
        let inFlight = Task { await viewModel.send("first") }
        while !api.gateEngaged { await Task.yield() }

        await viewModel.send("second")
        api.releaseGate()
        await inFlight.value

        #expect(api.sentProjectMessages == ["first"], "two concurrent runs would interleave into one transcript")
    }

    @Test func sendSurfacesAFailureAsAnErrorMessage() async {
        let api = MockAgentChatAPI()
        api.sendProjectResult = .failure(APIError.serverError("claude timed out"))
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.project(atlas))

        await viewModel.send("hi")

        #expect(viewModel.errorMessage != nil)
        #expect(viewModel.isSending == false)
    }

    @Test func mergeCallsMergeAndReloadsTheThread() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.pullRequest(samplePr()))
        api.prResult = samplePr(messages: [prMessage(1, .assistant, "Merged.")], status: .merged)

        await viewModel.merge()

        #expect(api.mergeCalls == [9])
        #expect(viewModel.messages.map(\.content) == ["Merged."])
        #expect(viewModel.diffText == nil, "a merged PR has no diff left to show")
    }

    @Test func mergeDoesNothingWhenTheTargetIsNotAPullRequest() async {
        let api = MockAgentChatAPI()
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.project(atlas))

        await viewModel.merge()

        #expect(api.mergeCalls.isEmpty)
    }

    @Test func closeClearsEverything() async {
        let api = MockAgentChatAPI()
        api.prResult = samplePr(messages: [prMessage(1, .user, "fix it")])
        let viewModel = AgentChatViewModel(api: api)
        await viewModel.open(.pullRequest(samplePr()))
        viewModel.draft = "half typed"

        viewModel.close()

        #expect(viewModel.isOpen == false)
        #expect(viewModel.target == nil)
        #expect(viewModel.messages.isEmpty)
        #expect(viewModel.diffText == nil)
        #expect(viewModel.draft.isEmpty)
    }

    @Test func closeDuringAnInFlightLoadDiscardsTheStaleResult() async {
        let api = MockAgentChatAPI()
        api.projectThread = [ProjectMessage(id: 1, projectId: 3, role: .user, content: "stale", createdAt: "")]
        let viewModel = AgentChatViewModel(api: api)

        api.gateArmed = true
        let inFlight = Task { await viewModel.open(.project(atlas)) }
        while !api.gateEngaged { await Task.yield() }

        viewModel.close()
        api.releaseGate()
        await inFlight.value

        #expect(viewModel.isOpen == false)
        #expect(viewModel.target == nil)
        #expect(viewModel.messages.isEmpty, "the response for the closed load must not repopulate the thread")
    }

    @Test func aLaterOpenDiscardsAStaleInFlightLoad() async {
        let api = MockAgentChatAPI()
        api.projectThread = [ProjectMessage(id: 1, projectId: 3, role: .user, content: "stale", createdAt: "")]
        api.ticketResult = sampleTicket(messages: [ticketMessage(1, .user, "fresh")])
        let viewModel = AgentChatViewModel(api: api)

        api.gateArmed = true
        let inFlight = Task { await viewModel.open(.project(atlas)) }
        while !api.gateEngaged { await Task.yield() }

        await viewModel.open(.ticket(sampleTicket()))
        api.releaseGate()
        await inFlight.value

        #expect(viewModel.target == .ticket(api.ticketResult), "the superseding target must win")
        #expect(viewModel.messages.map(\.content) == ["fresh"], "the stale project response must not overwrite the ticket thread")
    }
}
