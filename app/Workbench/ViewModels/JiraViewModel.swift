import Observation

protocol JiraAPI {
    func todos(includeDone: Bool) async throws -> [Todo]
    func promoteTodo(id: Int) async throws -> Ticket
    func setTodoPinned(id: Int, pinned: Bool) async throws -> Todo
    func createPr(ticketId: Int) async throws -> FixResult
}

extension APIClient: JiraAPI {}

@Observable
@MainActor
final class JiraViewModel {
    private(set) var todos: [Todo] = []
    private(set) var selectedKey: String?
    private(set) var busyTodoId: Int?
    var errorMessage: String?

    private let api: any JiraAPI

    init(api: any JiraAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func select(_ key: String) {
        selectedKey = key
    }

    /// Asks for completed todos too: promoting sets done = 1, and a promoted issue
    /// must keep its place in the list with its pipeline state.
    func load() async {
        do {
            todos = try await api.todos(includeDone: true)
            if selectedKey == nil { selectedKey = JiraLogic.initialSelection(todos: todos) }
            errorMessage = nil
        } catch {
            present(error)
        }
    }

    func promote(_ row: JiraRow) async {
        busyTodoId = row.id
        defer { busyTodoId = nil }
        do {
            _ = try await api.promoteTodo(id: row.id)
            await load()
        } catch APIError.conflict {
            errorMessage = "An analysis is already running for this issue."
        } catch {
            present(error)
        }
    }

    func togglePin(_ row: JiraRow) async {
        do {
            let updated = try await api.setTodoPinned(id: row.id, pinned: !row.isPinned)
            if let index = todos.firstIndex(where: { $0.id == updated.id }) {
                todos[index] = updated
            }
        } catch {
            present(error)
        }
    }

    func createPr(_ row: JiraRow) async {
        guard let ticketId = row.ticketId else { return }
        busyTodoId = row.id
        defer { busyTodoId = nil }
        do {
            _ = try await api.createPr(ticketId: ticketId)
            await load()
        } catch {
            present(error)
        }
    }
}
