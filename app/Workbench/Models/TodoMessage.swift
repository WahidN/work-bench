struct TodoMessage: Codable, Identifiable, Equatable {
    let id: Int
    let todoId: Int
    let role: ChatRole
    let content: String
    let createdAt: String
}
