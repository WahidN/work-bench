import Observation

protocol TodayAPI {
    func today() async throws -> TodayResponse
    func createTodo(text: String) async throws -> Todo
    func setTodoDone(id: Int, done: Bool) async throws -> Todo
    func promoteTodo(id: Int) async throws -> Ticket
    func setTodoPriority(id: Int, priority: TodoPriority) async throws -> Todo
}

extension APIClient: TodayAPI {}

@Observable
@MainActor
final class TodayViewModel {
    private(set) var needsInput: [TodayItem] = []
    private(set) var todos: [Todo] = []
    private(set) var isLoading = false
    var errorMessage: String?
    private var isCurrentlyFailing = false

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
            isCurrentlyFailing = false
        } catch {
            if !isCurrentlyFailing {
                present(error)
            }
            isCurrentlyFailing = true
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
            let updated = try await api.setTodoDone(id: todo.id, done: !todo.done)
            replace(updated)
        } catch {
            present(error)
        }
    }

    func cyclePriority(_ todo: Todo) async {
        do {
            let updated = try await api.setTodoPriority(id: todo.id, priority: TodayLogic.nextPriority(after: todo.priority))
            replace(updated)
        } catch {
            present(error)
        }
    }

    private func replace(_ todo: Todo) {
        if let index = todos.firstIndex(where: { $0.id == todo.id }) {
            todos[index] = todo
        } else {
            todos.append(todo)
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
