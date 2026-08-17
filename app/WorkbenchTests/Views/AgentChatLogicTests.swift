import Testing
@testable import Workbench

private let atlas = Project(id: 3, name: "Atlas Payments", repoPath: "/repos/atlas", defaultBranch: "main",
                            githubRepo: "acme/atlas", jiraProjectKey: "ATL", sentryProjectSlug: nil)

private func pr(status: PrStatus = .open, authoredByMe: Bool = false) -> PullRequest {
    PullRequest(id: 9, ticketId: 4, projectId: 3, branch: "fix/atl-441", number: 1284,
                url: nil, status: status, lastReviewScore: nil, createdAt: "2026-08-13T00:00:00.000Z",
                title: "Refunds double-charge", isDraft: false, authoredByMe: authoredByMe,
                assignedToMe: false, messageCount: 0)
}

private func ticket(status: TicketStatus = .sparring) -> Ticket {
    Ticket(id: 4, source: .jira, sourceId: "JIRA-ATL-441", projectId: 3,
           title: "Refunds double-charge on retry", body: "b", url: "u",
           analysis: nil, status: status, prId: nil, createdAt: "2026-08-13T00:00:00.000Z")
}

@Test func targetProjectIdComesFromEachCase() {
    #expect(AgentChatTarget.project(atlas).projectId == 3)
    #expect(AgentChatTarget.ticket(ticket()).projectId == 3)
    #expect(AgentChatTarget.pullRequest(pr()).projectId == 3)
}

@Test func onlyTicketsAndPullRequestsAreItems() {
    #expect(AgentChatTarget.project(atlas).isItem == false)
    #expect(AgentChatTarget.ticket(ticket()).isItem == true)
    #expect(AgentChatTarget.pullRequest(pr()).isItem == true)
}

@Test func projectSubjectUsesTheProjectKickerAndPrompts() {
    let subject = AgentChatLogic.subject(for: .project(atlas), project: atlas, linkedTicket: nil)

    #expect(subject.kicker == "Project · Atlas Payments")
    #expect(subject.title == "Atlas Payments")
    #expect(subject.placeholder == "Ask about Atlas Payments")
    #expect(subject.quickPrompts == ["What should I do first?", "Catch me up", "Draft standup"])
    #expect(subject.backToProjectName == nil)
}

@Test func pullRequestSubjectMatchesTheMockupHeader() {
    let subject = AgentChatLogic.subject(for: .pullRequest(pr()), project: atlas, linkedTicket: ticket())

    #expect(subject.kicker == "atlas#1284 · Needs review")
    #expect(subject.title == "Refunds double-charge on retry")
    #expect(subject.placeholder == "Tell the agent what to do on atlas#1284")
    #expect(subject.quickPrompts == ["Summarise the review comments", "Reply for me", "Make this a task"])
    #expect(subject.backToProjectName == "Atlas Payments")
}

@Test func pullRequestSubjectFallsBackToTheRefWithoutALinkedTicket() {
    let subject = AgentChatLogic.subject(for: .pullRequest(pr()), project: atlas, linkedTicket: nil)
    #expect(subject.title == "atlas#1284")
}

@Test func ticketSubjectUsesTheIssueRefAndPrompts() {
    let subject = AgentChatLogic.subject(for: .ticket(ticket()), project: atlas, linkedTicket: nil)

    #expect(subject.kicker == "ATL-441 · In progress")
    #expect(subject.title == "Refunds double-charge on retry")
    #expect(subject.placeholder == "Tell the agent what to do on ATL-441")
    #expect(subject.quickPrompts == ["Draft a fix plan", "Reply for me", "Make this a task"])
    #expect(subject.backToProjectName == "Atlas Payments")
}

@Test func itemSubjectHasNoBackLinkWhenTheProjectIsUnknown() {
    let subject = AgentChatLogic.subject(for: .ticket(ticket()), project: nil, linkedTicket: nil)
    #expect(subject.backToProjectName == nil)
}

@Test func mergedPullRequestShowsTheMergedStatus() {
    let subject = AgentChatLogic.subject(for: .pullRequest(pr(status: .merged)), project: atlas, linkedTicket: nil)
    #expect(subject.kicker == "atlas#1284 · Merged")
}

@Test func mergeIsOfferedOnAnOpenPullRequestYouAuthored() {
    #expect(AgentChatLogic.canMerge(.pullRequest(pr(authoredByMe: true))) == true)
}

@Test func mergeIsHiddenOnSomeoneElsesPullRequest() {
    #expect(AgentChatLogic.canMerge(.pullRequest(pr(authoredByMe: false))) == false)
}

@Test func mergeIsHiddenOnAnAlreadyMergedPullRequest() {
    #expect(AgentChatLogic.canMerge(.pullRequest(pr(status: .merged, authoredByMe: true))) == false)
}

@Test func mergeIsHiddenForTargetsThatAreNotPullRequests() {
    #expect(AgentChatLogic.canMerge(.ticket(ticket())) == false)
    #expect(AgentChatLogic.canMerge(.project(atlas)) == false)
    #expect(AgentChatLogic.canMerge(nil) == false)
}

@Test func authorLabelsAreUppercase() {
    #expect(AgentChatLogic.authorLabel(for: .user) == "YOU")
    #expect(AgentChatLogic.authorLabel(for: .assistant) == "AGENT")
}
