import Testing
import Foundation
@testable import Workbench

func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

@Test func decodesProject() throws {
    let json = """
    {"id":1,"name":"demo","repoPath":"/repos/demo","defaultBranch":"main",
     "githubRepo":"linku/demo","jiraProjectKey":"DEMO","sentryProjectSlug":"demo-frontend",
     "status":"active","blurb":"","notes":""}
    """
    let project = try decode(Project.self, json)
    #expect(project.id == 1)
    #expect(project.name == "demo")
    #expect(project.githubRepo == "linku/demo")
}

@Test func decodesProjectWithNullOptionalFields() throws {
    let json = """
    {"id":2,"name":"solo","repoPath":"/repos/solo","defaultBranch":"main",
     "githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null,
     "status":"active","blurb":"","notes":""}
    """
    let project = try decode(Project.self, json)
    #expect(project.githubRepo == nil)
}

@Test func decodesTodoFromJira() throws {
    let json = """
    {"id":1,"source":"jira","sourceId":"JIRA-DEMO-1","text":"[DEMO-1] Update env vars",
     "body":"Redirect loop.","url":"https://x/browse/DEMO-1","projectId":1,
     "canPromote":true,"done":false,"promotedTicketId":null,"priority":"med","pinned":false,"createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let todo = try decode(Todo.self, json)
    #expect(todo.source == .jira)
    #expect(todo.canPromote == true)
}

@Test func decodesManualTodo() throws {
    let json = """
    {"id":2,"source":"manual","sourceId":null,"text":"renew SSL cert","body":"",
     "url":null,"projectId":null,"canPromote":false,"done":false,
     "promotedTicketId":null,"priority":"med","pinned":false,"createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let todo = try decode(Todo.self, json)
    #expect(todo.source == .manual)
    #expect(todo.sourceId == nil)
}

@Test func decodesTicketListShapeWithoutMessages() throws {
    let json = """
    {"id":1,"source":"github","sourceId":"GH-demo#1","projectId":1,"title":"Fix null check",
     "body":"desc","url":"https://x","analysis":null,"status":"new","prId":null,"pinned":false,
     "createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let ticket = try decode(Ticket.self, json)
    #expect(ticket.status == .new)
    #expect(ticket.messages == nil)
}

@Test func decodesTicketDetailShapeWithMessagesAndAnalysis() throws {
    let json = """
    {"id":1,"source":"github","sourceId":"GH-demo#1","projectId":1,"title":"Fix null check",
     "body":"desc","url":"https://x",
     "analysis":{"summary":"s","rootCause":"r","proposedFix":"p","affectedFiles":["a.ts"],"confidence":"high"},
     "status":"sparring","prId":null,"pinned":false,"createdAt":"2026-08-12T00:00:00.000Z",
     "messages":[{"id":1,"ticketId":1,"role":"user","content":"add retry logic","createdAt":"2026-08-12T00:00:00.000Z"}]}
    """
    let ticket = try decode(Ticket.self, json)
    #expect(ticket.analysis?.confidence == .high)
    #expect(ticket.messages?.count == 1)
    #expect(ticket.messages?.first?.role == .user)
}

@Test func decodesPullRequestListShapeWithoutMessages() throws {
    let json = """
    {"id":142,"ticketId":1,"projectId":1,"branch":"fix/github-1","number":142,
     "url":"https://github.com/x/pull/142","status":"open","lastReviewScore":4.6,"pinned":false,
     "createdAt":"2026-08-12T00:00:00.000Z","title":"Fix null check","isDraft":false,
     "authoredByMe":false,"assignedToMe":false,"messageCount":0}
    """
    let pr = try decode(PullRequest.self, json)
    #expect(pr.status == .open)
    #expect(pr.lastReviewScore == 4.6)
    #expect(pr.messages == nil)
}

@Test func decodesPullRequestWithoutATicket() throws {
    let json = """
    {"id":1,"ticketId":null,"projectId":1,"branch":"feat/header","number":23,
     "url":"https://github.com/x/pull/23","status":"open","lastReviewScore":null,"pinned":false,
     "createdAt":"2026-08-12T17:31:06.792Z","title":"Add header","isDraft":false,
     "authoredByMe":false,"assignedToMe":false,"messageCount":0}
    """
    let pr = try decode(PullRequest.self, json)
    #expect(pr.ticketId == nil)
    #expect(pr.branch == "feat/header")
}

@Test func decodesPullRequestDetailShapeWithMessages() throws {
    let json = """
    {"id":142,"ticketId":1,"projectId":1,"branch":"fix/github-1","number":142,
     "url":"https://github.com/x/pull/142","status":"needs_attention","lastReviewScore":3.2,"pinned":false,
     "createdAt":"2026-08-12T00:00:00.000Z","title":"Fix null check","isDraft":false,
     "authoredByMe":false,"assignedToMe":false,"messageCount":1,
     "messages":[{"id":1,"prId":142,"role":"assistant","content":"Fix ready for review.","createdAt":"2026-08-12T00:00:00.000Z"}]}
    """
    let pr = try decode(PullRequest.self, json)
    #expect(pr.status == .needsAttention)
    #expect(pr.messages?.first?.role == .assistant)
}

@Test func decodesTodayResponseWithMixedNeedsInput() throws {
    let json = """
    {"needsInput":[
       {"kind":"ticket","id":1,"title":"Add retry logic","status":"sparring","reviewScore":null},
       {"kind":"pr","id":142,"title":"Fix null check","status":"open","reviewScore":4.6}
     ],
     "todos":[{"id":1,"source":"manual","sourceId":null,"text":"call client","body":"",
       "url":null,"projectId":null,"canPromote":false,"done":false,
       "promotedTicketId":null,"priority":"med","pinned":false,"createdAt":"2026-08-12T00:00:00.000Z"}]}
    """
    let today = try decode(TodayResponse.self, json)
    #expect(today.needsInput.count == 2)
    #expect(today.needsInput[0].kind == .ticket)
    #expect(today.needsInput[1].kind == .pr)
    #expect(today.needsInput[1].reviewScore == 4.6)
    #expect(today.todos.count == 1)
}

@Test func projectMessageDecodesFromEngineJson() throws {
    let json = """
    {"id":7,"projectId":3,"role":"assistant","content":"two PRs are waiting","createdAt":"2026-08-13T09:00:00.000Z"}
    """
    let message = try JSONDecoder().decode(ProjectMessage.self, from: Data(json.utf8))

    #expect(message.id == 7)
    #expect(message.projectId == 3)
    #expect(message.role == .assistant)
    #expect(message.content == "two PRs are waiting")
}

@Test func decodesTodoPriorityDueAndDoneStamps() throws {
    let json = """
    {"id":3,"source":"manual","sourceId":null,"text":"cut the release branch","body":"",
     "url":null,"projectId":2,"canPromote":false,"done":true,"promotedTicketId":null,
     "priority":"high","dueAt":"2026-08-13","doneAt":"2026-08-14","pinned":false,"createdAt":"2026-08-13T00:00:00.000Z"}
    """
    let todo = try decode(Todo.self, json)
    #expect(todo.priority == .high)
    #expect(todo.dueAt == "2026-08-13")
    #expect(todo.doneAt == "2026-08-14")
}

@Test func decodesPinnedFlagsOnTicketAndPullRequest() throws {
    let ticketJson = """
    {"id":1,"source":"github","sourceId":"GH-demo#1","projectId":1,"title":"Fix null check",
     "body":"desc","url":"https://x","analysis":null,"status":"new","prId":null,"pinned":true,
     "createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let prJson = """
    {"id":142,"ticketId":1,"projectId":1,"branch":"fix/github-1","number":142,
     "url":"https://github.com/x/pull/142","status":"open","lastReviewScore":4.6,"pinned":true,
     "createdAt":"2026-08-12T00:00:00.000Z","title":"Fix null check","isDraft":false,
     "authoredByMe":false,"assignedToMe":false,"messageCount":0}
    """
    #expect(try decode(Ticket.self, ticketJson).pinned == true)
    #expect(try decode(PullRequest.self, prJson).pinned == true)
}

@Test func decodesTodoPinnedFlag() throws {
    let json = """
    {"id":4,"source":"jira","sourceId":"JIRA-MR-1","text":"[MR-1] Fix the importer","body":"",
     "url":"https://x/browse/MR-1","projectId":null,"canPromote":false,"done":false,
     "promotedTicketId":null,"priority":"med","dueAt":null,"doneAt":null,"pinned":true,
     "createdAt":"2026-08-14T00:00:00.000Z"}
    """
    #expect(try decode(Todo.self, json).pinned == true)
}

@Test func decodesAPullRequestFromTheInbox() throws {
    let json = """
    {"id":1,"ticketId":null,"projectId":2,"branch":"","number":24,"url":"u",
     "status":"open","lastReviewScore":null,"createdAt":"2026-08-17T10:00:00Z",
     "pinned":false,"title":"Guard the deploy","reviewState":"changes_requested",
     "isDraft":false,"githubUpdatedAt":"2026-08-17T09:46:24Z",
     "authoredByMe":true,"assignedToMe":false,"messageCount":3}
    """
    let pr = try JSONDecoder().decode(PullRequest.self, from: Data(json.utf8))
    #expect(pr.title == "Guard the deploy")
    #expect(pr.reviewState == .changesRequested)
    #expect(pr.messageCount == 3)
    #expect(pr.authoredByMe)
}

@Test func decodesProjectStatusAndBlurb() throws {
    let json = """
    {"id":3,"name":"Drydock","repoPath":"/repos/drydock","defaultBranch":"main",
     "githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null,
     "status":"paused","blurb":"Build pipeline consolidation.","notes":""}
    """
    let project = try decode(Project.self, json)
    #expect(project.status == .paused)
    #expect(project.blurb == "Build pipeline consolidation.")
}

@Test func decodesPrDetail() throws {
    let json = """
    {"title":"Retry card capture on 5xx","url":"https://x/pull/23","state":"OPEN","isDraft":false,
     "reviewState":"changes_requested","author":"wahid","createdAt":"2026-08-12T15:11:00Z",
     "baseRefName":"main","headRefName":"atlas/retry-card-capture","commitCount":4,
     "changedFiles":3,"additions":64,"deletions":7,
     "files":[{"path":"src/capture.ts","status":"modified","additions":24,"deletions":5,"patch":"@@ -1 +1 @@\\n+x"}],
     "threads":[{"path":"src/capture.ts","line":8,"diffSide":"RIGHT","isResolved":false,"isOutdated":false,
       "comments":[{"id":1,"author":"sana","body":"q","createdAt":"2026-08-14T09:00:00Z"}]}],
     "conversation":[{"kind":"review","author":"sana","body":"ok","createdAt":"2026-08-14T09:00:00Z","state":"COMMENTED"}]}
    """
    let detail = try decode(PrDetail.self, json)
    #expect(detail.commitCount == 4)
    #expect(detail.reviewState == .changesRequested)
    #expect(detail.files.first?.patch == "@@ -1 +1 @@\n+x")
    #expect(detail.threads.first?.comments.first?.id == 1)
    #expect(detail.conversation.first?.kind == .review)
}

@Test func decodesPrDetailFileWithoutAPatch() throws {
    let json = """
    {"path":"assets/huge.bin","status":"modified","additions":900,"deletions":900,"patch":null}
    """
    #expect(try decode(PrDetailFile.self, json).patch == nil)
}

@Test func decodesAnOutdatedThreadWithoutALine() throws {
    let json = """
    {"path":"src/gone.ts","line":null,"diffSide":"LEFT","isResolved":true,"isOutdated":true,"comments":[]}
    """
    let thread = try decode(PrReviewThread.self, json)
    #expect(thread.line == nil)
    #expect(thread.isOutdated)
}

@Test func decodesPrDetailWithNoReviewStateAndAPlainComment() throws {
    let json = """
    {"title":"Add header","url":"https://x/pull/9","state":"OPEN","isDraft":false,
     "reviewState":null,"author":"wahid","createdAt":"2026-08-15T10:00:00Z",
     "baseRefName":"main","headRefName":"feat/header","commitCount":1,
     "changedFiles":1,"additions":3,"deletions":0,
     "files":[],"threads":[],
     "conversation":[{"kind":"comment","author":"sana","body":"lgtm once tests pass","createdAt":"2026-08-15T11:00:00Z","state":null}]}
    """
    let detail = try decode(PrDetail.self, json)
    #expect(detail.reviewState == nil)
    #expect(detail.conversation.first?.kind == .comment)
    #expect(detail.conversation.first?.state == nil)
}

@Test func decodesAThreadOnTheLeftSideOfTheDiff() throws {
    let json = """
    {"path":"src/capture.ts","line":40,"diffSide":"LEFT","isResolved":false,"isOutdated":false,
     "comments":[{"id":9,"author":"sana","body":"why remove this?","createdAt":"2026-08-14T09:00:00Z"}]}
    """
    #expect(try decode(PrReviewThread.self, json).diffSide == "LEFT")
}

@Test func todoDecodesItsJiraStatus() throws {
    let json = """
    {"id":1,"source":"jira","sourceId":"JIRA-MR-1","text":"[MR-1] Fix it","body":"","url":null,
     "projectId":null,"canPromote":true,"done":false,"promotedTicketId":null,"priority":"med",
     "pinned":false,"statusName":"In Review","statusCategory":"in_progress",
     "createdAt":"2026-08-27T00:00:00.000Z"}
    """
    let todo = try decode(Todo.self, json)

    #expect(todo.statusName == "In Review")
    #expect(todo.statusCategory == "in_progress")
}

// Every payload written before this change omits both keys. Optionals decode to nil
// when a key is absent, which a non-optional field would not: Swift's synthesized
// Decodable ignores property defaults, so a default would not save it.
@Test func todoDecodesWithNoStatusKeysAtAll() throws {
    let json = """
    {"id":2,"source":"manual","sourceId":null,"text":"renew SSL cert","body":"","url":null,
     "projectId":null,"canPromote":false,"done":false,"promotedTicketId":null,"priority":"med",
     "pinned":false,"createdAt":"2026-08-27T00:00:00.000Z"}
    """
    let todo = try decode(Todo.self, json)

    #expect(todo.statusName == nil)
    #expect(todo.statusCategory == nil)
}

@Test func jiraConnectionDecodesAConnectedSite() throws {
    let json = """
    {"hasClientCredentials":true,"connected":true,"siteUrl":"https://demo.atlassian.net",
     "siteName":"Demo","availableSites":[],"callbackUrl":"http://localhost:4173/oauth/jira/callback"}
    """
    let connection = try decode(JiraConnection.self, json)

    #expect(connection.connected)
    #expect(connection.siteName == "Demo")
    #expect(connection.availableSites.isEmpty)
    #expect(connection.callbackUrl == "http://localhost:4173/oauth/jira/callback")
}

@Test func jiraConnectionDecodesSeveralSitesAwaitingAChoice() throws {
    let json = """
    {"hasClientCredentials":true,"connected":false,"siteUrl":null,"siteName":null,
     "availableSites":[{"id":"cloud-1","url":"https://one.atlassian.net","name":"One"},
                       {"id":"cloud-2","url":"https://two.atlassian.net","name":"Two"}],
     "callbackUrl":"http://localhost:4173/oauth/jira/callback"}
    """
    let connection = try decode(JiraConnection.self, json)

    #expect(connection.connected == false)
    #expect(connection.siteUrl == nil)
    #expect(connection.availableSites.map(\.name) == ["One", "Two"])
}

@Test func todoMessageDecodesTheEnginePayload() throws {
    let json = """
    {"id":7,"todoId":12,"role":"assistant","content":"A redirect loop.","createdAt":"2026-08-26T00:00:00.000Z"}
    """
    let message = try decode(TodoMessage.self, json)

    #expect(message.id == 7)
    #expect(message.todoId == 12)
    #expect(message.role == .assistant)
    #expect(message.content == "A redirect loop.")
}
