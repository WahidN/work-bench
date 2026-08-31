import Testing
import Foundation
@testable import Workbench

private struct Echo: Decodable, Equatable {
    let value: Int
}

@Suite(.serialized)
struct APIClientCoreTests {
    @Test func attachesBearerTokenFromKeychain() async throws {
        var capturedAuth: String?
        let session = mockedSession { request in
            capturedAuth = request.value(forHTTPHeaderField: "Authorization")
            return jsonResponse(request.url!, status: 200, body: #"{"value":1}"#)
        }
        let client = APIClient(session: session, keychain: StubSecretStore(token: "test-token-123"))
        let result: Echo = try await client.send("GET", "/today", body: nil)
        #expect(capturedAuth == "Bearer test-token-123")
        #expect(result == Echo(value: 1))
    }

    @Test func missingTokenThrowsTransportFailedWithoutMakingARequest() async throws {
        let session = mockedSession { _ in
            Issue.record("should not have made a request with no token")
            return jsonResponse(URL(string: "http://127.0.0.1:4173/today")!, status: 200, body: "{}")
        }
        let client = APIClient(session: session, keychain: StubSecretStore(token: nil))
        await #expect(throws: APIError.self) {
            let _: Echo = try await client.send("GET", "/today", body: nil)
        }
    }

    @Test func mapsEachStatusCodeToTheRightAPIError() async throws {
        let cases: [(Int, String, APIError)] = [
            (400, #"{"error":"repoPath is required"}"#, .badRequest("repoPath is required")),
            (401, #"{"error":"unauthorized"}"#, .unauthorized),
            (404, #"{"error":"not found"}"#, .notFound("not found")),
            (409, #"{"error":"already working on this"}"#, .conflict("already working on this")),
            (500, #"{"error":"Error: boom"}"#, .serverError("Error: boom")),
        ]
        for (status, body, expected) in cases {
            let session = mockedSession { request in jsonResponse(request.url!, status: status, body: body) }
            let client = APIClient(session: session, keychain: StubSecretStore())
            await #expect(throws: expected) {
                let _: Echo = try await client.send("GET", "/today", body: nil)
            }
        }
    }

    @Test func decodingFailureThrowsDecodingFailed() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"unexpectedShape":true}"#) }
        let client = APIClient(session: session, keychain: StubSecretStore())
        await #expect(throws: APIError.self) {
            let _: Echo = try await client.send("GET", "/today", body: nil)
        }
    }

    @Test func sendNoContentSucceedsOn204WithNoBody() async throws {
        let session = mockedSession { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }
        let client = APIClient(session: session, keychain: StubSecretStore())
        try await client.sendNoContent("DELETE", "/projects/1", body: nil)
    }

    @Test func encodesTheRequestBodyAsJSON() async throws {
        var capturedBody: Data?
        let session = mockedSession { request in
            capturedBody = request.capturedBodyData()
            return jsonResponse(request.url!, status: 201, body: #"{"value":1}"#)
        }
        let client = APIClient(session: session, keychain: StubSecretStore())
        let _: Echo = try await client.send("POST", "/todos", body: ["text": "renew SSL cert"])
        let decoded = try JSONSerialization.jsonObject(with: capturedBody ?? Data()) as? [String: String]
        #expect(decoded?["text"] == "renew SSL cert")
    }

    @Test func jiraConnectionGetsTheStatus() async throws {
        var capturedPath: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            return jsonResponse(request.url!, status: 200, body: """
            {"hasClientCredentials":false,"connected":false,"siteUrl":null,"siteName":null,
             "availableSites":[],"callbackUrl":"http://localhost:4173/oauth/jira/callback"}
            """)
        }
        let connection = try await APIClient(session: session, keychain: StubSecretStore()).jiraConnection()

        #expect(capturedPath == "/settings/jira")
        #expect(connection.connected == false)
    }

    @Test func saveJiraClientPutsBothHalves() async throws {
        var capturedPath: String?
        var capturedMethod: String?
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedMethod = request.httpMethod
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: #"{"ok":true}"#)
        }
        try await APIClient(session: session, keychain: StubSecretStore())
            .saveJiraClient(clientId: "client-abc", clientSecret: "secret-xyz")

        #expect(capturedPath == "/settings/jira/client")
        #expect(capturedMethod == "PUT")
        #expect(capturedBody?["clientId"] as? String == "client-abc")
        #expect(capturedBody?["clientSecret"] as? String == "secret-xyz")
    }

    @Test func authorizeJiraReturnsTheUrl() async throws {
        var capturedMethod: String?
        let session = mockedSession { request in
            capturedMethod = request.httpMethod
            return jsonResponse(request.url!, status: 200, body: #"{"url":"https://auth.atlassian.com/authorize?state=s"}"#)
        }
        let url = try await APIClient(session: session, keychain: StubSecretStore()).authorizeJira()

        #expect(capturedMethod == "POST")
        #expect(url == "https://auth.atlassian.com/authorize?state=s")
    }

    @Test func chooseJiraSitePostsTheCloudId() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: #"{"ok":true}"#)
        }
        try await APIClient(session: session, keychain: StubSecretStore()).chooseJiraSite(cloudId: "cloud-2")

        #expect(capturedBody?["cloudId"] as? String == "cloud-2")
    }

    @Test func disconnectJiraDeletes() async throws {
        var capturedMethod: String?
        var capturedPath: String?
        let session = mockedSession { request in
            capturedMethod = request.httpMethod
            capturedPath = request.url?.path
            return jsonResponse(request.url!, status: 200, body: #"{"ok":true}"#)
        }
        try await APIClient(session: session, keychain: StubSecretStore()).disconnectJira()

        #expect(capturedMethod == "DELETE")
        #expect(capturedPath == "/settings/jira")
    }

    @Test func pollPostsAndDecodesTheSummary() async throws {
        var capturedPath: String?
        var capturedMethod: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedMethod = request.httpMethod
            return jsonResponse(request.url!, status: 200, body: """
            {"jiraTodos":12,"ticketsCreated":0,"prsSynced":3,"sourceErrors":["jira: 401 unauthorized"]}
            """)
        }
        let summary = try await APIClient(session: session, keychain: StubSecretStore()).poll()

        #expect(capturedPath == "/poll")
        #expect(capturedMethod == "POST")
        #expect(summary.jiraTodos == 12)
        #expect(summary.prsSynced == 3)
        #expect(summary.sourceErrors == ["jira: 401 unauthorized"])
    }
}
