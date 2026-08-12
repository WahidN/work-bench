import Testing
@testable import Workbench

private func sampleTicket(id: Int = 1, messageCount: Int = 0, status: TicketStatus = .new) -> Ticket {
    Ticket(id: id, source: .github, sourceId: "GH-\(id)", projectId: 1, title: "Fix null check", body: "b", url: "u",
           analysis: nil, status: status, prId: nil, createdAt: "2026-08-12T00:00:00.000Z",
           messages: (0..<messageCount).map { i in
               TicketMessage(id: i, ticketId: id, role: i % 2 == 0 ? .user : .assistant, content: "msg \(i)", createdAt: "2026-08-12T00:00:00.000Z")
           })
}

@MainActor
final class MockTicketsAPI: TicketsAPI {
    var ticketsResult: Result<[Ticket], Error> = .success([])
    var ticketHandler: (Int) throws -> Ticket = { sampleTicket(id: $0) }
    var sendMessageResult: Result<ChatReply, Error> = .success(ChatReply(reply: "ok"))
    var createPrResult: Result<FixResult, Error> = .success(FixResult(ticketStatus: .inReview, prId: 1))
    private(set) var ticketCalls: [Int] = []
    private(set) var sendMessageCalls: [(id: Int, text: String)] = []
    private(set) var createPrCalls: [Int] = []

    func tickets() async throws -> [Ticket] { try ticketsResult.get() }
    func ticket(id: Int) async throws -> Ticket {
        ticketCalls.append(id)
        return try ticketHandler(id)
    }
    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply {
        sendMessageCalls.append((id, text))
        return try sendMessageResult.get()
    }
    func createPr(ticketId: Int) async throws -> FixResult {
        createPrCalls.append(ticketId)
        return try createPrResult.get()
    }
}

@MainActor
@Suite
struct TicketsViewModelTests {
    @Test func loadPopulatesTicketList() async {
        let api = MockTicketsAPI()
        api.ticketsResult = .success([sampleTicket()])
        let viewModel = TicketsViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.tickets.count == 1)
    }

    @Test func selectFetchesTheFullDetail() async {
        let api = MockTicketsAPI()
        api.ticketHandler = { id in sampleTicket(id: id, messageCount: 2) }
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        #expect(viewModel.selectedTicket?.messages?.count == 2)
    }

    @Test func sendMessageRefetchesTheTicketToPickUpTheReply() async {
        let api = MockTicketsAPI()
        // ticketCalls already includes the in-flight call by the time ticketHandler runs
        // (the mock appends before invoking the handler), so call 1 = select (0 messages),
        // call 2 = the refetch inside sendMessage (2 messages: the new user message + reply).
        api.ticketHandler = { id in sampleTicket(id: id, messageCount: api.ticketCalls.count <= 1 ? 0 : 2) }
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        await viewModel.sendMessage("go ahead")
        #expect(api.sendMessageCalls.first?.text == "go ahead")
        #expect(viewModel.selectedTicket?.messages?.count == 2, "should refetch after sending, since the reply only comes back from a second GET")
    }

    @Test func createPrRefetchesTicketAndReloadsList() async {
        let api = MockTicketsAPI()
        api.ticketsResult = .success([sampleTicket(id: 1, status: .new)])
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        await viewModel.createPr()
        #expect(api.createPrCalls == [1])
        #expect(api.ticketCalls.count == 2, "one select fetch, one refetch after create-pr")
    }

    @Test func createPrConflictSurfacesTheEngineMessage() async {
        let api = MockTicketsAPI()
        api.createPrResult = .failure(APIError.conflict("ticket already has a PR"))
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        await viewModel.createPr()
        #expect(viewModel.errorMessage == "ticket already has a PR")
    }
}
