import Testing
import SwiftUI
import Foundation
@testable import Workbench

private func project(
    id: Int,
    name: String = "Atlas Payments",
    status: ProjectStatus = .active,
    blurb: String = "Card capture rewrite."
) -> Project {
    var value = Project(id: id, name: name, repoPath: "/repos/atlas", defaultBranch: "main",
                        githubRepo: "acme/atlas", jiraProjectKey: "ATL", sentryProjectSlug: nil)
    value.status = status
    value.blurb = blurb
    return value
}

private func todo(id: Int, projectId: Int?, done: Bool = false, createdAt: String = "2026-08-17T09:00:00.000Z") -> Todo {
    Todo(id: id, source: .jira, sourceId: "JIRA-ATL-\(id)", text: "[ATL-\(id)] Fix it", body: "",
         url: nil, projectId: projectId, canPromote: true, done: done, promotedTicketId: nil,
         createdAt: createdAt)
}

private func ticket(id: Int, projectId: Int, createdAt: String = "2026-08-17T09:00:00.000Z") -> Ticket {
    Ticket(id: id, source: .jira, sourceId: "JIRA-ATL-\(id)", projectId: projectId, title: "t",
           body: "b", url: "u", analysis: nil, status: .new, prId: nil, createdAt: createdAt)
}

private func pullRequest(id: Int, projectId: Int, status: PrStatus = .open, createdAt: String = "2026-08-17T09:00:00.000Z") -> PullRequest {
    PullRequest(id: id, ticketId: id, projectId: projectId, branch: "fix/\(id)", number: id,
                url: nil, status: status, lastReviewScore: nil, createdAt: createdAt)
}

private let noon = ISO8601DateFormatter().date(from: "2026-08-17T12:00:00Z")!

@Test func statusLabelsAreCapitalised() {
    #expect(ProjectsLogic.statusLabel(.active) == "Active")
    #expect(ProjectsLogic.statusLabel(.paused) == "Paused")
    #expect(ProjectsLogic.statusLabel(.planning) == "Planning")
}

@Test func activeCountCountsOnlyActiveProjects() {
    let projects = [project(id: 1), project(id: 2, status: .paused), project(id: 3, status: .planning)]
    #expect(ProjectsLogic.activeCount(projects) == 1)
}

@Test func relativeTimeUsesTheMockupsScale() {
    let formatter = ISO8601DateFormatter()
    #expect(ProjectsLogic.relativeTime(from: formatter.date(from: "2026-08-17T11:59:30Z")!, to: noon) == "just now")
    #expect(ProjectsLogic.relativeTime(from: formatter.date(from: "2026-08-17T11:30:00Z")!, to: noon) == "30m ago")
    #expect(ProjectsLogic.relativeTime(from: formatter.date(from: "2026-08-17T10:00:00Z")!, to: noon) == "2h ago")
    #expect(ProjectsLogic.relativeTime(from: formatter.date(from: "2026-08-16T11:00:00Z")!, to: noon) == "yesterday")
    #expect(ProjectsLogic.relativeTime(from: formatter.date(from: "2026-08-14T12:00:00Z")!, to: noon) == "3d ago")
    #expect(ProjectsLogic.relativeTime(from: formatter.date(from: "2026-08-10T12:00:00Z")!, to: noon) == "1w ago")
}

@Test func cardsCarryTheProjectsOwnFields() {
    let cards = ProjectsLogic.cards(
        projects: [project(id: 1, name: "Atlas Payments", status: .paused, blurb: "Card capture rewrite.")],
        todos: [], tickets: [], prs: [], now: noon
    )

    #expect(cards.count == 1)
    #expect(cards[0].id == 1)
    #expect(cards[0].name == "Atlas Payments")
    #expect(cards[0].statusLabel == "Paused")
    #expect(cards[0].blurb == "Card capture rewrite.")
    #expect(cards[0].dot == SidebarLogic.projectDotColor(at: 0))
}

@Test func openCountIsTheProjectsUnfinishedTodosOfAnySource() {
    let cards = ProjectsLogic.cards(
        projects: [project(id: 1), project(id: 2, name: "Relay")],
        todos: [
            todo(id: 1, projectId: 1),
            todo(id: 2, projectId: 1, done: true),
            todo(id: 3, projectId: 2),
            todo(id: 4, projectId: nil)
        ],
        tickets: [], prs: [], now: noon
    )

    #expect(cards[0].openCount == 1, "done todos and other projects' todos do not count")
    #expect(cards[1].openCount == 1)
}

@Test func prCountExcludesMergedPullRequests() {
    let cards = ProjectsLogic.cards(
        projects: [project(id: 1)],
        todos: [],
        tickets: [],
        prs: [
            pullRequest(id: 1, projectId: 1),
            pullRequest(id: 2, projectId: 1, status: .merged),
            pullRequest(id: 3, projectId: 1, status: .needsAttention)
        ],
        now: noon
    )

    #expect(cards[0].prCount == 2, "open and needs-attention both count, only merged is excluded")
}

@Test func prCountLabelPluralisesOnlyBeyondOne() {
    #expect(ProjectsLogic.prCountLabel(0) == "0 PRs")
    #expect(ProjectsLogic.prCountLabel(1) == "1 PR")
    #expect(ProjectsLogic.prCountLabel(2) == "2 PRs")
}

@Test func emptyStateTextIsTheExactCopy() {
    #expect(ProjectsLogic.emptyStateText == "No projects yet. Add one to get started.")
}

@Test func activityIsTheMostRecentTimestampAcrossEverythingTheProjectOwns() {
    let cards = ProjectsLogic.cards(
        projects: [project(id: 1)],
        todos: [todo(id: 1, projectId: 1, createdAt: "2026-08-10T12:00:00.000Z")],
        tickets: [ticket(id: 1, projectId: 1, createdAt: "2026-08-16T11:00:00.000Z")],
        prs: [pullRequest(id: 1, projectId: 1, createdAt: "2026-08-17T10:00:00.000Z")],
        now: noon
    )

    #expect(cards[0].activity == "2h ago", "the PR is the newest of the three")
}

@Test func activitySaysSoWhenAProjectHasNothingYet() {
    let cards = ProjectsLogic.cards(projects: [project(id: 1)], todos: [], tickets: [], prs: [], now: noon)

    #expect(cards[0].activity == "no activity yet")
}

@Test func cardsKeepTheProjectsListOrderSoDotsMatchTheSidebar() {
    let cards = ProjectsLogic.cards(
        projects: [project(id: 5, name: "Beacon"), project(id: 9, name: "Compass")],
        todos: [], tickets: [], prs: [], now: noon
    )

    #expect(cards.map(\.id) == [5, 9])
    #expect(cards[1].dot == SidebarLogic.projectDotColor(at: 1))
}
