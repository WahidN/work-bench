enum PaletteAction: Equatable {
    case navigate(SidebarSection)
    case askAgent
    case openProject(Project)
    case addTask(String)
}

/// The action is an enum and not a closure on purpose: a closure would make
/// PaletteRow non-Equatable, and then the matching rules below could only be
/// checked by eye. ContentView interprets the action.
struct PaletteRow: Identifiable, Equatable {
    let id: String
    let symbol: String
    let label: String
    let hint: String
    let action: PaletteAction
}

enum CommandPaletteLogic {
    /// Shown whenever the query is empty. The four navigation rows take their
    /// symbols from SidebarSection so the palette and the sidebar cannot drift.
    static var commands: [PaletteRow] {
        [
            PaletteRow(id: "nav-today", symbol: SidebarSection.today.symbol,
                       label: "Go to Today", hint: "⌘1", action: .navigate(.today)),
            PaletteRow(id: "nav-projects", symbol: SidebarSection.projects.symbol,
                       label: "Go to Projects", hint: "⌘2", action: .navigate(.projects)),
            PaletteRow(id: "nav-prs", symbol: SidebarSection.pullRequests.symbol,
                       label: "Go to Pull requests", hint: "⌘3", action: .navigate(.pullRequests)),
            PaletteRow(id: "nav-jira", symbol: SidebarSection.issues.symbol,
                       label: "Go to Jira", hint: "⌘4", action: .navigate(.issues)),
            PaletteRow(id: "ask-agent", symbol: "sparkles",
                       label: "Ask the agent", hint: "⌘J", action: .askAgent),
        ]
    }

    /// Never returns an empty array: an empty query gives the five commands, and a
    /// non-empty one always gives at least the add-task row. Enter depends on that.
    static func results(query: String, projects: [Project]) -> [PaletteRow] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return commands }

        let needle = trimmed.lowercased()
        let addTask = PaletteRow(
            id: "add-task", symbol: "plus",
            label: "Add task \"\(trimmed)\"", hint: "Enter", action: .addTask(trimmed)
        )
        let matchedProjects = projects
            .filter { $0.name.lowercased().contains(needle) }
            .map {
                PaletteRow(id: "project-\($0.id)", symbol: "folder",
                           label: $0.name, hint: "Project", action: .openProject($0))
            }
        // Matching the label and not the hint is what makes "today" find Go to
        // Today while "1" finds nothing but the task it would add.
        let matchedCommands = commands.filter { $0.label.lowercased().contains(needle) }
        return [addTask] + matchedProjects + matchedCommands
    }

    /// Clamps rather than wraps: one rule instead of two, and no surprise at the ends.
    static func move(selection: Int, by delta: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return max(0, min(count - 1, selection + delta))
    }
}
