struct TodayItem: Codable, Equatable {
    enum Kind: String, Codable {
        case ticket, pr
    }
    let kind: Kind
    let id: Int
    let title: String
    let status: String
    let reviewScore: Double?

    var uniqueKey: String { "\(kind.rawValue)-\(id)" }
}

struct TodayResponse: Codable, Equatable {
    let needsInput: [TodayItem]
    let todos: [Todo]
}
