import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientPRsTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func pullRequestDetailDecodesMessages() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: """
            {"id":142,"ticketId":1,"projectId":1,"branch":"fix/gh-1","number":142,"url":"https://x/pull/142",
             "status":"open","lastReviewScore":4.6,"pinned":false,"createdAt":"2026-08-12T00:00:00.000Z",
             "messages":[{"id":1,"prId":142,"role":"assistant","content":"Fix ready.","createdAt":"2026-08-12T00:00:00.000Z"}]}
            """)
        }
        let pr = try await APIClient(session: session, keychain: testKeychain).pullRequest(id: 142)
        #expect(pr.messages?.count == 1)
    }

    @Test func diffReturnsTheDiffText() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"diff":"--- a/x.ts\n+++ b/x.ts"}"#) }
        let result = try await APIClient(session: session, keychain: testKeychain).diff(prId: 1)
        #expect(result.diff.contains("--- a/x.ts"))
    }

    @Test func diffOnAMergedPrSurfacesTheSpecificConflict() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 409, body: #"{"error":"PR already merged, diff no longer available"}"#)
        }
        await #expect(throws: APIError.conflict("PR already merged, diff no longer available")) {
            _ = try await APIClient(session: session, keychain: testKeychain).diff(prId: 1)
        }
    }

    @Test func sendPrMessageDecodesARevisedAction() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"action":"revised","reply":"Updated, pushed to the branch."}"#) }
        let result = try await APIClient(session: session, keychain: testKeychain).sendPrMessage(id: 1, text: "also guard the email field")
        #expect(result.action == .revised)
    }

    @Test func mergePrDecodesAMergedAction() async throws {
        var capturedPath: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            return jsonResponse(request.url!, status: 200, body: #"{"action":"merged","reply":"Merged https://x/pull/142."}"#)
        }
        let result = try await APIClient(session: session, keychain: testKeychain).mergePr(id: 1)
        #expect(capturedPath == "/prs/1/merge")
        #expect(result.action == .merged)
    }
}
