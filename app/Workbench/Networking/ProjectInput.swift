struct ProjectInput: Encodable {
    var name: String
    var repoPath: String
    var defaultBranch: String
    var githubRepo: String?
    var jiraProjectKey: String?
    var sentryProjectSlug: String?
}

struct ProjectUpdate: Encodable {
    var name: String?
    var repoPath: String?
    var defaultBranch: String?
    var githubRepo: String?
    var jiraProjectKey: String?
    var sentryProjectSlug: String?
}
