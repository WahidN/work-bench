struct ProjectMessage: Codable, Identifiable, Equatable {
    let id: Int
    let projectId: Int
    let role: ChatRole
    let content: String
    let createdAt: String
}
