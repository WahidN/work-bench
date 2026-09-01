import Testing
@testable import Workbench

@MainActor
final class MockTodayAPI: TodayAPI {
    var todayResult: Result<TodayResponse, Error> = .success(TodayResponse(needsInput: [], todos: []))
    var createTodoResult: Result<Todo, Error>?
    var setTodoDoneResult: Result<Todo, Error>?
    var promoteTodoResult: Result<Ticket, Error>?
    var setTodoPriorityResult: Result<Todo, Error>?
    var setTodoPinnedResult: Result<Todo, Error>?
    var deleteTodoResult: Result<Void, Error>?
    private(set) var createTodoCalls: [String] = []
    private(set) var createTodoProjectIds: [Int?] = []
    private(set) var setTodoDoneCalls: [(id: Int, done: Bool)] = []
    private(set) var promoteTodoCalls: [Int] = []
    private(set) var setTodoPriorityCalls: [(id: Int, priority: TodoPriority)] = []
    private(set) var setTodoPinnedCalls: [(id: Int, pinned: Bool)] = []
    private(set) var deleteTodoCalls: [Int] = []

    func today() async throws -> TodayResponse { try todayResult.get() }
    func createTodo(text: String, projectId: Int?) async throws -> Todo {
        createTodoCalls.append(text)
        createTodoProjectIds.append(projectId)
        return try createTodoResult!.get()
    }
    func setTodoDone(id: Int, done: Bool) async throws -> Todo {
        setTodoDoneCalls.append((id, done))
        return try setTodoDoneResult!.get()
    }
    func promoteTodo(id: Int) async throws -> Ticket {
        promoteTodoCalls.append(id)
        return try promoteTodoResult!.get()
    }
    func setTodoPriority(id: Int, priority: TodoPriority) async throws -> Todo {
        setTodoPriorityCalls.append((id, priority))
        return try setTodoPriorityResult!.get()
    }
    func setTodoPinned(id: Int, pinned: Bool) async throws -> Todo {
        setTodoPinnedCalls.append((id, pinned))
        return try setTodoPinnedResult!.get()
    }
    func deleteTodo(id: Int) async throws {
        deleteTodoCalls.append(id)
        try deleteTodoResult!.get()
    }
}

private func sampleTodo(id: Int = 1, done: Bool = false, priority: TodoPriority = .med) -> Todo {
    var todo = Todo(id: id, source: .manual, sourceId: nil, text: "x", body: "", url: nil,
                    projectId: nil, canPromote: false, done: done, promotedTicketId: nil,
                    createdAt: "2026-08-12T00:00:00.000Z")
    todo.priority = priority
    return todo
}

private func sampleTicket() -> Ticket {
    Ticket(id: 1, source: .jira, sourceId: "JIRA-1", projectId: 1, title: "t", body: "b", url: "u",
           analysis: nil, status: .new, prId: nil, createdAt: "2026-08-12T00:00:00.000Z")
}

@MainActor
@Suite
struct TodayViewModelTests {
    @Test func loadPopulatesStateOnSuccess() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo()]))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.todos.count == 1)
        #expect(viewModel.errorMessage == nil)
        #expect(viewModel.isLoading == false)
    }

    @Test func loadSetsErrorMessageOnFailure() async {
        let api = MockTodayAPI()
        api.todayResult = .failure(APIError.transportFailed("no engine"))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.errorMessage != nil)
    }

    @Test func addTodoAppendsTheCreatedTodo() async {
        let api = MockTodayAPI()
        api.createTodoResult = .success(sampleTodo(id: 2))
        let viewModel = TodayViewModel(api: api)
        await viewModel.addTodo(text: "call client")
        #expect(api.createTodoCalls == ["call client"])
        #expect(api.createTodoProjectIds == [nil], "Today's quick-add has no project, so nil must reach the API")
        #expect(viewModel.todos.map(\.id) == [2])
    }

    @Test func addTodoForwardsTheProjectId() async {
        let api = MockTodayAPI()
        api.createTodoResult = .success(sampleTodo(id: 2))
        let viewModel = TodayViewModel(api: api)
        await viewModel.addTodo(text: "Fix the header", projectId: 7)
        #expect(api.createTodoProjectIds == [7])
    }

    @Test func toggleDoneKeepsTheTodoSoTheDoneSectionCanShowIt() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo(id: 1)]))
        api.setTodoDoneResult = .success(sampleTodo(id: 1, done: true))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        await viewModel.toggleDone(sampleTodo(id: 1))

        #expect(api.setTodoDoneCalls.first?.id == 1)
        #expect(api.setTodoDoneCalls.first?.done == true)
        #expect(viewModel.todos.count == 1)
        #expect(viewModel.todos[0].done, "GET /today returns today's completions, so the row moves to Done instead of vanishing")
    }

    @Test func cyclePriorityWritesTheNextPriorityAndStoresTheResult() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo(id: 1, priority: .med)]))
        api.setTodoPriorityResult = .success(sampleTodo(id: 1, priority: .low))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        await viewModel.cyclePriority(sampleTodo(id: 1, priority: .med))

        #expect(api.setTodoPriorityCalls.first?.id == 1)
        #expect(api.setTodoPriorityCalls.first?.priority == .low, "med cycles to low")
        #expect(viewModel.todos[0].priority == .low)
    }

    @Test func cyclePrioritySurfacesAnError() async {
        let api = MockTodayAPI()
        api.setTodoPriorityResult = .failure(APIError.serverError("boom"))
        let viewModel = TodayViewModel(api: api)
        await viewModel.cyclePriority(sampleTodo(id: 1))

        #expect(viewModel.errorMessage != nil)
    }

    @Test func promoteReloadsAfterSucceeding() async {
        let api = MockTodayAPI()
        api.promoteTodoResult = .success(sampleTicket())
        api.todayResult = .success(TodayResponse(needsInput: [TodayItem(kind: .ticket, id: 1, title: "t", status: "new", reviewScore: nil)], todos: []))
        let viewModel = TodayViewModel(api: api)
        await viewModel.promote(sampleTodo(id: 1))
        #expect(api.promoteTodoCalls == [1])
        #expect(viewModel.needsInput.count == 1, "promote should reload Today so the newly-created ticket shows up")
    }

    @Test func togglePinSendsTheInverseAndReloads() async {
        let api = MockTodayAPI()
        var pinned = sampleTodo(id: 1)
        pinned.pinned = true
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [pinned]))
        var unpinned = sampleTodo(id: 1)
        unpinned.pinned = false
        api.setTodoPinnedResult = .success(unpinned)
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        await viewModel.togglePin(pinned)

        #expect(api.setTodoPinnedCalls.first?.pinned == false, "toggling a pinned row unpins it")
        #expect(viewModel.todos.count == 1, "the list is reloaded rather than patched, because unpinning can remove the row")
    }

    @Test func togglePinSurfacesAnError() async {
        let api = MockTodayAPI()
        api.setTodoPinnedResult = .failure(APIError.serverError("boom"))
        let viewModel = TodayViewModel(api: api)
        await viewModel.togglePin(sampleTodo(id: 1))

        #expect(viewModel.errorMessage != nil)
    }

    @Test func deleteReturnsNilOnSuccess() async {
        let api = MockTodayAPI()
        api.deleteTodoResult = .success(())
        let viewModel = TodayViewModel(api: api)

        #expect(await viewModel.delete(sampleTodo(id: 1)) == nil)
    }

    @Test func deleteReloadsRatherThanRemovingTheRowLocally() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo(id: 1), sampleTodo(id: 2)]))
        api.deleteTodoResult = .success(())
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        // Only the reload can see this, so the list below proves the request happened.
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo(id: 2)]))

        _ = await viewModel.delete(sampleTodo(id: 1))

        #expect(api.deleteTodoCalls == [1])
        #expect(viewModel.todos.map(\.id) == [2],
                "the list must come back from GET /today: the sidebar count, the project card and the facts card all derive from it")
    }

    @Test func deleteReturnsAMessageAndLeavesTheListAloneWhenItFails() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo(id: 1)]))
        api.deleteTodoResult = .failure(APIError.serverError("boom"))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()

        let failure = await viewModel.delete(sampleTodo(id: 1))

        // Returned rather than parked on errorMessage: only TodayScreen presents that,
        // so a delete started from a project's Tasks tab reported nothing at all.
        #expect(failure != nil)
        #expect(viewModel.todos.map(\.id) == [1], "a failed delete must leave the row on screen")
    }

    @Test func deleteReportsSuccessEvenWhenTheReloadBehindItFails() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo(id: 1)]))
        api.deleteTodoResult = .success(())
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        // The engine goes away after the delete landed but before the refresh.
        api.todayResult = .failure(APIError.transportFailed("engine went away"))

        let failure = await viewModel.delete(sampleTodo(id: 1))

        // The task is gone whatever the refresh did, so reporting a delete failure here
        // would be a lie and would invite the user to try again against a 404.
        #expect(failure == nil)
    }
}
