import Testing
import Foundation
@testable import Workbench

private let projects = [
    Project(id: 1, name: "Atlas Payments", repoPath: "/repos/atlas", defaultBranch: "main",
            githubRepo: "acme/atlas", jiraProjectKey: "ATL", sentryProjectSlug: nil),
    Project(id: 2, name: "Relay", repoPath: "/repos/relay", defaultBranch: "main",
            githubRepo: "acme/relay", jiraProjectKey: "REL", sentryProjectSlug: nil)
]

private func todo(
    id: Int = 1,
    text: String = "Cut the release branch",
    projectId: Int? = 1,
    done: Bool = false,
    priority: TodoPriority = .med,
    dueAt: String? = "2026-08-14",
    source: TodoSource = .manual,
    sourceId: String? = nil
) -> Todo {
    var value = Todo(id: id, source: source, sourceId: sourceId, text: text, body: "", url: nil,
                     projectId: projectId, canPromote: false, done: done, promotedTicketId: nil,
                     createdAt: "2026-08-13T00:00:00.000Z")
    value.priority = priority
    value.dueAt = dueAt
    return value
}

private func ticket(
    id: Int = 10,
    title: String = "Refunds double-charge on retry",
    status: TicketStatus = .new,
    pinned: Bool = false,
    projectId: Int = 1,
    createdAt: String = "2026-08-13T09:00:00.000Z"
) -> Ticket {
    var value = Ticket(id: id, source: .jira, sourceId: "JIRA-ATL-441", projectId: projectId, title: title,
                       body: "b", url: "u", analysis: nil, status: status, prId: nil, createdAt: createdAt)
    value.pinned = pinned
    return value
}

private func pullRequest(
    id: Int = 20,
    ticketId: Int = 10,
    number: Int? = 1284,
    status: PrStatus = .open,
    pinned: Bool = false,
    projectId: Int = 1,
    createdAt: String = "2026-08-13T09:00:00.000Z"
) -> PullRequest {
    var value = PullRequest(id: id, ticketId: ticketId, projectId: projectId, branch: "fix/atl-441",
                            number: number, url: nil, status: status, lastReviewScore: nil, createdAt: createdAt)
    value.pinned = pinned
    return value
}

// TodayLogic is pure and has no actor isolation, so these suites need no @MainActor.
// They are grouped into three suites (unlike the flat @Test funcs in SidebarLogicTests)
// only because there are enough of them that the grouping reads better.
@Suite
struct TodayLogicSectionTests {
    @Test func splitsOverdueFromTodayByDueDate() {
        let sections = TodayLogic.sections(
            todos: [todo(id: 1, dueAt: "2026-08-12"), todo(id: 2, dueAt: "2026-08-14")],
            pinnedTickets: [], pinnedPullRequests: [], tickets: [], projects: projects, today: "2026-08-14"
        )

        #expect(sections.map(\.label) == ["Overdue", "Today"])
        #expect(sections[0].rows.map(\.id) == ["todo-1"])
        #expect(sections[1].rows.map(\.id) == ["todo-2"])
    }

    @Test func treatsAMissingDueDateAsToday() {
        let sections = TodayLogic.sections(
            todos: [todo(id: 1, dueAt: nil)],
            pinnedTickets: [], pinnedPullRequests: [], tickets: [], projects: projects, today: "2026-08-14"
        )

        #expect(sections.map(\.label) == ["Today"])
    }

    @Test func keepsTheTodaySectionEvenWithNoTasks() {
        let sections = TodayLogic.sections(
            todos: [], pinnedTickets: [], pinnedPullRequests: [], tickets: [], projects: projects, today: "2026-08-14"
        )

        #expect(sections.map(\.label) == ["Today"])
        #expect(sections[0].rows.isEmpty)
    }

    @Test func showsDoneTasksInTheirOwnSectionWithoutAPriority() {
        let sections = TodayLogic.sections(
            todos: [todo(id: 1, done: true, priority: .high)],
            pinnedTickets: [], pinnedPullRequests: [], tickets: [], projects: projects, today: "2026-08-14"
        )

        #expect(sections.map(\.label) == ["Today", "Done"])
        let doneRow = sections[1].rows[0]
        #expect(doneRow.isDone)
        #expect(doneRow.priority == nil, "a completed row hides its priority")
    }

    @Test func rendersPinnedItemsAsPseudoTasksAtTheTopOfToday() {
        let linked = ticket(id: 10, title: "Refunds double-charge on retry", pinned: true)
        let sections = TodayLogic.sections(
            todos: [todo(id: 1)],
            pinnedTickets: [linked],
            pinnedPullRequests: [pullRequest(id: 20, ticketId: 10, pinned: true)],
            tickets: [linked], projects: projects, today: "2026-08-14"
        )

        let today = sections[0]
        #expect(today.rows.map(\.id) == ["ticket-10", "pr-20", "todo-1"])
        #expect(today.rows[0].tag == "Pinned")
        #expect(today.rows[0].ref == "ATL-441")
        #expect(today.rows[1].ref == "atlas#1284")
        #expect(today.rows[1].title == "Refunds double-charge on retry", "a PR borrows its linked issue's title")
        #expect(today.rows[0].priority == nil)
        #expect(today.count == 3)
    }

    @Test func tagsAMirroredJiraTaskAndShowsItsRef() {
        let sections = TodayLogic.sections(
            todos: [todo(id: 1, source: .jira, sourceId: "JIRA-ATL-441")],
            pinnedTickets: [], pinnedPullRequests: [], tickets: [], projects: projects, today: "2026-08-14"
        )

        #expect(sections[0].rows[0].tag == "Jira")
        #expect(sections[0].rows[0].ref == "ATL-441")
    }

    @Test func fallsBackWhenATaskHasNoProject() {
        let sections = TodayLogic.sections(
            todos: [todo(id: 1, projectId: nil)],
            pinnedTickets: [], pinnedPullRequests: [], tickets: [], projects: projects, today: "2026-08-14"
        )

        #expect(sections[0].rows[0].projectName == "No project")
        #expect(sections[0].rows[0].tag == nil)
    }
}

@Suite
struct TodayLogicRailTests {
    @Test func issueRailPutsNeedsAttentionFirstThenNewest() {
        let items = TodayLogic.issueRail(
            tickets: [
                ticket(id: 1, status: .new, createdAt: "2026-08-10T09:00:00.000Z"),
                ticket(id: 2, status: .new, createdAt: "2026-08-13T09:00:00.000Z"),
                ticket(id: 3, status: .needsAttention, createdAt: "2026-08-01T09:00:00.000Z")
            ],
            projects: projects
        )

        #expect(items.map(\.id) == ["ticket-3", "ticket-2", "ticket-1"])
    }

    @Test func issueRailDropsDoneIssuesAndCapsAtThree() {
        let items = TodayLogic.issueRail(
            tickets: [
                ticket(id: 1, status: .done),
                ticket(id: 2, status: .new, createdAt: "2026-08-13T04:00:00.000Z"),
                ticket(id: 3, status: .new, createdAt: "2026-08-13T03:00:00.000Z"),
                ticket(id: 4, status: .new, createdAt: "2026-08-13T02:00:00.000Z"),
                ticket(id: 5, status: .new, createdAt: "2026-08-13T01:00:00.000Z")
            ],
            projects: projects
        )

        #expect(items.map(\.id) == ["ticket-2", "ticket-3", "ticket-4"])
    }

    @Test func issueRailMetaCombinesRefAndStatusLabel() {
        let items = TodayLogic.issueRail(tickets: [ticket(id: 1, status: .needsAttention)], projects: projects)

        #expect(items[0].meta == "ATL-441 · Blocked")
        #expect(items[0].symbol == TodayLogic.issueSymbol)
        #expect(items[0].isPinned == false)
    }

    @Test func pullRequestRailDropsMergedAndTakesItsTitleFromTheLinkedIssue() {
        let linked = ticket(id: 10, title: "Refunds double-charge on retry")
        let items = TodayLogic.pullRequestRail(
            prs: [
                pullRequest(id: 20, ticketId: 10, status: .merged),
                pullRequest(id: 21, ticketId: 10, status: .open, pinned: true)
            ],
            tickets: [linked], projects: projects
        )

        #expect(items.map(\.id) == ["pr-21"])
        #expect(items[0].title == "Refunds double-charge on retry")
        #expect(items[0].meta == "atlas#1284 · Needs review")
        #expect(items[0].isPinned)
    }

    @Test func pullRequestRailFallsBackToTheRefWhenTheIssueIsMissing() {
        let items = TodayLogic.pullRequestRail(
            prs: [pullRequest(id: 20, ticketId: 99)], tickets: [], projects: projects
        )

        #expect(items[0].title == "atlas#1284")
    }
}

@Suite
struct TodayLogicPriorityTests {
    @Test func priorityLabelsAreUppercase() {
        #expect(TodayLogic.priorityLabel(.high) == "HIGH")
        #expect(TodayLogic.priorityLabel(.med) == "MED")
        #expect(TodayLogic.priorityLabel(.low) == "LOW")
    }

    @Test func priorityCyclesHighToMedToLowAndBack() {
        #expect(TodayLogic.nextPriority(after: .high) == .med)
        #expect(TodayLogic.nextPriority(after: .med) == .low)
        #expect(TodayLogic.nextPriority(after: .low) == .high)
    }

    @Test func dayStringIsTheCalendarDate() {
        let date = DateComponents(calendar: .current, year: 2026, month: 8, day: 14, hour: 0, minute: 30).date!
        #expect(TodayLogic.dayString(for: date) == "2026-08-14")
    }
}
