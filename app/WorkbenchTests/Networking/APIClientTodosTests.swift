// app/WorkbenchTests/Networking/APIClientTodosTests.swift
import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientTodosTests {
    @Test func createTodoPostsTheTextField() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 201, body: """
            {"id":1,"source":"manual","sourceId":null,"text":"renew SSL cert","body":"","url":null,
             "projectId":null,"canPromote":false,"done":false,"promotedTicketId":null,"priority":"med","pinned":false,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: StubSecretStore()).createTodo(text: "renew SSL cert")
        #expect(capturedBody?["text"] as? String == "renew SSL cert")
        #expect(todo.text == "renew SSL cert")
    }

    @Test func setTodoDonePatchesTheDoneField() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"manual","sourceId":null,"text":"x","body":"","url":null,
             "projectId":null,"canPromote":false,"done":true,"promotedTicketId":null,"priority":"med","pinned":false,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: StubSecretStore()).setTodoDone(id: 1, done: true)
        #expect(capturedBody?["done"] as? Bool == true)
        #expect(todo.done == true)
    }

    @Test func setTodoPriorityPatchesOnlyThePriorityField() async throws {
        var capturedBody: [String: Any]?
        var capturedMethod: String?
        let session = mockedSession { request in
            capturedMethod = request.httpMethod
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"manual","sourceId":null,"text":"x","body":"","url":null,
             "projectId":null,"canPromote":false,"done":false,"promotedTicketId":null,
             "priority":"high","dueAt":"2026-08-14","doneAt":null,"pinned":false,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: StubSecretStore()).setTodoPriority(id: 1, priority: .high)
        #expect(capturedMethod == "PATCH")
        #expect(capturedBody?["priority"] as? String == "high")
        #expect(capturedBody?["done"] == nil, "a priority change must not send done, or the engine would reopen the task")
        #expect(todo.priority == .high)
    }

    @Test func promoteTodoReturnsTheTicketOnSuccess() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"jira","sourceId":"JIRA-DEMO-1","projectId":1,"title":"Update env vars",
             "body":"b","url":"u","analysis":null,"status":"new","prId":null,"pinned":false,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let ticket = try await APIClient(session: session, keychain: StubSecretStore()).promoteTodo(id: 1)
        #expect(ticket.source == .jira)
    }

    @Test func promoteTodoNotFoundSurfacesNotFound() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 404, body: #"{"error":"Todo 999 not found"}"#) }
        await #expect(throws: APIError.notFound("Todo 999 not found")) {
            _ = try await APIClient(session: session, keychain: StubSecretStore()).promoteTodo(id: 999)
        }
    }

    @Test func promoteTodoNotPromotableSurfacesBadRequest() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 400, body: #"{"error":"Todo 1 cannot be promoted (not a Jira item)"}"#)
        }
        await #expect(throws: APIError.badRequest("Todo 1 cannot be promoted (not a Jira item)")) {
            _ = try await APIClient(session: session, keychain: StubSecretStore()).promoteTodo(id: 1)
        }
    }

    @Test func promoteTodoAlreadyRunningSurfacesConflict() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 409, body: #"{"error":"already working on this"}"#) }
        await #expect(throws: APIError.conflict("already working on this")) {
            _ = try await APIClient(session: session, keychain: StubSecretStore()).promoteTodo(id: 1)
        }
    }

    @Test func todosAsksForEverythingWhenIncludingDone() async throws {
        var capturedURL: URL?
        let session = mockedSession { request in
            capturedURL = request.url
            return jsonResponse(request.url!, status: 200, body: "[]")
        }
        _ = try await APIClient(session: session, keychain: StubSecretStore()).todos(includeDone: true)
        #expect(capturedURL?.path == "/todos")
        #expect(capturedURL?.query == "done=any", "a query string must not be percent-encoded into the path")
    }

    @Test func todosOmitsTheFilterByDefault() async throws {
        var capturedURL: URL?
        let session = mockedSession { request in
            capturedURL = request.url
            return jsonResponse(request.url!, status: 200, body: "[]")
        }
        _ = try await APIClient(session: session, keychain: StubSecretStore()).todos()
        #expect(capturedURL?.query == nil)
    }

    @Test func setTodoPinnedPatchesThePinRoute() async throws {
        var capturedPath: String?
        var capturedMethod: String?
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedMethod = request.httpMethod
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":4,"source":"jira","sourceId":"JIRA-MR-1","text":"[MR-1] Fix the importer","body":"",
             "url":"https://x/browse/MR-1","projectId":null,"canPromote":false,"done":false,
             "promotedTicketId":null,"priority":"med","dueAt":null,"doneAt":null,"pinned":true,
             "createdAt":"2026-08-14T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: StubSecretStore()).setTodoPinned(id: 4, pinned: true)
        #expect(capturedPath == "/todos/4/pin")
        #expect(capturedMethod == "PATCH")
        #expect(capturedBody?["pinned"] as? Bool == true)
        #expect(todo.pinned == true)
    }
}
