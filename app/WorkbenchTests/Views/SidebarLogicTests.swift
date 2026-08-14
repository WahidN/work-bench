import Testing
import SwiftUI
@testable import Workbench

private func todo(id: Int, projectId: Int?, done: Bool) -> Todo {
    Todo(id: id, source: .manual, sourceId: nil, text: "t\(id)", body: "", url: nil,
         projectId: projectId, canPromote: false, done: done, promotedTicketId: nil,
         createdAt: "2026-08-13T00:00:00.000Z")
}

private func pr(id: Int) -> PullRequest {
    PullRequest(id: id, ticketId: 1, projectId: 1, branch: "fix/\(id)", number: id,
                url: nil, status: .open, lastReviewScore: nil, createdAt: "2026-08-13T00:00:00.000Z")
}

@Test func navCountForTodayCountsOnlyIncompleteTodos() {
    let todos = [todo(id: 1, projectId: 1, done: false), todo(id: 2, projectId: 1, done: true)]
    #expect(SidebarLogic.navCount(for: .today, todos: todos, jiraTodos: [], tickets: [], prs: [], projects: []) == 1)
}

@Test func navCountForProjectsCountsAllProjects() {
    let projects = [
        Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil),
        Project(id: 2, name: "b", repoPath: "/b", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    ]
    #expect(SidebarLogic.navCount(for: .projects, todos: [], jiraTodos: [], tickets: [], prs: [], projects: projects) == 2)
}

@Test func navCountForPullRequestsCountsAllPRs() {
    let prs = [pr(id: 1), pr(id: 2)]
    #expect(SidebarLogic.navCount(for: .pullRequests, todos: [], jiraTodos: [], tickets: [], prs: prs, projects: []) == 2)
}

@Test func navCountForJiraCountsUnpromotedJiraIssues() {
    var promoted = Todo(id: 2, source: .jira, sourceId: "JIRA-MR-2", text: "[MR-2] Rotate keys", body: "",
                        url: nil, projectId: nil, canPromote: true, done: true, promotedTicketId: 9,
                        createdAt: "2026-08-14T00:00:00.000Z")
    promoted.pinned = false
    let open = Todo(id: 1, source: .jira, sourceId: "JIRA-MR-1", text: "[MR-1] Fix the importer", body: "",
                    url: nil, projectId: nil, canPromote: true, done: false, promotedTicketId: nil,
                    createdAt: "2026-08-14T00:00:00.000Z")

    let count = SidebarLogic.navCount(
        for: .issues, todos: [], jiraTodos: [open, promoted], tickets: [], prs: [], projects: []
    )

    #expect(count == 1, "the count is Jira work not yet started, not the ticket count")
}

@Test func projectOpenCountCountsOnlyIncompleteTodosForThatProject() {
    let project = Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    let todos = [
        todo(id: 1, projectId: 1, done: false),
        todo(id: 2, projectId: 1, done: true),
        todo(id: 3, projectId: 2, done: false)
    ]
    #expect(SidebarLogic.projectOpenCount(for: project, todos: todos) == 1)
}

@Test func projectDotColorWrapsAroundThePalette() {
    #expect(SidebarLogic.projectDotColor(at: 0) == Theme.projectDotColors[0])
    #expect(SidebarLogic.projectDotColor(at: 8) == Theme.projectDotColors[0])
    #expect(SidebarLogic.projectDotColor(at: 9) == Theme.projectDotColors[1])
}

@Test func accountInitialsFromTwoWordName() {
    #expect(SidebarLogic.accountInitials(from: "Wahid Linku") == "WL")
}

@Test func accountInitialsFromSingleWordName() {
    #expect(SidebarLogic.accountInitials(from: "Wahid") == "WA")
}

@Test func accountInitialsFromEmptyName() {
    #expect(SidebarLogic.accountInitials(from: "") == "")
}

@Test func isProjectSelectedTrueWhenIdsMatch() {
    let project = Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    let selected = Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    #expect(SidebarLogic.isProjectSelected(project, selectedProject: selected) == true)
}

@Test func isProjectSelectedFalseWhenIdsDiffer() {
    let project = Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    let selected = Project(id: 2, name: "b", repoPath: "/b", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    #expect(SidebarLogic.isProjectSelected(project, selectedProject: selected) == false)
}

@Test func isProjectSelectedFalseWhenSelectedProjectIsNil() {
    let project = Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    #expect(SidebarLogic.isProjectSelected(project, selectedProject: nil) == false)
}
