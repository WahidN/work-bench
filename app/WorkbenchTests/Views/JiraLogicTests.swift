import Testing
import SwiftUI
@testable import Workbench

private let projects = [
    Project(id: 1, name: "Atlas Payments", repoPath: "/repos/atlas", defaultBranch: "main",
            githubRepo: "acme/atlas", jiraProjectKey: "ACV", sentryProjectSlug: nil)
]

private func jiraTodo(
    id: Int,
    key: String = "MR",
    number: Int = 1,
    title: String? = nil,
    promotedTicketId: Int? = nil,
    canPromote: Bool = true,
    pinned: Bool = false,
    projectId: Int? = nil,
    done: Bool = false
) -> Todo {
    var todo = Todo(
        id: id, source: .jira, sourceId: "JIRA-\(key)-\(number)",
        text: title ?? "[\(key)-\(number)] Fix the importer", body: "",
        url: "https://x/browse/\(key)-\(number)", projectId: projectId,
        canPromote: canPromote, done: done, promotedTicketId: promotedTicketId,
        createdAt: "2026-08-14T00:00:00.000Z"
    )
    todo.pinned = pinned
    return todo
}

private func manualTodo(id: Int) -> Todo {
    Todo(id: id, source: .manual, sourceId: nil, text: "cut the release branch", body: "",
         url: nil, projectId: nil, canPromote: false, done: false, promotedTicketId: nil,
         createdAt: "2026-08-14T00:00:00.000Z")
}

private func ticket(id: Int, status: TicketStatus, prId: Int? = nil) -> Ticket {
    Ticket(id: id, source: .jira, sourceId: "JIRA-MR-1", projectId: 1, title: "Fix the importer",
           body: "b", url: "u", analysis: nil, status: status, prId: prId,
           createdAt: "2026-08-14T00:00:00.000Z")
}

@Test func projectKeyComesFromTheIssueRef() {
    #expect(JiraLogic.projectKey(for: jiraTodo(id: 1, key: "JOBQ", number: 42)) == "JOBQ")
}

@Test func projectKeyIsNilForAManualTask() {
    #expect(JiraLogic.projectKey(for: manualTodo(id: 1)) == nil)
}

@Test func groupsAreSortedByUnpromotedCountThenKey() {
    let todos = [
        jiraTodo(id: 1, key: "MR"), jiraTodo(id: 2, key: "MR", number: 2),
        jiraTodo(id: 3, key: "RAR"),
        jiraTodo(id: 4, key: "ACV"), jiraTodo(id: 5, key: "ACV", number: 2),
        manualTodo(id: 6)
    ]
    let groups = JiraLogic.groups(todos: todos, projects: projects)

    #expect(groups.map(\.key) == ["ACV", "MR", "RAR"], "two-issue groups first, then alphabetical")
    #expect(groups.map(\.openCount) == [2, 2, 1])
}

@Test func aMappedKeyBorrowsItsProjectNameAndDot() {
    let groups = JiraLogic.groups(todos: [jiraTodo(id: 1, key: "ACV"), jiraTodo(id: 2, key: "MR")], projects: projects)

    let mapped = groups.first { $0.key == "ACV" }!
    #expect(mapped.displayName == "Atlas Payments")
    #expect(mapped.dot == SidebarLogic.projectDotColor(at: 0))

    let bare = groups.first { $0.key == "MR" }!
    #expect(bare.displayName == "MR")
    #expect(bare.dot == Theme.Neutral.n700)
}

@Test func promotedIssuesDoNotInflateTheCount() {
    let groups = JiraLogic.groups(
        todos: [jiraTodo(id: 1, key: "MR"), jiraTodo(id: 2, key: "MR", number: 2, promotedTicketId: 9, done: true)],
        projects: projects
    )

    #expect(groups[0].openCount == 1, "the count is work not yet started")
}

@Test func initialSelectionIsTheBusiestProject() {
    let todos = [jiraTodo(id: 1, key: "RAR"), jiraTodo(id: 2, key: "MR"), jiraTodo(id: 3, key: "MR", number: 2)]
    #expect(JiraLogic.initialSelection(todos: todos) == "MR")
}

@Test func initialSelectionIsNilWithoutJiraTodos() {
    #expect(JiraLogic.initialSelection(todos: [manualTodo(id: 1)]) == nil)
}

@Test func rowsCoverOnlyTheSelectedProjectNewestFirst() {
    let todos = [
        jiraTodo(id: 1, key: "MR", number: 2), jiraTodo(id: 2, key: "MR", number: 12),
        jiraTodo(id: 3, key: "RAR")
    ]
    let rows = JiraLogic.rows(todos: todos, key: "MR", tickets: [])

    #expect(rows.map(\.ref) == ["MR-12", "MR-2"], "sorted by issue number descending, not by string")
}

@Test func anUnpromotedRowOffersPromoteAndNothingElse() {
    let rows = JiraLogic.rows(todos: [jiraTodo(id: 1)], key: "MR", tickets: [])

    #expect(rows[0].showsPromote)
    #expect(rows[0].showsCreatePr == false)
    #expect(rows[0].stateLabel == nil)
    #expect(rows[0].url == "https://x/browse/MR-1")
    #expect(rows[0].isPinned == false)
}

@Test func aRowWithoutAProjectMappingCannotBePromoted() {
    let rows = JiraLogic.rows(todos: [jiraTodo(id: 1, canPromote: false)], key: "MR", tickets: [])

    #expect(rows[0].showsPromote == false, "canPromote is false when no Workbench project maps to the Jira key")
}

@Test func aPromotedRowShowsItsPipelineStateAndOffersCreatePr() {
    let rows = JiraLogic.rows(
        todos: [jiraTodo(id: 1, promotedTicketId: 9, done: true)],
        key: "MR",
        tickets: [ticket(id: 9, status: .sparring)]
    )

    #expect(rows[0].stateLabel == "In progress")
    #expect(rows[0].stateColor == TodayLogic.statusColor(TicketStatus.sparring))
    #expect(rows[0].showsPromote == false, "already promoted")
    #expect(rows[0].showsCreatePr)
    #expect(rows[0].ticketId == 9)
}

@Test func aPromotedRowThatAlreadyHasAPrDoesNotOfferCreatePr() {
    let rows = JiraLogic.rows(
        todos: [jiraTodo(id: 1, promotedTicketId: 9, done: true)],
        key: "MR",
        tickets: [ticket(id: 9, status: .inReview, prId: 4)]
    )

    #expect(rows[0].showsCreatePr == false)
    #expect(rows[0].stateLabel == "In review")
}

@Test func aPromotedRowWhoseTicketIsNotLoadedYetShowsNoState() {
    let rows = JiraLogic.rows(todos: [jiraTodo(id: 1, promotedTicketId: 9, done: true)], key: "MR", tickets: [])

    #expect(rows[0].stateLabel == nil)
    #expect(rows[0].showsCreatePr == false, "never offer an action against a ticket we cannot see")
}

@Test func pinnedStateIsCarriedOntoTheRow() {
    let rows = JiraLogic.rows(todos: [jiraTodo(id: 1, pinned: true)], key: "MR", tickets: [])

    #expect(rows[0].isPinned)
}
