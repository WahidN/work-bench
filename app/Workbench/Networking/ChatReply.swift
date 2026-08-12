struct ChatReply: Decodable {
    let reply: String
}

struct FixResult: Decodable {
    let ticketStatus: TicketStatus
    let prId: Int
}
