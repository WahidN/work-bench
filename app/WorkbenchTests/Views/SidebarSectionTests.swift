import Testing
@testable import Workbench

@Test func sidebarSectionOrderMatchesDesignNav() {
    #expect(SidebarSection.allCases == [.today, .projects, .pullRequests, .issues])
}

@Test func sidebarSectionLabelsMatchDesignNav() {
    #expect(SidebarSection.today.rawValue == "Today")
    #expect(SidebarSection.projects.rawValue == "Projects")
    #expect(SidebarSection.pullRequests.rawValue == "Pull requests")
    #expect(SidebarSection.issues.rawValue == "Issues")
}

@Test func sidebarSectionSymbolsMatchDesignNav() {
    #expect(SidebarSection.today.symbol == "sun.horizon")
    #expect(SidebarSection.projects.symbol == "square.grid.2x2")
    #expect(SidebarSection.pullRequests.symbol == "arrow.triangle.pull")
    #expect(SidebarSection.issues.symbol == "list.bullet.rectangle")
}
