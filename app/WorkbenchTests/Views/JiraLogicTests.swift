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

/// A row carrying a status, built the same way the screen builds rows.
private func statusRow(
    _ number: Int,
    _ statusName: String?,
    _ statusCategory: String?
) -> JiraRow {
    var todo = jiraTodo(id: number, number: number)
    todo.statusName = statusName
    todo.statusCategory = statusCategory
    return JiraLogic.rows(todos: [todo], key: "MR", tickets: [])[0]
}

@Test func statusGroupsOrderInProgressAboveToDoAboveDone() {
    let groups = JiraLogic.statusGroups(rows: [
        statusRow(1, "Done", "done"),
        statusRow(2, "To Do", "todo"),
        statusRow(3, "In Progress", "in_progress"),
    ])

    #expect(groups.map(\.label) == ["In Progress", "To Do", "Done"])
    #expect(groups.map(\.count) == [1, 1, 1])
}

@Test func statusGroupsOrderWithinACategoryByDescendingCount() {
    let groups = JiraLogic.statusGroups(rows: [
        statusRow(1, "In Review", "in_progress"),
        statusRow(2, "Blocked", "in_progress"),
        statusRow(3, "Blocked", "in_progress"),
        statusRow(4, "To Do", "todo"),
    ])

    #expect(groups.map(\.label) == ["Blocked", "In Review", "To Do"])
    #expect(groups.map(\.count) == [2, 1, 1])
}

@Test func statusGroupsBreakACountTieAlphabetically() {
    let groups = JiraLogic.statusGroups(rows: [
        statusRow(1, "Ready for test", "in_progress"),
        statusRow(2, "Blocked", "in_progress"),
    ])

    #expect(groups.map(\.label) == ["Blocked", "Ready for test"])
}

@Test func statusGroupsCollapseToOneWhenEveryIssueSharesAStatus() {
    let groups = JiraLogic.statusGroups(rows: [
        statusRow(1, "Done", "done"),
        statusRow(2, "Done", "done"),
        statusRow(3, "Done", "done"),
    ])

    #expect(groups.count == 1)
    #expect(groups[0].label == "Done")
    #expect(groups[0].count == 3)
    #expect(groups[0].rows.count == 3)
}

@Test func statusGroupsAreEmptyWithoutRows() {
    #expect(JiraLogic.statusGroups(rows: []).isEmpty)
}

// Every issue mirrored before statuses were recorded has none until the next poll.
// Dropping those rows would hide the entire screen's contents.
@Test func statusGroupsKeepIssuesWhoseStatusIsUnknown() {
    let groups = JiraLogic.statusGroups(rows: [
        statusRow(1, nil, nil),
        statusRow(2, nil, nil),
    ])

    #expect(groups.count == 1)
    #expect(groups[0].label == JiraLogic.unknownStatusLabel)
    #expect(groups[0].count == 2)
}

@Test func statusGroupsPutTheUnknownGroupLast() {
    let groups = JiraLogic.statusGroups(rows: [
        statusRow(1, nil, nil),
        statusRow(2, "Done", "done"),
        statusRow(3, "In Progress", "in_progress"),
    ])

    #expect(groups.map(\.label) == ["In Progress", "Done", JiraLogic.unknownStatusLabel])
}

// A named status whose category is not one of the three known tokens keeps its name
// but sorts after done, rather than being guessed into the active bucket.
@Test func statusGroupsSortAnUnrecognisedCategoryAfterDone() {
    let groups = JiraLogic.statusGroups(rows: [
        statusRow(1, "Odd", "something-else"),
        statusRow(2, "Done", "done"),
    ])

    #expect(groups.map(\.label) == ["Done", "Odd"])
}

@Test func statusGroupsKeepEveryRowExactlyOnce() {
    let rows = [
        statusRow(1, "In Progress", "in_progress"),
        statusRow(2, "Done", "done"),
        statusRow(3, nil, nil),
        statusRow(4, "In Progress", "in_progress"),
    ]

    let groups = JiraLogic.statusGroups(rows: rows)

    #expect(groups.reduce(0) { $0 + $1.count } == rows.count)
    #expect(Set(groups.flatMap { $0.rows.map(\.id) }) == Set(rows.map(\.id)))
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

@Test func aPromotableStatusWithAnExistingPrStillDoesNotOfferCreatePr() {
    let rows = JiraLogic.rows(
        todos: [jiraTodo(id: 1, promotedTicketId: 9, done: true)],
        key: "MR",
        tickets: [ticket(id: 9, status: .sparring, prId: 4)]
    )

    #expect(rows[0].showsCreatePr == false, "a PR already exists, even though the status alone would allow one")
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

@Test func thePinIsHiddenOnceARowIsPromoted() {
    let unpromoted = JiraLogic.rows(todos: [jiraTodo(id: 1)], key: "MR", tickets: [])
    #expect(unpromoted[0].showsPin)

    let promoted = JiraLogic.rows(
        todos: [jiraTodo(id: 1, promotedTicketId: 9, done: true)],
        key: "MR",
        tickets: [ticket(id: 9, status: .sparring)]
    )
    #expect(promoted[0].showsPin == false, "a promoted issue's ticket is pinnable from Today instead")
}
