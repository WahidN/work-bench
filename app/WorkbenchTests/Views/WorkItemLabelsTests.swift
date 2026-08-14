import Testing
@testable import Workbench

private func project(name: String = "Atlas Payments", githubRepo: String? = "acme/atlas") -> Project {
    Project(id: 1, name: name, repoPath: "/repos/atlas", defaultBranch: "main",
            githubRepo: githubRepo, jiraProjectKey: nil, sentryProjectSlug: nil)
}

private func pr(number: Int?, branch: String = "fix/gh-1", status: PrStatus = .open) -> PullRequest {
    PullRequest(id: 1, ticketId: 1, projectId: 1, branch: branch, number: number,
                url: nil, status: status, lastReviewScore: nil, createdAt: "2026-08-13T00:00:00.000Z")
}

private func ticket(source: TicketSource, sourceId: String, status: TicketStatus = .new) -> Ticket {
    Ticket(id: 1, source: source, sourceId: sourceId, projectId: 1, title: "t", body: "b", url: "u",
           analysis: nil, status: status, prId: nil, createdAt: "2026-08-13T00:00:00.000Z")
}

@Test func repoShortNameTakesTheRepoAfterTheOwner() {
    #expect(WorkItemRef.repoShortName(from: "acme/atlas") == "atlas")
}

@Test func repoShortNameHandlesARepoWithNoOwner() {
    #expect(WorkItemRef.repoShortName(from: "atlas") == "atlas")
}

@Test func repoShortNameIsNilWhenUnset() {
    #expect(WorkItemRef.repoShortName(from: nil) == nil)
    #expect(WorkItemRef.repoShortName(from: "") == nil)
}

@Test func projectSlugPrefersTheGithubRepoName() {
    #expect(WorkItemRef.projectSlug(project()) == "atlas")
}

@Test func projectSlugFallsBackToTheFirstWordOfTheName() {
    #expect(WorkItemRef.projectSlug(project(githubRepo: nil)) == "atlas")
}

@Test func projectSlugFallbackLowercasesASingleWordName() {
    #expect(WorkItemRef.projectSlug(project(name: "Relay", githubRepo: nil)) == "relay")
}

@Test func pullRequestRefCombinesSlugAndNumber() {
    #expect(WorkItemRef.pullRequest(pr(number: 1284), project: project()) == "atlas#1284")
}

@Test func pullRequestRefFallsBackToTheBranchWithoutANumber() {
    #expect(WorkItemRef.pullRequest(pr(number: nil, branch: "fix/atl-441"), project: project()) == "fix/atl-441")
}

@Test func pullRequestRefOmitsTheSlugWhenTheProjectIsUnknown() {
    #expect(WorkItemRef.pullRequest(pr(number: 1284), project: nil) == "#1284")
}

@Test func ticketRefStripsTheJiraPrefix() {
    #expect(WorkItemRef.ticket(ticket(source: .jira, sourceId: "JIRA-ATL-441")) == "ATL-441")
}

@Test func ticketRefStripsTheGithubPrefixAndOwner() {
    #expect(WorkItemRef.ticket(ticket(source: .github, sourceId: "GH-acme/beacon#57")) == "beacon#57")
}

@Test func ticketRefStripsTheSentryPrefix() {
    #expect(WorkItemRef.ticket(ticket(source: .sentry, sourceId: "SENTRY-9912")) == "9912")
}

@Test func ticketRefLeavesAnUnprefixedSourceIdAlone() {
    #expect(WorkItemRef.ticket(ticket(source: .jira, sourceId: "ATL-441")) == "ATL-441")
}

@Test func todoRefStripsTheJiraPrefix() {
    let jiraTodo = Todo(id: 1, source: .jira, sourceId: "JIRA-ATL-441", text: "[ATL-441] Refunds double-charge",
                        body: "", url: nil, projectId: 3, canPromote: true, done: false,
                        promotedTicketId: nil, createdAt: "2026-08-13T00:00:00.000Z")
    #expect(WorkItemRef.todo(jiraTodo) == "ATL-441")
}

@Test func todoRefIsNilForAManualTask() {
    let manualTodo = Todo(id: 2, source: .manual, sourceId: nil, text: "cut the release branch",
                          body: "", url: nil, projectId: nil, canPromote: false, done: false,
                          promotedTicketId: nil, createdAt: "2026-08-13T00:00:00.000Z")
    #expect(WorkItemRef.todo(manualTodo) == nil)
}

@Test func pullRequestStatusLabelsMatchTheMockup() {
    #expect(WorkItemStatusLabel.pullRequest(.open) == "Needs review")
    #expect(WorkItemStatusLabel.pullRequest(.needsAttention) == "Changes requested")
    #expect(WorkItemStatusLabel.pullRequest(.merged) == "Merged")
}

@Test func ticketStatusLabelsMatchTheMockup() {
    #expect(WorkItemStatusLabel.ticket(.new) == "To do")
    #expect(WorkItemStatusLabel.ticket(.sparring) == "In progress")
    #expect(WorkItemStatusLabel.ticket(.inReview) == "In review")
    #expect(WorkItemStatusLabel.ticket(.done) == "Done")
    #expect(WorkItemStatusLabel.ticket(.needsAttention) == "Blocked")
}
