import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientPRsTests {
    @Test func pullRequestDetailDecodesMessages() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: """
            {"id":142,"ticketId":1,"projectId":1,"branch":"fix/gh-1","number":142,"url":"https://x/pull/142",
             "status":"open","lastReviewScore":4.6,"pinned":false,"createdAt":"2026-08-12T00:00:00.000Z",
             "title":"Fix null check","isDraft":false,"authoredByMe":false,"assignedToMe":false,"messageCount":1,
             "messages":[{"id":1,"prId":142,"role":"assistant","content":"Fix ready.","createdAt":"2026-08-12T00:00:00.000Z"}]}
            """)
        }
        let pr = try await APIClient(session: session, keychain: StubSecretStore()).pullRequest(id: 142)
        #expect(pr.messages?.count == 1)
    }

    @Test func setPrPinnedPatchesThePinRoute() async throws {
        var capturedPath: String?
        var capturedMethod: String?
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedMethod = request.httpMethod
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":142,"ticketId":1,"projectId":1,"branch":"fix/github-1","number":142,
             "url":"https://github.com/x/pull/142","status":"open","lastReviewScore":4.6,"pinned":true,
             "createdAt":"2026-08-12T00:00:00.000Z","title":"Fix null check","isDraft":false,
             "authoredByMe":false,"assignedToMe":false,"messageCount":0}
            """)
        }
        let pr = try await APIClient(session: session, keychain: StubSecretStore()).setPrPinned(id: 142, pinned: true)
        #expect(capturedPath == "/prs/142/pin")
        #expect(capturedMethod == "PATCH")
        #expect(capturedBody?["pinned"] as? Bool == true)
        #expect(pr.pinned == true)
    }

    @Test func diffReturnsTheDiffText() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"diff":"--- a/x.ts\n+++ b/x.ts"}"#) }
        let result = try await APIClient(session: session, keychain: StubSecretStore()).diff(prId: 1)
        #expect(result.diff.contains("--- a/x.ts"))
    }

    @Test func diffOnAMergedPrSurfacesTheSpecificConflict() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 409, body: #"{"error":"PR already merged, diff no longer available"}"#)
        }
        await #expect(throws: APIError.conflict("PR already merged, diff no longer available")) {
            _ = try await APIClient(session: session, keychain: StubSecretStore()).diff(prId: 1)
        }
    }

    @Test func sendPrMessageDecodesARevisedAction() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"action":"revised","reply":"Updated, pushed to the branch."}"#) }
        let result = try await APIClient(session: session, keychain: StubSecretStore()).sendPrMessage(id: 1, text: "also guard the email field")
        #expect(result.action == .revised)
    }

    @Test func mergePrDecodesAMergedAction() async throws {
        var capturedPath: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            return jsonResponse(request.url!, status: 200, body: #"{"action":"merged","reply":"Merged https://x/pull/142."}"#)
        }
        let result = try await APIClient(session: session, keychain: StubSecretStore()).mergePr(id: 1)
        #expect(capturedPath == "/prs/1/merge")
        #expect(result.action == .merged)
    }

    @Test func reviewPrPostsAndDecodesFindingsAndDiscards() async throws {
        var capturedPath: String?
        var capturedMethod: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedMethod = request.httpMethod
            return jsonResponse(request.url!, status: 200, body: #"""
            {"findings":[{"path":"src/a.ts","line":12,"body":"duplicated helper"}],
             "discarded":[{"path":"src/a.ts","line":999,"body":"invented","reason":"line 999 of src/a.ts is not part of the changes"}],
             "commitSha":"abc123"}
            """#)
        }

        let result = try await APIClient(session: session, keychain: StubSecretStore()).reviewPr(id: 1)

        #expect(capturedMethod == "POST")
        #expect(capturedPath == "/prs/1/review")
        #expect(result.findings.count == 1)
        #expect(result.findings[0].path == "src/a.ts")
        #expect(result.findings[0].line == 12)
        #expect(result.discarded.count == 1)
        #expect(result.discarded[0].reason.contains("999"))
    }

    @Test func reviewPrDecodesAnEmptyReview() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: #"{"findings":[],"discarded":[],"commitSha":"abc"}"#)
        }
        let result = try await APIClient(session: session, keychain: StubSecretStore()).reviewPr(id: 1)
        #expect(result.findings.isEmpty)
    }

    @Test func publishReviewSendsTheFindingsAndDecodesWhatLanded() async throws {
        var capturedPath: String?
        var capturedMethod: String?
        var capturedBody: Data?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedMethod = request.httpMethod
            capturedBody = request.capturedBodyData()
            return jsonResponse(request.url!, status: 200, body: #"""
            {"posted":[{"path":"src/a.ts","line":12,"body":"edited by the user"}],
             "failed":[{"path":"src/b.ts","line":3,"body":"other","error":"422 Unprocessable Entity"}]}
            """#)
        }

        let result = try await APIClient(session: session, keychain: StubSecretStore()).publishReview(
            id: 1, findings: [ReviewFinding(path: "src/a.ts", line: 12, body: "edited by the user")]
        )

        #expect(capturedMethod == "POST")
        #expect(capturedPath == "/prs/1/review/publish")
        #expect(String(data: capturedBody ?? Data(), encoding: .utf8)?.contains("edited by the user") == true)
        #expect(result.posted.count == 1)
        #expect(result.failed.count == 1)
        #expect(result.failed[0].error.contains("422"))
    }
}
