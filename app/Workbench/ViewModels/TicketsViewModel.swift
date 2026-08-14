import Observation

protocol TicketsAPI {
    func tickets() async throws -> [Ticket]
    func setTicketPinned(id: Int, pinned: Bool) async throws -> Ticket
}

extension APIClient: TicketsAPI {}

@Observable
@MainActor
final class TicketsViewModel {
    private(set) var tickets: [Ticket] = []
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
