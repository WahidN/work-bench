enum ProjectStatus: String, Codable {
    case active, paused, planning
}

struct Project: Codable, Identifiable, Equatable {
    let id: Int
    var name: String
    var repoPath: String
    var defaultBranch: String
    var githubRepo: String?
    var jiraProjectKey: String?
    var sentryProjectSlug: String?
    var status: ProjectStatus = .active
    var blurb: String = ""
    var notes: String = ""
}
