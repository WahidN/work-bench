import Testing
@testable import Workbench

private func project(id: Int, name: String) -> Project {
    Project(id: id, name: name, repoPath: "/repos/\(id)", defaultBranch: "main",
            githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
}

private let atlasProject = project(id: 1, name: "Atlas Payments")
private let beaconProject = project(id: 2, name: "Beacon")
private let alldataProject = project(id: 3, name: "Alldata Portal")

@Test func theBaseListIsTheFiveCommandsInOrder() {
    let rows = CommandPaletteLogic.commands

    #expect(rows.map(\.label) == [
        "Go to Today", "Go to Projects", "Go to Pull requests", "Go to Jira", "Ask the agent",
    ])
    #expect(rows.map(\.hint) == ["⌘1", "⌘2", "⌘3", "⌘4", "⌘J"])
    #expect(rows.map(\.action) == [
        .navigate(.today), .navigate(.projects), .navigate(.pullRequests), .navigate(.issues),
        .askAgent,
    ])
}

@Test func navigationSymbolsComeFromTheSidebarSoTheyCannotDrift() {
    let rows = CommandPaletteLogic.commands

    #expect(rows[0].symbol == SidebarSection.today.symbol)
    #expect(rows[1].symbol == SidebarSection.projects.symbol)
    #expect(rows[2].symbol == SidebarSection.pullRequests.symbol)
    #expect(rows[3].symbol == SidebarSection.issues.symbol)
}

@Test func anEmptyQueryGivesTheBaseList() {
    #expect(CommandPaletteLogic.results(query: "", projects: [atlasProject]) == CommandPaletteLogic.commands)
}

@Test func aWhitespaceOnlyQueryGivesTheBaseList() {
    #expect(CommandPaletteLogic.results(query: "   ", projects: [atlasProject]) == CommandPaletteLogic.commands)
    #expect(CommandPaletteLogic.results(query: "\n\t", projects: [atlasProject]) == CommandPaletteLogic.commands)
}

@Test func aQueryPutsTheAddTaskRowFirst() {
    let rows = CommandPaletteLogic.results(query: "renew the SSL cert", projects: [])

    #expect(rows.first?.label == "Add task \"renew the SSL cert\"")
    #expect(rows.first?.hint == "Enter")
    #expect(rows.first?.symbol == "plus")
    #expect(rows.first?.action == .addTask("renew the SSL cert"))
}

@Test func theAddTaskRowUsesTheTrimmedQuery() {
    let rows = CommandPaletteLogic.results(query: "  renew the cert  ", projects: [])

    #expect(rows.first?.label == "Add task \"renew the cert\"")
    #expect(rows.first?.action == .addTask("renew the cert"))
}

// "AT" matches "Atlas Payments" at the start and "Alldata Portal" in the middle,
// and no command label contains it, so this pins the project block and its order
// without the base commands muddying the result.
@Test func projectsMatchOnACaseInsensitiveSubstringInInputOrder() {
    let rows = CommandPaletteLogic.results(
        query: "AT", projects: [atlasProject, beaconProject, alldataProject]
    )

    #expect(rows.map(\.label) == ["Add task \"AT\"", "Atlas Payments", "Alldata Portal"])
    #expect(rows.count == 3)
    #expect(rows[1].hint == "Project")
    #expect(rows[1].symbol == "folder")
    #expect(rows[1].action == .openProject(atlasProject))
    #expect(rows[2].action == .openProject(alldataProject))
}

@Test func commandsMatchOnTheirLabelAndNotTheirHint() {
    let byLabel = CommandPaletteLogic.results(query: "today", projects: [])
    #expect(byLabel.map(\.label) == ["Add task \"today\"", "Go to Today"])

    let byHint = CommandPaletteLogic.results(query: "1", projects: [])
    #expect(byHint.map(\.label) == ["Add task \"1\""])
}

@Test func addTaskThenProjectsThenCommands() {
    let jira = project(id: 4, name: "Jira mirror tools")
    let rows = CommandPaletteLogic.results(query: "jira", projects: [jira])

    #expect(rows.map(\.label) == ["Add task \"jira\"", "Jira mirror tools", "Go to Jira"])
}

@Test func resultsAreNeverEmptySoEnterAlwaysHasARowToRun() {
    #expect(CommandPaletteLogic.results(query: "", projects: []).isEmpty == false)
    #expect(CommandPaletteLogic.results(query: "zzzzz no match zzzzz", projects: []).isEmpty == false)
}

@Test func rowIdsAreUniqueWithinAResultSet() {
    let rows = CommandPaletteLogic.results(
        query: "o", projects: [atlasProject, beaconProject, alldataProject]
    )
    #expect(Set(rows.map(\.id)).count == rows.count)

    let base = CommandPaletteLogic.commands
    #expect(Set(base.map(\.id)).count == base.count)
}

@Test func moveClampsAtBothEnds() {
    #expect(CommandPaletteLogic.move(selection: 0, by: -1, count: 5) == 0)
    #expect(CommandPaletteLogic.move(selection: 4, by: 1, count: 5) == 4)
    #expect(CommandPaletteLogic.move(selection: 2, by: 1, count: 5) == 3)
    #expect(CommandPaletteLogic.move(selection: 2, by: -1, count: 5) == 1)
    #expect(CommandPaletteLogic.move(selection: 9, by: 0, count: 5) == 4)
}

@Test func moveOnAnEmptyListStaysAtZero() {
    #expect(CommandPaletteLogic.move(selection: 0, by: 1, count: 0) == 0)
    #expect(CommandPaletteLogic.move(selection: 3, by: -1, count: 0) == 0)
}
