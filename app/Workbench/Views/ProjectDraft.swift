struct ProjectDraft {
    var name = ""
    var repoPath = ""
    var defaultBranch = "main"
    var githubRepo = ""
    var jiraProjectKey = ""
    var sentryProjectSlug = ""

    init() {}

    init(project: Project) {
        name = project.name
        repoPath = project.repoPath
        defaultBranch = project.defaultBranch
        githubRepo = project.githubRepo ?? ""
        jiraProjectKey = project.jiraProjectKey ?? ""
        sentryProjectSlug = project.sentryProjectSlug ?? ""
    }

    func asInput() -> ProjectInput {
        ProjectInput(
            name: name, repoPath: repoPath, defaultBranch: defaultBranch,
            githubRepo: githubRepo.isEmpty ? nil : githubRepo,
            jiraProjectKey: jiraProjectKey.isEmpty ? nil : jiraProjectKey,
            sentryProjectSlug: sentryProjectSlug.isEmpty ? nil : sentryProjectSlug
        )
    }

    func asUpdate() -> ProjectUpdate {
        ProjectUpdate(
            name: name, repoPath: repoPath, defaultBranch: defaultBranch,
            githubRepo: githubRepo.isEmpty ? nil : githubRepo,
            jiraProjectKey: jiraProjectKey.isEmpty ? nil : jiraProjectKey,
            sentryProjectSlug: sentryProjectSlug.isEmpty ? nil : sentryProjectSlug
        )
    }
}
