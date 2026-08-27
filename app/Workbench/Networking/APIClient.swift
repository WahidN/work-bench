import Foundation

final class APIClient {
    static let baseURL = URL(string: "http://127.0.0.1:4173")!

    private let session: URLSession
    private let keychain: any SecretStore

    init(session: URLSession? = nil, keychain: any SecretStore = KeychainClient()) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 900
            configuration.timeoutIntervalForResource = 900
            self.session = URLSession(configuration: configuration)
        }
        self.keychain = keychain
    }

    private func makeRequest(_ method: String, _ path: String, query: [String: String]? = nil, body: Encodable?) throws -> URLRequest {
        guard let token = try keychain.readSecret(account: "api-token") else {
            throw APIError.transportFailed("No Workbench engine token found in Keychain. Is the engine running?")
        }
        var components = URLComponents(url: Self.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if let query, !query.isEmpty {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else {
            throw APIError.transportFailed("Could not build a URL for \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        return request
    }

    private func errorMessage(from data: Data) -> String {
        (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
            ?? String(data: data, encoding: .utf8) ?? "unknown error"
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transportFailed("No HTTP response")
        }
        switch http.statusCode {
        case 200, 201, 204:
            return
        case 400:
            throw APIError.badRequest(errorMessage(from: data))
        case 401:
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound(errorMessage(from: data))
        case 409:
            throw APIError.conflict(errorMessage(from: data))
        case 500:
            throw APIError.serverError(errorMessage(from: data))
        default:
            throw APIError.unexpectedStatus(http.statusCode, errorMessage(from: data))
        }
    }

    private func fetch(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw APIError.transportFailed(error.localizedDescription)
        }
    }

    func send<Response: Decodable>(_ method: String, _ path: String, query: [String: String]? = nil, body: Encodable?) async throws -> Response {
        let request = try makeRequest(method, path, query: query, body: body)
        let (data, response) = try await fetch(request)
        try validate(response, data: data)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decodingFailed(String(describing: error))
        }
    }

    func sendNoContent(_ method: String, _ path: String, body: Encodable?) async throws {
        let request = try makeRequest(method, path, body: body)
        let (data, response) = try await fetch(request)
        try validate(response, data: data)
    }
}

extension APIClient {
    func today() async throws -> TodayResponse {
        try await send("GET", "/today", body: nil)
    }

    func projects() async throws -> [Project] {
        try await send("GET", "/projects", body: nil)
    }

    func project(id: Int) async throws -> Project {
        try await send("GET", "/projects/\(id)", body: nil)
    }

    func createProject(_ input: ProjectInput) async throws -> Project {
        try await send("POST", "/projects", body: input)
    }

    func updateProject(id: Int, _ input: ProjectUpdate) async throws -> Project {
        try await send("PATCH", "/projects/\(id)", body: input)
    }

    func deleteProject(id: Int) async throws {
        try await sendNoContent("DELETE", "/projects/\(id)", body: nil)
    }

    func projectMessages(id: Int) async throws -> [ProjectMessage] {
        try await send("GET", "/projects/\(id)/messages", body: nil)
    }

    func updateProjectNotes(id: Int, notes: String) async throws -> Project {
        try await send("PUT", "/projects/\(id)/notes", body: ["notes": notes])
    }

    func sendProjectMessage(id: Int, text: String) async throws -> ChatReply {
        try await send("POST", "/projects/\(id)/messages", body: ["text": text])
    }
}

extension APIClient {
    func todos(includeDone: Bool = false) async throws -> [Todo] {
        try await send("GET", "/todos", query: includeDone ? ["done": "any"] : nil, body: nil)
    }

    func setTodoPinned(id: Int, pinned: Bool) async throws -> Todo {
        try await send("PATCH", "/todos/\(id)/pin", body: ["pinned": pinned])
    }

    /// Fetches Jira and pull requests now, rather than waiting for the engine's
    /// 5 minute cycle. Deliberately does not analyse new Sentry or GitHub issues.
    func poll() async throws -> PollSummary {
        try await send("POST", "/poll", body: nil)
    }

    func todoMessages(id: Int) async throws -> [TodoMessage] {
        try await send("GET", "/todos/\(id)/messages", body: nil)
    }

    func sendTodoMessage(id: Int, text: String) async throws -> ChatReply {
        try await send("POST", "/todos/\(id)/messages", body: ["text": text])
    }

    func createTodo(text: String, projectId: Int? = nil) async throws -> Todo {
        try await send("POST", "/todos", body: CreateTodoBody(text: text, projectId: projectId))
    }

    func setTodoDone(id: Int, done: Bool) async throws -> Todo {
        try await send("PATCH", "/todos/\(id)", body: TodoUpdate(done: done))
    }

    func setTodoPriority(id: Int, priority: TodoPriority) async throws -> Todo {
        try await send("PATCH", "/todos/\(id)", body: TodoUpdate(priority: priority))
    }

    func promoteTodo(id: Int) async throws -> Ticket {
        try await send("POST", "/todos/\(id)/promote", body: nil)
    }
}

extension APIClient {
    func tickets() async throws -> [Ticket] {
        try await send("GET", "/tickets", body: nil)
    }

    func ticket(id: Int) async throws -> Ticket {
        try await send("GET", "/tickets/\(id)", body: nil)
    }

    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply {
        try await send("POST", "/tickets/\(id)/messages", body: ["text": text])
    }

    func createPr(ticketId: Int) async throws -> FixResult {
        try await send("POST", "/tickets/\(ticketId)/create-pr", body: nil)
    }

    func setTicketPinned(id: Int, pinned: Bool) async throws -> Ticket {
        try await send("PATCH", "/tickets/\(id)/pin", body: ["pinned": pinned])
    }
}

extension APIClient {
    func pullRequests() async throws -> [PullRequest] {
        try await send("GET", "/prs", body: nil)
    }

    func pullRequest(id: Int) async throws -> PullRequest {
        try await send("GET", "/prs/\(id)", body: nil)
    }

    func diff(prId: Int) async throws -> DiffResponse {
        try await send("GET", "/prs/\(prId)/diff", body: nil)
    }

    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult {
        try await send("POST", "/prs/\(id)/messages", body: ["text": text])
    }

    func mergePr(id: Int) async throws -> PrChatResult {
        try await send("POST", "/prs/\(id)/merge", body: nil)
    }

    func setPrPinned(id: Int, pinned: Bool) async throws -> PullRequest {
        try await send("PATCH", "/prs/\(id)/pin", body: ["pinned": pinned])
    }

    func prDetail(id: Int) async throws -> PrDetail {
        try await send("GET", "/prs/\(id)/detail", body: nil)
    }

    func draftReviewReply(prId: Int, commentId: Int) async throws -> String {
        let reply: ReviewReplyDraft = try await send(
            "POST", "/prs/\(prId)/review-comments/\(commentId)/draft", body: nil
        )
        return reply.draft
    }

    func postReviewReply(prId: Int, commentId: Int, text: String) async throws {
        let _: PostedReviewComment = try await send(
            "POST", "/prs/\(prId)/review-comments/\(commentId)/reply", body: ["text": text]
        )
    }
}
