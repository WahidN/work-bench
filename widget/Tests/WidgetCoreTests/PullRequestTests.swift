import Foundation
import Testing

@testable import WidgetCore

@Test func `reads the pull requests that bun src/cli.ts prs prints`() throws {
  let json = """
    [{"url":"https://github.com/WahidN/work-bench/pull/39","number":39,"title":"Add comments, fix context and PR link",
      "repo":"WahidN/work-bench","author":"WahidN","updatedAt":"2026-10-05T09:00:00Z","reasons":["assigned"],"commented":true},
     {"url":"https://github.com/LinkuNijmegen/inkt-app/pull/8","number":8,"title":"Replace Linku lint configs",
      "repo":"LinkuNijmegen/inkt-app","author":"WahidN","updatedAt":"2026-10-04T09:00:00Z","reasons":["assigned","review"]}]
    """
  let prs = try readPullRequests(Data(json.utf8))

  #expect(prs.count == 2)
  #expect(prs[0].shortRepo == "work-bench")
  #expect(prs[0].commented)
  #expect(!prs[1].commented)
  #expect(prs[1].reasons == ["assigned", "review"])
}

@Test func `a run outside a terminal still finds bun, gh and claude`() {
  let path = searchPath(home: "/Users/wahid", current: "/usr/bin:/bin")
  #expect(path == "/opt/homebrew/bin:/Users/wahid/.bun/bin:/Users/wahid/.local/bin:/usr/bin:/bin")
}

@Test func `the search path keeps each folder once`() {
  let path = searchPath(home: "/Users/wahid", current: "/opt/homebrew/bin:/usr/bin")
  #expect(path == "/opt/homebrew/bin:/Users/wahid/.bun/bin:/Users/wahid/.local/bin:/usr/bin")
}
