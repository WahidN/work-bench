import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientTodayProjectsTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func todayHitsTheRightPathAndDecodesTheResponse() async throws {
        var capturedPath: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            return jsonResponse(request.url!, status: 200, body: #"{"needsInput":[],"todos":[]}"#)
        }
        let result = try await APIClient(session: session, keychain: testKeychain).today()
        #expect(capturedPath == "/today")
        #expect(result.needsInput.isEmpty)
    }

    @Test func createProjectPostsTheExactBodyAndDecodesTheCreatedProject() async throws {
        var capturedMethod: String?
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedMethod = request.httpMethod
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 201, body: """
            {"id":1,"name":"demo","repoPath":"/repos/demo","defaultBranch":"main","githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null,"status":"active","blurb":""}
            """)
        }
        let input = ProjectInput(name: "demo", repoPath: "/repos/demo", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
        let project = try await APIClient(session: session, keychain: testKeychain).createProject(input)
        #expect(capturedMethod == "POST")
        #expect(capturedBody?["name"] as? String == "demo")
        #expect(capturedBody?["githubRepo"] == nil, "nil optional fields should be omitted, not sent as null")
        #expect(project.id == 1)
    }

    @Test func createProjectWithMissingFieldSurfacesTheEngineMessage() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 400, body: #"{"error":"repoPath is required"}"#)
        }
        let input = ProjectInput(name: "demo", repoPath: "", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
        await #expect(throws: APIError.badRequest("repoPath is required")) {
            _ = try await APIClient(session: session, keychain: testKeychain).createProject(input)
        }
    }

    @Test func updateProjectOnlySendsChangedFields() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":1,"name":"demo","repoPath":"/repos/demo","defaultBranch":"develop","githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null,"status":"active","blurb":""}
            """)
        }
        let update = ProjectUpdate(defaultBranch: "develop")
        let project = try await APIClient(session: session, keychain: testKeychain).updateProject(id: 1, update)
        #expect(capturedBody?.count == 1)
        #expect(capturedBody?["defaultBranch"] as? String == "develop")
        #expect(project.defaultBranch == "develop")
    }

    @Test func deleteProjectWithDependentsSurfacesTheConflict() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 409, body: #"{"error":"project still has tickets or todos referencing it"}"#)
        }
        await #expect(throws: APIError.conflict("project still has tickets or todos referencing it")) {
            try await APIClient(session: session, keychain: testKeychain).deleteProject(id: 1)
        }
    }

    @Test func deleteProjectSucceedsOn204() async throws {
        let session = mockedSession { request in
            (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!, Data())
        }
        try await APIClient(session: session, keychain: testKeychain).deleteProject(id: 1)
    }
}
