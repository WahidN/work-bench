import Foundation

public struct PullRequest: Decodable, Identifiable, Equatable, Sendable {
  public var url: String
  public var number: Int
  public var title: String
  public var repo: String
  public var author: String
  public var reasons: [String]
  public var commented: Bool

  public var id: String { url }
  public var shortRepo: String { repo.split(separator: "/").last.map(String.init) ?? repo }

  public init(url: String, number: Int, title: String, repo: String, author: String, reasons: [String], commented: Bool) {
    self.url = url
    self.number = number
    self.title = title
    self.repo = repo
    self.author = author
    self.reasons = reasons
    self.commented = commented
  }

  enum CodingKeys: String, CodingKey {
    case url, number, title, repo, author, reasons, commented
  }

  public init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    url = try values.decode(String.self, forKey: .url)
    number = try values.decode(Int.self, forKey: .number)
    title = try values.decode(String.self, forKey: .title)
    repo = try values.decode(String.self, forKey: .repo)
    author = try values.decode(String.self, forKey: .author)
    reasons = try values.decode([String].self, forKey: .reasons)
    // The list leaves the marker out when its search failed.
    commented = try values.decodeIfPresent(Bool.self, forKey: .commented) ?? false
  }
}

public func readPullRequests(_ data: Data) throws -> [PullRequest] {
  try JSONDecoder().decode([PullRequest].self, from: data)
}
