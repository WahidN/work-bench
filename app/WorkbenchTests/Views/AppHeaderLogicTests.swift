import Testing
@testable import Workbench

@Test func kickerForTodayIsTheGivenDateString() {
    #expect(AppHeaderLogic.kicker(for: .today, projectCount: 0, todayDateString: "Thursday, 13 August") == "Thursday, 13 August")
}

@Test func kickerForProjectsShowsThePluralizedCount() {
    #expect(AppHeaderLogic.kicker(for: .projects, projectCount: 1, todayDateString: "") == "1 project")
    #expect(AppHeaderLogic.kicker(for: .projects, projectCount: 8, todayDateString: "") == "8 projects")
}

@Test func kickerForPullRequestsIsGitHub() {
    #expect(AppHeaderLogic.kicker(for: .pullRequests, projectCount: 0, todayDateString: "") == "GitHub")
}

@Test func kickerForIssuesIsJiraGitHub() {
    #expect(AppHeaderLogic.kicker(for: .issues, projectCount: 0, todayDateString: "") == "Jira · GitHub")
}

@Test func headingsMatchEachSection() {
    #expect(AppHeaderLogic.heading(for: .today) == "Today")
    #expect(AppHeaderLogic.heading(for: .projects) == "Projects")
    #expect(AppHeaderLogic.heading(for: .pullRequests) == "Pull requests")
    #expect(AppHeaderLogic.heading(for: .issues) == "Issues")
}
