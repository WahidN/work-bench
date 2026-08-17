struct ProjectDraft {
    var name = ""
    var repoPath = ""
    var defaultBranch = "main"
    var githubRepo = ""
    var jiraProjectKey = ""
    var sentryProjectSlug = ""
    var status: ProjectStatus = .active
    var blurb = ""

    init() {}

    init(project: Project) {
        name = project.name
        repoPath = project.repoPath
        defaultBranch = project.defaultBranch
        githubRepo = project.githubRepo ?? ""
        jiraProjectKey = project.jiraProjectKey ?? ""
        sentryProjectSlug = project.sentryProjectSlug ?? ""
        status = project.status
        blurb = project.blurb
    }

    func asInput() -> ProjectInput {
        ProjectInput(
            name: name, repoPath: repoPath, defaultBranch: defaultBranch,
            githubRepo: githubRepo.isEmpty ? nil : githubRepo,
            jiraProjectKey: jiraProjectKey.isEmpty ? nil : jiraProjectKey,
            sentryProjectSlug: sentryProjectSlug.isEmpty ? nil : sentryProjectSlug,
            status: status, blurb: blurb
        )
    }

    func asUpdate() -> ProjectUpdate {
        ProjectUpdate(
            name: name, repoPath: repoPath, defaultBranch: defaultBranch,
            githubRepo: githubRepo.isEmpty ? nil : githubRepo,
            jiraProjectKey: jiraProjectKey.isEmpty ? nil : jiraProjectKey,
            sentryProjectSlug: sentryProjectSlug.isEmpty ? nil : sentryProjectSlug,
            status: status, blurb: blurb
        )
    }
}
