struct JiraSite: Codable, Identifiable, Equatable {
    let id: String
    let url: String
    let name: String
}

struct JiraConnection: Codable, Equatable {
    let hasClientCredentials: Bool
    let connected: Bool
    let siteUrl: String?
    let siteName: String?
    /// Non-empty only while a site still has to be chosen.
    let availableSites: [JiraSite]
    /// The exact value to paste into the Atlassian console.
    let callbackUrl: String
}

/// Internal rather than file-private: APIClient lives in another file and decodes both.
struct AuthorizeUrlResponse: Decodable {
    let url: String
}

struct OkResponse: Decodable {
    let ok: Bool
}
