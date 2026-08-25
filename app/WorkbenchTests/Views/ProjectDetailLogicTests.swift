import Testing
import SwiftUI
import Foundation
@testable import Workbench

private func project(id: Int, name: String = "Atlas Payments", status: ProjectStatus = .active) -> Project {
    var value = Project(id: id, name: name, repoPath: "/repos/atlas", defaultBranch: "main",
                        githubRepo: "acme/atlas", jiraProjectKey: "ATL", sentryProjectSlug: nil)
    value.status = status
    return value
}

private func manualTodo(
    id: Int, projectId: Int?, done: Bool = false, dueAt: String? = "2026-08-24",
    createdAt: String = "2026-08-24T09:00:00.000Z"
) -> Todo {
    var value = Todo(id: id, source: .manual, sourceId: nil, text: "Task \(id)", body: "",
                     url: nil, projectId: projectId, canPromote: false, done: done,
                     promotedTicketId: nil, createdAt: createdAt)
    value.dueAt = dueAt
    return value
}

private func jiraTodo(id: Int, projectId: Int?, pinned: Bool) -> Todo {
    var value = Todo(id: id, source: .jira, sourceId: "JIRA-ATL-\(id)", text: "[ATL-\(id)] Mirror",
                     body: "", url: nil, projectId: projectId, canPromote: true, done: false,
                     promotedTicketId: nil, createdAt: "2026-08-24T08:00:00.000Z")
    value.pinned = pinned
    return value
}

private func ticket(id: Int, projectId: Int, status: TicketStatus = .new) -> Ticket {
    Ticket(id: id, source: .jira, sourceId: "JIRA-ATL-\(id)", projectId: projectId,
           title: "Broken filter", body: "b", url: "u", analysis: nil, status: status,
           prId: nil, createdAt: "2026-08-24T09:00:00.000Z")
}

private func pullRequest(id: Int, projectId: Int, status: PrStatus = .open, number: Int? = 23) -> PullRequest {
    PullRequest(id: id, ticketId: nil, projectId: projectId, branch: "fix/\(id)", number: number,
                url: nil, status: status, lastReviewScore: nil,
                createdAt: "2026-08-24T09:00:00.000Z", title: "Fix nav", isDraft: false,
                authoredByMe: true, assignedToMe: false, messageCount: 0)
}

private let today = "2026-08-24"
private let noon = ISO8601DateFormatter().date(from: "2026-08-24T12:00:00Z")!

@Test func taskRowsKeepOnlyThisProjectsManualAndPinnedTodos() {
    let rows = ProjectDetailLogic.taskRows(
        todos: [
            manualTodo(id: 1, projectId: 1),
            manualTodo(id: 2, projectId: 2),
            jiraTodo(id: 3, projectId: 1, pinned: false),
            jiraTodo(id: 4, projectId: 1, pinned: true),
            manualTodo(id: 5, projectId: nil)
        ],
        project: project(id: 1), projects: [project(id: 1)], today: today
    )

    // Sorted, because this test is about which todos survive the filter. Order has its own
    // test below, and both of these are un-overdue so they come back oldest-first: todo-4.
    #expect(rows.map(\.id).sorted() == ["todo-1", "todo-4"])
}

@Test func aPinnedIssueRendersAsAPinnedRow() {
    let rows = ProjectDetailLogic.taskRows(
        todos: [jiraTodo(id: 4, projectId: 1, pinned: true)],
        project: project(id: 1), projects: [project(id: 1)], today: today
    )

    #expect(rows[0].tag == TodayLogic.pinnedTag)
    #expect(rows[0].priority == nil)
    #expect(rows[0].ref == "ATL-4")
}

@Test func aManualRowShowsItsDueLabelAndNoPriority() {
    let rows = ProjectDetailLogic.taskRows(
        todos: [manualTodo(id: 1, projectId: 1, dueAt: today)],
        project: project(id: 1), projects: [project(id: 1)], today: today
    )

    #expect(rows[0].tag == "Today")
    #expect(rows[0].priority == nil, "priority belongs to Today's row, not this one")
    #expect(rows[0].ref == nil, "a manual task has no linked ref")
}

@Test func overdueTasksComeFirst() {
    let rows = ProjectDetailLogic.taskRows(
        todos: [
            manualTodo(id: 1, projectId: 1, dueAt: today),
            manualTodo(id: 2, projectId: 1, dueAt: "2026-08-20"),
            manualTodo(id: 3, projectId: 1, done: true)
        ],
        project: project(id: 1), projects: [project(id: 1)], today: today
    )

    #expect(rows.map(\.id) == ["todo-2", "todo-1", "todo-3"])
    #expect(rows[0].tag == "Overdue")
    #expect(rows[2].isDone)
}

@Test func aTaskWithNoDueDateOrAFutureDueDateGetsNoTag() {
    let rows = ProjectDetailLogic.taskRows(
        todos: [
            manualTodo(id: 1, projectId: 1, dueAt: nil),
            // A date after today is not due yet, so it must not render as "Today".
            manualTodo(id: 2, projectId: 1, dueAt: "2026-08-30")
        ],
        project: project(id: 1), projects: [project(id: 1)], today: today
    )

    #expect(rows[0].tag == nil)
    #expect(rows[1].tag == nil, "a future due date is not due yet, so it gets no tag either")
}

@Test func factsCountWhatTheTabLists() {
    let facts = ProjectDetailLogic.facts(
        project: project(id: 1, status: .paused),
        todos: [
            manualTodo(id: 1, projectId: 1),
            jiraTodo(id: 2, projectId: 1, pinned: false),
            manualTodo(id: 3, projectId: 1, done: true),
            jiraTodo(id: 4, projectId: 1, pinned: true)
        ],
        tickets: [ticket(id: 1, projectId: 1)],
        prs: [pullRequest(id: 1, projectId: 1), pullRequest(id: 2, projectId: 1, status: .merged),
              pullRequest(id: 3, projectId: 2)],
        now: noon
    )

    #expect(facts.status == "Paused")
    #expect(facts.openTasks == 2, "the pinned issue counts, but the unpinned Jira mirror and the done task do not")
    #expect(facts.openPrs == 1, "a merged PR and another project's PR are not this project's open work")
    #expect(facts.lastActivity == "3h ago")
}

@Test func factsCountOnlyThisProjectsWork() {
    let facts = ProjectDetailLogic.facts(
        project: project(id: 1),
        todos: [manualTodo(id: 1, projectId: 1), manualTodo(id: 2, projectId: 2)],
        tickets: [],
        prs: [pullRequest(id: 1, projectId: 1), pullRequest(id: 2, projectId: 2)],
        now: noon
    )

    #expect(facts.openTasks == 1, "another project's manual task must not be counted here")
    #expect(facts.openPrs == 1, "another project's open pull request must not be counted here")
}

@Test func openWorkListsPullRequestsThenIssues() {
    let untitledPr = PullRequest(id: 4, ticketId: nil, projectId: 1, branch: "fix/4", number: 30,
                                  url: nil, status: .open, lastReviewScore: nil,
                                  createdAt: "2026-08-24T09:00:00.000Z", title: "", isDraft: false,
                                  authoredByMe: true, assignedToMe: false, messageCount: 0)
    let items = ProjectDetailLogic.openWork(
        project: project(id: 1),
        tickets: [ticket(id: 7, projectId: 1), ticket(id: 8, projectId: 1, status: .done),
                  ticket(id: 9, projectId: 2)],
        prs: [pullRequest(id: 1, projectId: 1), pullRequest(id: 2, projectId: 1, status: .merged),
              pullRequest(id: 3, projectId: 2), untitledPr]
    )

    #expect(items.map(\.id) == ["pr-1", "pr-4", "ticket-7"])
    #expect(items[0].ref == "atlas#23")
    #expect(items[0].title == "Fix nav")
    #expect(items[1].title == items[1].ref, "an untitled PR falls back to its ref rather than showing an empty title")
    #expect(items[2].ref == "ATL-7")
    #expect(items[2].title == "Broken filter")
    #expect(items[0].symbol == TodayLogic.pullRequestSymbol)
    #expect(items[2].symbol == TodayLogic.issueSymbol)
}

@Test func aPullRequestWithoutANumberFallsBackToItsBranch() {
    let items = ProjectDetailLogic.openWork(
        project: project(id: 1), tickets: [],
        prs: [pullRequest(id: 1, projectId: 1, number: nil)]
    )

    #expect(items[0].ref == "fix/1")
}
