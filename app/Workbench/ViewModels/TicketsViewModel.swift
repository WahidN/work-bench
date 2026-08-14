import Observation

protocol TicketsAPI {
    func tickets() async throws -> [Ticket]
    func ticket(id: Int) async throws -> Ticket
    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply
    func createPr(ticketId: Int) async throws -> FixResult
    func setTicketPinned(id: Int, pinned: Bool) async throws -> Ticket
}

extension APIClient: TicketsAPI {}

@Observable
@MainActor
final class TicketsViewModel {
    private(set) var tickets: [Ticket] = []
    var selectedTicket: Ticket?
    private(set) var isSending = false
    var errorMessage: String?

    private let api: any TicketsAPI
    private var selectToken = 0

    init(api: any TicketsAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        do {
            tickets = try await api.tickets()
        } catch {
            present(error)
        }
    }

    func select(_ ticket: Ticket) async {
        selectToken += 1
        let token = selectToken
        do {
            let detail = try await api.ticket(id: ticket.id)
            guard token == selectToken else { return }
            selectedTicket = detail
        } catch {
            guard token == selectToken else { return }
            present(error)
        }
    }

    func sendMessage(_ text: String) async {
        guard let ticketId = selectedTicket?.id else { return }
        let token = selectToken
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.sendTicketMessage(id: ticketId, text: text)
            let detail = try await api.ticket(id: ticketId)
            guard token == selectToken else { return }
            selectedTicket = detail
        } catch {
            guard token == selectToken else { return }
            present(error)
        }
    }

    func createPr() async {
        guard let ticketId = selectedTicket?.id else { return }
        let token = selectToken
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.createPr(ticketId: ticketId)
            let detail = try await api.ticket(id: ticketId)
            if token == selectToken { selectedTicket = detail }
            await load()
        } catch {
            if token == selectToken { present(error) }
        }
    }

    func togglePin(_ ticket: Ticket) async {
        do {
            let updated = try await api.setTicketPinned(id: ticket.id, pinned: !ticket.pinned)
            if let index = tickets.firstIndex(where: { $0.id == updated.id }) {
                tickets[index] = updated
            }
        } catch {
            present(error)
        }
    }
}
