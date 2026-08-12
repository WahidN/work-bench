import Foundation

enum APIError: Error, LocalizedError, Equatable {
    case unauthorized
    case badRequest(String)
    case notFound(String)
    case conflict(String)
    case serverError(String)
    case decodingFailed(String)
    case transportFailed(String)
    case unexpectedStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Not authorized. Check the Workbench engine is running."
        case .badRequest(let message), .notFound(let message), .conflict(let message), .serverError(let message):
            return message
        case .decodingFailed(let message):
            return "Could not understand the engine's response: \(message)"
        case .transportFailed(let message):
            return "Could not reach the Workbench engine: \(message)"
        case .unexpectedStatus(let code, let message):
            return "Unexpected response (\(code)): \(message)"
        }
    }
}

struct APIErrorBody: Decodable {
    let error: String
}
