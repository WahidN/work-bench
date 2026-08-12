import Foundation

final class APIClient {
    static let baseURL = URL(string: "http://127.0.0.1:4173")!

    private let session: URLSession
    private let keychain: KeychainClient

    init(session: URLSession = .shared, keychain: KeychainClient = KeychainClient()) {
        self.session = session
        self.keychain = keychain
    }

    private func makeRequest(_ method: String, _ path: String, body: Encodable?) throws -> URLRequest {
        guard let token = try keychain.readSecret(account: "api-token") else {
            throw APIError.transportFailed("No Workbench engine token found in Keychain. Is the engine running?")
        }
        var request = URLRequest(url: Self.baseURL.appendingPathComponent(path))
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

    func send<Response: Decodable>(_ method: String, _ path: String, body: Encodable?) async throws -> Response {
        let request = try makeRequest(method, path, body: body)
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
