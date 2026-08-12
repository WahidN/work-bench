import Observation

protocol TodayAPI {
    func today() async throws -> TodayResponse
    func createTodo(text: String) async throws -> Todo
    func setTodoDone(id: Int, done: Bool) async throws -> Todo
    func promoteTodo(id: Int) async throws -> Ticket
}

extension APIClient: TodayAPI {}

@Observable
@MainActor
final class TodayViewModel {
    private(set) var needsInput: [TodayItem] = []
    private(set) var todos: [Todo] = []
    private(set) var isLoading = false
    var errorMessage: String?

    private let api: any TodayAPI

    init(api: any TodayAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.today()
            needsInput = response.needsInput
            todos = response.todos
            errorMessage = nil
        } catch {
            present(error)
        }
    }

    func addTodo(text: String) async {
        do {
            let todo = try await api.createTodo(text: text)
            todos.append(todo)
        } catch {
            present(error)
        }
    }

    func toggleDone(_ todo: Todo) async {
        do {
            _ = try await api.setTodoDone(id: todo.id, done: !todo.done)
            todos.removeAll { $0.id == todo.id }
        } catch {
            present(error)
        }
    }

    func promote(_ todo: Todo) async {
        do {
            _ = try await api.promoteTodo(id: todo.id)
            await load()
        } catch {
            present(error)
        }
    }
}
