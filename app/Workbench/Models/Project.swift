struct Project: Codable, Identifiable, Equatable {
    let id: Int
    var name: String
    var repoPath: String
    var defaultBranch: String
    var githubRepo: String?
    var jiraProjectKey: String?
    var sentryProjectSlug: String?
}
