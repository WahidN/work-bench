import Testing
import Foundation
@testable import Workbench

private func makePr(
    id: Int, number: Int? = 24, projectId: Int = 1, draft: Bool = false,
    review: PrReviewState? = nil, authored: Bool = false, assigned: Bool = false,
    messages: Int = 0, updated: String? = "2026-08-17T10:00:00Z"
) -> PullRequest {
    PullRequest(
        id: id, ticketId: nil, projectId: projectId, branch: "", number: number, url: nil,
        status: .open, lastReviewScore: nil, createdAt: "2026-08-17T09:00:00Z", messages: nil,
        pinned: false, title: "Guard the deploy", reviewState: review, isDraft: draft,
        githubUpdatedAt: updated, authoredByMe: authored, assignedToMe: assigned, messageCount: messages
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

    @Test func needsReviewFilterUsesTheComputedLabel() {
        let prs = [
            makePr(id: 1, review: .approved),
            makePr(id: 2, number: 25, review: nil),
            makePr(id: 3, number: 26, draft: true),
        ]
        let rows = PRsLogic.rows(prs: prs, projects: [project], filter: .needsReview, now: Date())
        #expect(rows.map(\.id) == [2])
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
