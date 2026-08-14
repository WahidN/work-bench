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
    #expect(AppHeaderLogic.kicker(for: .today, projectCount: 0, todayDateString: "Thursday, 13 August") == "Thursday, 13 August")
}

@Test func kickerForProjectsShowsThePluralizedCount() {
    #expect(AppHeaderLogic.kicker(for: .projects, projectCount: 1, todayDateString: "") == "1 project")
    #expect(AppHeaderLogic.kicker(for: .projects, projectCount: 8, todayDateString: "") == "8 projects")
}

@Test func kickerForPullRequestsIsGitHub() {
    #expect(AppHeaderLogic.kicker(for: .pullRequests, projectCount: 0, todayDateString: "") == "GitHub")
}

@Test func kickerForIssuesIsJira() {
    #expect(AppHeaderLogic.kicker(for: .issues, projectCount: 0, todayDateString: "") == "Jira")
}

@Test func headingsMatchEachSection() {
    #expect(AppHeaderLogic.heading(for: .today) == "Today")
    #expect(AppHeaderLogic.heading(for: .projects) == "Projects")
    #expect(AppHeaderLogic.heading(for: .pullRequests) == "Pull requests")
    #expect(AppHeaderLogic.heading(for: .issues) == "Jira")
}
