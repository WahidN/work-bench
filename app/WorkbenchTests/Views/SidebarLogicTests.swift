import Testing
import SwiftUI
@testable import Workbench

private func todo(id: Int, projectId: Int?, done: Bool) -> Todo {
    Todo(id: id, source: .manual, sourceId: nil, text: "t\(id)", body: "", url: nil,
         projectId: projectId, canPromote: false, done: done, promotedTicketId: nil,
         createdAt: "2026-08-13T00:00:00.000Z")
}

@Test func navCountForTodayCountsOnlyIncompleteTodos() {
    let todos = [todo(id: 1, projectId: 1, done: false), todo(id: 2, projectId: 1, done: true)]
    #expect(SidebarLogic.navCount(for: .today, todos: todos, tickets: [], prs: [], projects: []) == 1)
}

@Test func navCountForProjectsCountsAllProjects() {
    let projects = [
        Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil),
        Project(id: 2, name: "b", repoPath: "/b", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    ]
    #expect(SidebarLogic.navCount(for: .projects, todos: [], tickets: [], prs: [], projects: projects) == 2)
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
