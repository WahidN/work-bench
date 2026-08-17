import Testing
import Foundation
@testable import Workbench

@Test func todayDateStringFormatsAFixedDateInEnglish() {
    var components = DateComponents()
    components.year = 2026
    components.month = 8
    components.day = 13
    let date = Calendar(identifier: .gregorian).date(from: components)!
    let result = AppHeaderLogic.todayDateString(for: date, locale: Locale(identifier: "en_US_POSIX"))
    #expect(result == "Thursday, 13 August")
}

@Test func kickerForTodayIsTheGivenDateString() {
    #expect(AppHeaderLogic.kicker(for: .today, activeProjectCount: 0, todayDateString: "Thursday, 13 August") == "Thursday, 13 August")
}

@Test func projectsKickerCountsActiveProjects() {
    #expect(AppHeaderLogic.kicker(for: .projects, activeProjectCount: 8, todayDateString: "x") == "8 active")
    #expect(AppHeaderLogic.kicker(for: .projects, activeProjectCount: 1, todayDateString: "x") == "1 active")
    #expect(AppHeaderLogic.kicker(for: .projects, activeProjectCount: 0, todayDateString: "x") == "0 active")
}

@Test func kickerForPullRequestsIsGitHub() {
    #expect(AppHeaderLogic.kicker(for: .pullRequests, activeProjectCount: 0, todayDateString: "") == "GitHub")
}

@Test func kickerForIssuesIsJira() {
    #expect(AppHeaderLogic.kicker(for: .issues, activeProjectCount: 0, todayDateString: "") == "Jira")
}

@Test func headingsMatchEachSection() {
    #expect(AppHeaderLogic.heading(for: .today) == "Today")
    #expect(AppHeaderLogic.heading(for: .projects) == "Projects")
    #expect(AppHeaderLogic.heading(for: .pullRequests) == "Pull requests")
    #expect(AppHeaderLogic.heading(for: .issues) == "Jira")
}
