import Testing
import Foundation
@testable import Workbench

private func makePr(
    id: Int, number: Int? = 24, projectId: Int = 1, draft: Bool = false,
    review: PrReviewState? = nil, authored: Bool = false, assigned: Bool = false,
    reviewRequested: Bool? = nil,
    messages: Int = 0, updated: String? = "2026-08-17T10:00:00Z"
) -> PullRequest {
    PullRequest(
        id: id, ticketId: nil, projectId: projectId, branch: "", number: number, url: nil,
        status: .open, lastReviewScore: nil, createdAt: "2026-08-17T09:00:00Z", messages: nil,
        pinned: false, title: "Guard the deploy", reviewState: review, isDraft: draft,
        githubUpdatedAt: updated, authoredByMe: authored, assignedToMe: assigned,
        reviewRequestedByMe: reviewRequested, messageCount: messages
    )
}

private let project = Project(
    id: 1, name: "ACV", repoPath: "/tmp/acv", defaultBranch: "main",
    githubRepo: "https://github.com/LinkuNijmegen/acv-website",
    jiraProjectKey: nil, sentryProjectSlug: nil, status: .active, blurb: ""
)

@Suite struct PRsLogicTests {
    @Test func draftBeatsReviewState() {
        #expect(PRsLogic.statusLabel(makePr(id: 1, draft: true, review: .approved)) == "Draft")
    }

    @Test func mapsEachReviewState() {
        #expect(PRsLogic.statusLabel(makePr(id: 1, review: .approved)) == "Approved")
        #expect(PRsLogic.statusLabel(makePr(id: 2, review: .changesRequested)) == "Changes requested")
        #expect(PRsLogic.statusLabel(makePr(id: 3, review: .reviewRequired)) == "Needs review")
        #expect(PRsLogic.statusLabel(makePr(id: 4, review: nil)) == "Needs review")
    }

    @Test func repoNameDropsTheOwnerAndTheUrl() {
        #expect(PRsLogic.repoName(from: "https://github.com/LinkuNijmegen/acv-website") == "acv-website")
        #expect(PRsLogic.repoName(from: "linku/demo") == "demo")
    }

    @Test func refCombinesRepoAndNumberWhenBothArePresent() {
        let pr = makePr(id: 1, number: 24)
        #expect(PRsLogic.ref(for: pr, githubRepo: "https://github.com/LinkuNijmegen/acv-website") == "acv-website#24")
    }

    @Test func refDropsTheHashWhenTheNumberIsMissing() {
        let pr = makePr(id: 1, number: nil)
        #expect(PRsLogic.ref(for: pr, githubRepo: "https://github.com/LinkuNijmegen/acv-website") == "acv-website")
    }

    @Test func refDropsTheRepoWhenItIsMissing() {
        let pr = makePr(id: 1, number: 24)
        #expect(PRsLogic.ref(for: pr, githubRepo: nil) == "#24")
    }

    @Test func refIsEmptyWhenBothAreMissing() {
        let pr = makePr(id: 1, number: nil)
        #expect(PRsLogic.ref(for: pr, githubRepo: nil) == "")
    }

    @Test func assignedFilterKeepsOnlyAssignedRows() {
        let prs = [makePr(id: 1, assigned: true), makePr(id: 2, number: 25, authored: true)]
        let rows = PRsLogic.rows(prs: prs, projects: [project], filter: .assignedToMe, now: Date())
        #expect(rows.map(\.id) == [1])
    }

    @Test func mineFilterKeepsOnlyAuthoredRows() {
        let prs = [makePr(id: 1, assigned: true), makePr(id: 2, number: 25, authored: true)]
        let rows = PRsLogic.rows(prs: prs, projects: [project], filter: .mine, now: Date())
        #expect(rows.map(\.id) == [2])
    }

    @Test func needsReviewFilterKeepsOnlyPullRequestsAwaitingMyReview() {
        let prs = [
            makePr(id: 1, review: .reviewRequired, authored: true),
            makePr(id: 2, number: 25, review: .reviewRequired, reviewRequested: true),
            makePr(id: 3, number: 26, review: .approved, reviewRequested: true),
        ]
        let rows = PRsLogic.rows(prs: prs, projects: [project], filter: .needsReview, now: Date())
        // 3 is kept even though a colleague already approved it: the user's own request
        // still stands, which is what the tab is about. 1 is the dropped old meaning.
        #expect(rows.map(\.id) == [2, 3])
    }

    @Test func needsReviewFilterExcludesADraft() {
        // The predicate this replaced ran through statusLabel, which returns "Draft"
        // before it looks at the review state, so a draft never entered the queue.
        // Asking for reviewers on a draft does not make it ready to review.
        let draft = makePr(id: 1, draft: true, review: .reviewRequired, reviewRequested: true)
        let rows = PRsLogic.rows(prs: [draft], projects: [project], filter: .needsReview, now: Date())
        #expect(rows.isEmpty)
    }

    @Test func needsReviewFilterKeepsANonDraftWithTheSameRequest() {
        let ready = makePr(id: 2, draft: false, review: .reviewRequired, reviewRequested: true)
        let rows = PRsLogic.rows(prs: [ready], projects: [project], filter: .needsReview, now: Date())
        #expect(rows.map(\.id) == [2])
    }

    @Test func needsReviewFilterDropsMyOwnUnreviewedPullRequest() {
        let mine = makePr(id: 1, review: nil, authored: true)
        let rows = PRsLogic.rows(prs: [mine], projects: [project], filter: .needsReview, now: Date())
        #expect(rows.isEmpty, "a PR of my own waiting on someone else belongs under Mine, not here")
    }

    @Test func needsReviewFilterIgnoresAPullRequestFromAnOlderEngine() {
        // reviewRequestedByMe is absent from payloads written before this change, so it
        // decodes as nil. Nil must read as "not awaiting my review", never as true.
        let legacy = makePr(id: 1, review: .reviewRequired, authored: true, reviewRequested: nil)
        let rows = PRsLogic.rows(prs: [legacy], projects: [project], filter: .needsReview, now: Date())
        #expect(rows.isEmpty)
    }

    @Test func aReviewOnlyPullRequestStaysOutOfTheOtherTwoTabs() {
        let reviewOnly = makePr(id: 1, review: .reviewRequired, reviewRequested: true)
        let assigned = PRsLogic.rows(prs: [reviewOnly], projects: [project], filter: .assignedToMe, now: Date())
        let mine = PRsLogic.rows(prs: [reviewOnly], projects: [project], filter: .mine, now: Date())
        #expect(assigned.isEmpty)
        #expect(mine.isEmpty)
    }

    @Test func theOtherTwoTabsAreUnaffectedByAReviewRequest() {
        // Both flags still decide their own tab even when a review is also requested.
        let both = makePr(id: 1, authored: true, assigned: true, reviewRequested: true)
        #expect(PRsLogic.rows(prs: [both], projects: [project], filter: .assignedToMe, now: Date()).map(\.id) == [1])
        #expect(PRsLogic.rows(prs: [both], projects: [project], filter: .mine, now: Date()).map(\.id) == [1])
    }

    @Test func theEmptyStateMentionsReviewRequests() {
        #expect(PRsLogic.emptyStateText.lowercased().contains("review"))
        #expect(
            PRsLogic.emptyStateText == "Nothing here. Pull requests you open, get assigned, or are asked to review show up automatically."
        )
    }

    @Test func buildsTheRefAndTheProjectName() {
        let rows = PRsLogic.rows(prs: [makePr(id: 1, assigned: true)], projects: [project], filter: .assignedToMe, now: Date())
        #expect(rows.first?.ref == "acv-website#24")
        #expect(rows.first?.projectName == "ACV")
    }

    @Test func fallsBackWhenThePrHasNoProject() {
        let orphan = makePr(id: 1, projectId: 99, assigned: true)
        let rows = PRsLogic.rows(prs: [orphan], projects: [project], filter: .assignedToMe, now: Date())
        #expect(rows.first?.projectName == "")
        #expect(rows.first?.ref == "#24")
    }

    @Test func dropsTheHashWhenTheNumberIsMissing() {
        let noNumberYet = makePr(id: 1, number: nil, assigned: true)
        let rows = PRsLogic.rows(prs: [noNumberYet], projects: [project], filter: .assignedToMe, now: Date())
        #expect(rows.first?.ref == "acv-website")
    }
}
