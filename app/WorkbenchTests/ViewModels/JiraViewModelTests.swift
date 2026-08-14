import Testing
@testable import Workbench

private func jiraTodo(id: Int, number: Int = 1, pinned: Bool = false, promotedTicketId: Int? = nil) -> Todo {
    var todo = Todo(id: id, source: .jira, sourceId: "JIRA-MR-\(number)", text: "[MR-\(number)] Fix the importer",
                    body: "", url: "https://x/browse/MR-\(number)", projectId: 1, canPromote: true,
                    done: false, promotedTicketId: promotedTicketId, createdAt: "2026-08-14T00:00:00.000Z")
    todo.pinned = pinned
    return todo
}

private func sampleTicket(id: Int = 9) -> Ticket {
    Ticket(id: id, source: .jira, sourceId: "JIRA-MR-1", projectId: 1, title: "Fix the importer", body: "b",
           url: "u", analysis: nil, status: .sparring, prId: nil, createdAt: "2026-08-14T00:00:00.000Z")
}

private func row(for todo: Todo, ticketId: Int? = nil) -> JiraRow {
    JiraLogic.rows(todos: [todo], key: "MR", tickets: ticketId.map { [sampleTicket(id: $0)] } ?? [])[0]
}

@MainActor
final class MockJiraAPI: JiraAPI {
    var todosResult: Result<[Todo], Error> = .success([])
    var promoteResult: Result<Ticket, Error> = .success(sampleTicket())
    var pinResult: Result<Todo, Error> = .success(jiraTodo(id: 1))
    var createPrResult: Result<FixResult, Error> = .success(FixResult(ticketStatus: .inReview, prId: 4))
    private(set) var todosCalls: [Bool] = []
    private(set) var promoteCalls: [Int] = []
    private(set) var pinCalls: [(id: Int, pinned: Bool)] = []
    private(set) var createPrCalls: [Int] = []

    func todos(includeDone: Bool) async throws -> [Todo] {
        todosCalls.append(includeDone)
        return try todosResult.get()
    }
    func promoteTodo(id: Int) async throws -> Ticket {
        promoteCalls.append(id)
        return try promoteResult.get()
    }
    func setTodoPinned(id: Int, pinned: Bool) async throws -> Todo {
        pinCalls.append((id, pinned))
        return try pinResult.get()
    }
    func createPr(ticketId: Int) async throws -> FixResult {
        createPrCalls.append(ticketId)
        return try createPrResult.get()
    }
}

@MainActor
@Suite
struct JiraViewModelTests {
    @Test func loadAsksForCompletedTodosTooAndSelectsTheBusiestProject() async {
        let api = MockJiraAPI()
        api.todosResult = .success([jiraTodo(id: 1), jiraTodo(id: 2, number: 2)])
        let viewModel = JiraViewModel(api: api)
        await viewModel.load()

        #expect(api.todosCalls == [true], "promoted issues have done = 1 and must still be listed")
        #expect(viewModel.todos.count == 2)
        #expect(viewModel.selectedKey == "MR")
    }

    @Test func loadKeepsAnExistingSelection() async {
        let api = MockJiraAPI()
        api.todosResult = .success([jiraTodo(id: 1)])
        let viewModel = JiraViewModel(api: api)
        viewModel.select("RAR")
        await viewModel.load()

        #expect(viewModel.selectedKey == "RAR", "a reload must not yank the user back to another project")
    }

    @Test func promoteReloadsSoTheRowShowsItsNewState() async {
        let api = MockJiraAPI()
        api.todosResult = .success([jiraTodo(id: 1)])
        let viewModel = JiraViewModel(api: api)
        await viewModel.load()
        await viewModel.promote(row(for: jiraTodo(id: 1)))

        #expect(api.promoteCalls == [1])
        #expect(api.todosCalls.count == 2)
        #expect(viewModel.busyTodoId == nil, "the row is released once the request finishes")
    }

    @Test func promoteTranslatesAConflictIntoSomethingReadable() async {
        let api = MockJiraAPI()
        api.promoteResult = .failure(APIError.conflict("already working on this"))
        let viewModel = JiraViewModel(api: api)
        await viewModel.promote(row(for: jiraTodo(id: 1)))

        #expect(viewModel.errorMessage == "An analysis is already running for this issue.")
        #expect(viewModel.busyTodoId == nil)
    }

    @Test func promoteSurfacesOtherErrorsAsThemselves() async {
        let api = MockJiraAPI()
        api.promoteResult = .failure(APIError.serverError("Claude did not return valid JSON"))
        let viewModel = JiraViewModel(api: api)
        await viewModel.promote(row(for: jiraTodo(id: 1)))

        #expect(viewModel.errorMessage?.contains("Claude") == true)
    }

    @Test func togglePinSendsTheInverseAndStoresTheResult() async {
        let api = MockJiraAPI()
        api.todosResult = .success([jiraTodo(id: 1)])
        api.pinResult = .success(jiraTodo(id: 1, pinned: true))
        let viewModel = JiraViewModel(api: api)
        await viewModel.load()
        await viewModel.togglePin(row(for: jiraTodo(id: 1)))

        #expect(api.pinCalls.first?.pinned == true)
        #expect(viewModel.todos[0].pinned, "the returned row replaces the local one, no reload needed")
    }

    @Test func createPrReloadsAfterSucceeding() async {
        let api = MockJiraAPI()
        api.todosResult = .success([jiraTodo(id: 1, promotedTicketId: 9)])
        let viewModel = JiraViewModel(api: api)
        await viewModel.load()
        await viewModel.createPr(row(for: jiraTodo(id: 1, promotedTicketId: 9), ticketId: 9))

        #expect(api.createPrCalls == [9])
        #expect(api.todosCalls.count == 2)
    }

    @Test func createPrDoesNothingWithoutATicket() async {
        let api = MockJiraAPI()
        let viewModel = JiraViewModel(api: api)
        await viewModel.createPr(row(for: jiraTodo(id: 1)))

        #expect(api.createPrCalls.isEmpty)
    }
}
