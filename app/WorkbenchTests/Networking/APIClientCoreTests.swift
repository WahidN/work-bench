import Testing
import Foundation
@testable import Workbench

private struct Echo: Decodable, Equatable {
    let value: Int
}

@Suite(.serialized)
struct APIClientCoreTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token-123", account: "api-token")
    }

    @Test func attachesBearerTokenFromKeychain() async throws {
        var capturedAuth: String?
        let session = mockedSession { request in
            capturedAuth = request.value(forHTTPHeaderField: "Authorization")
            return jsonResponse(request.url!, status: 200, body: #"{"value":1}"#)
        }
        let client = APIClient(session: session, keychain: testKeychain)
        let result: Echo = try await client.send("GET", "/today", body: nil)
        #expect(capturedAuth == "Bearer test-token-123")
        #expect(result == Echo(value: 1))
    }

    @Test func missingTokenThrowsTransportFailedWithoutMakingARequest() async throws {
        try testKeychain.deleteSecret(account: "api-token")
        let session = mockedSession { _ in
            Issue.record("should not have made a request with no token")
            return jsonResponse(URL(string: "http://127.0.0.1:4173/today")!, status: 200, body: "{}")
        }
        let client = APIClient(session: session, keychain: testKeychain)
        await #expect(throws: APIError.self) {
            let _: Echo = try await client.send("GET", "/today", body: nil)
        }
        try testKeychain.writeSecret("test-token-123", account: "api-token")
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
            let client = APIClient(session: session, keychain: testKeychain)
            await #expect(throws: expected) {
                let _: Echo = try await client.send("GET", "/today", body: nil)
            }
        }
    }

    @Test func decodingFailureThrowsDecodingFailed() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"unexpectedShape":true}"#) }
        let client = APIClient(session: session, keychain: testKeychain)
        await #expect(throws: APIError.self) {
            let _: Echo = try await client.send("GET", "/today", body: nil)
        }
    }

    @Test func sendNoContentSucceedsOn204WithNoBody() async throws {
        let session = mockedSession { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }
        let client = APIClient(session: session, keychain: testKeychain)
        try await client.sendNoContent("DELETE", "/projects/1", body: nil)
    }

    @Test func encodesTheRequestBodyAsJSON() async throws {
        var capturedBody: Data?
        let session = mockedSession { request in
            capturedBody = request.capturedBodyData()
            return jsonResponse(request.url!, status: 201, body: #"{"value":1}"#)
        }
        let client = APIClient(session: session, keychain: testKeychain)
        let _: Echo = try await client.send("POST", "/todos", body: ["text": "renew SSL cert"])
        let decoded = try JSONSerialization.jsonObject(with: capturedBody ?? Data()) as? [String: String]
        #expect(decoded?["text"] == "renew SSL cert")
    }
}
