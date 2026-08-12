enum PrChatAction: String, Decodable {
    case revised, merged
}

struct PrChatResult: Decodable {
    let action: PrChatAction
    let reply: String
}

struct DiffResponse: Decodable {
    let diff: String
}
