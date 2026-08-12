import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientTicketsTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func ticketDetailDecodesMessages() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"github","sourceId":"GH-1","projectId":1,"title":"t","body":"b","url":"u",
             "analysis":null,"status":"sparring","prId":null,"createdAt":"2026-08-12T00:00:00.000Z",
             "messages":[{"id":1,"ticketId":1,"role":"user","content":"go ahead","createdAt":"2026-08-12T00:00:00.000Z"}]}
            """)
        }
        let ticket = try await APIClient(session: session, keychain: testKeychain).ticket(id: 1)
        #expect(ticket.messages?.count == 1)
    }

    @Test func sendTicketMessagePostsTextAndReturnsReply() async throws {
        var capturedPath: String?
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedBody = try? JSONSerialization.jsonObject(with: request.capturedBodyData() ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: #"{"reply":"Sounds good."}"#)
        }
        let reply = try await APIClient(session: session, keychain: testKeychain).sendTicketMessage(id: 1, text: "go ahead")
        #expect(capturedPath == "/tickets/1/messages")
        #expect(capturedBody?["text"] as? String == "go ahead")
        #expect(reply.reply == "Sounds good.")
    }

    @Test func createPrReturnsTicketStatusAndPrId() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: #"{"ticketStatus":"in_review","prId":5}"#)
        }
        let result = try await APIClient(session: session, keychain: testKeychain).createPr(ticketId: 1)
        #expect(result.ticketStatus == .inReview)
        #expect(result.prId == 5)
    }

    @Test func createPrWhenTicketAlreadyHasAPrSurfacesConflict() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 409, body: #"{"error":"ticket already has a PR"}"#) }
        await #expect(throws: APIError.conflict("ticket already has a PR")) {
            _ = try await APIClient(session: session, keychain: testKeychain).createPr(ticketId: 1)
        }
    }
}
