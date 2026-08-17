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
     "status":"active","blurb":""}
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
     "status":"active","blurb":""}
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
     "createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let pr = try decode(PullRequest.self, json)
    #expect(pr.status == .open)
    #expect(pr.lastReviewScore == 4.6)
    #expect(pr.messages == nil)
}

@Test func decodesPullRequestDetailShapeWithMessages() throws {
    let json = """
    {"id":142,"ticketId":1,"projectId":1,"branch":"fix/github-1","number":142,
     "url":"https://github.com/x/pull/142","status":"needs_attention","lastReviewScore":3.2,"pinned":false,
     "createdAt":"2026-08-12T00:00:00.000Z",
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
     "createdAt":"2026-08-12T00:00:00.000Z"}
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

@Test func decodesProjectStatusAndBlurb() throws {
    let json = """
    {"id":3,"name":"Drydock","repoPath":"/repos/drydock","defaultBranch":"main",
     "githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null,
     "status":"paused","blurb":"Build pipeline consolidation."}
    """
    let project = try decode(Project.self, json)
    #expect(project.status == .paused)
    #expect(project.blurb == "Build pipeline consolidation.")
}
