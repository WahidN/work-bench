import Observation

protocol TicketsAPI {
    func tickets() async throws -> [Ticket]
    func ticket(id: Int) async throws -> Ticket
    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply
    func createPr(ticketId: Int) async throws -> FixResult
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
        do {
            selectedTicket = try await api.ticket(id: ticket.id)
        } catch {
            present(error)
        }
    }

    func sendMessage(_ text: String) async {
        guard let ticketId = selectedTicket?.id else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.sendTicketMessage(id: ticketId, text: text)
            selectedTicket = try await api.ticket(id: ticketId)
        } catch {
            present(error)
        }
    }

    func createPr() async {
        guard let ticketId = selectedTicket?.id else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.createPr(ticketId: ticketId)
            selectedTicket = try await api.ticket(id: ticketId)
            await load()
        } catch {
            present(error)
        }
    }
}
