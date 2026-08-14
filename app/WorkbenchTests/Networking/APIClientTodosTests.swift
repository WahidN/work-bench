// app/WorkbenchTests/Networking/APIClientTodosTests.swift
import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientTodosTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func createTodoPostsTheTextField() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 201, body: """
            {"id":1,"source":"manual","sourceId":null,"text":"renew SSL cert","body":"","url":null,
             "projectId":null,"canPromote":false,"done":false,"promotedTicketId":null,"priority":"med","createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: testKeychain).createTodo(text: "renew SSL cert")
        #expect(capturedBody?["text"] as? String == "renew SSL cert")
        #expect(todo.text == "renew SSL cert")
    }

    @Test func setTodoDonePatchesTheDoneField() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"manual","sourceId":null,"text":"x","body":"","url":null,
             "projectId":null,"canPromote":false,"done":true,"promotedTicketId":null,"priority":"med","createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: testKeychain).setTodoDone(id: 1, done: true)
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
             "priority":"high","dueAt":"2026-08-14","doneAt":null,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: testKeychain).setTodoPriority(id: 1, priority: .high)
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
        let ticket = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 1)
        #expect(ticket.source == .jira)
    }

    @Test func promoteTodoNotFoundSurfacesNotFound() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 404, body: #"{"error":"Todo 999 not found"}"#) }
        await #expect(throws: APIError.notFound("Todo 999 not found")) {
            _ = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 999)
        }
    }

    @Test func promoteTodoNotPromotableSurfacesBadRequest() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 400, body: #"{"error":"Todo 1 cannot be promoted (not a Jira item)"}"#)
        }
        await #expect(throws: APIError.badRequest("Todo 1 cannot be promoted (not a Jira item)")) {
            _ = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 1)
        }
    }

    @Test func promoteTodoAlreadyRunningSurfacesConflict() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 409, body: #"{"error":"already working on this"}"#) }
        await #expect(throws: APIError.conflict("already working on this")) {
            _ = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 1)
        }
    }
}
