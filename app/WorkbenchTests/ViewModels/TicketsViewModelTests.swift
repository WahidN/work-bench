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
    var setTicketPinnedResult: Result<Ticket, Error>?
    private(set) var ticketsCalls = 0
    private(set) var setTicketPinnedCalls: [(id: Int, pinned: Bool)] = []

    func tickets() async throws -> [Ticket] {
        ticketsCalls += 1
        return try ticketsResult.get()
    }
    func setTicketPinned(id: Int, pinned: Bool) async throws -> Ticket {
        setTicketPinnedCalls.append((id, pinned))
        return try setTicketPinnedResult!.get()
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

    @Test func togglePinFlipsTheFlagAndStoresTheUpdatedTicket() async {
        var pinned = sampleTicket(id: 1)
        pinned.pinned = true
        let api = MockTicketsAPI()
        api.ticketsResult = .success([sampleTicket(id: 1)])
        api.setTicketPinnedResult = .success(pinned)
        let viewModel = TicketsViewModel(api: api)
        await viewModel.load()
        await viewModel.togglePin(sampleTicket(id: 1))

        #expect(api.setTicketPinnedCalls.first?.pinned == true)
        #expect(viewModel.tickets[0].pinned)
    }
}
