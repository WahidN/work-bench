import SwiftUI

enum SidebarLogic {
    static func navCount(
        for section: SidebarSection,
        todos: [Todo],
        jiraTodos: [Todo],
        tickets: [Ticket],
        prs: [PullRequest],
        projects: [Project]
    ) -> Int {
        switch section {
        case .today: todos.filter { !$0.done }.count
        case .projects: projects.count
        case .pullRequests: prs.count
        // Jira work not yet started. Promoted issues are counted by the pipeline
        // surfaces instead, and they are no longer waiting on the user here.
        case .issues: jiraTodos.filter { $0.source == .jira && $0.promotedTicketId == nil && !$0.done }.count
        }
    }

    static func projectOpenCount(for project: Project, todos: [Todo]) -> Int {
        todos.filter { $0.projectId == project.id && ProjectsLogic.isOpenTask($0) }.count
    }

    static func projectDotColor(at index: Int) -> Color {
        Theme.projectDotColors[index % Theme.projectDotColors.count]
    }

    static func isProjectSelected(_ project: Project, selectedProject: Project?) -> Bool {
        project.id == selectedProject?.id
    }

    static func accountInitials(from fullName: String) -> String {
        let parts = fullName.split(separator: " ").filter { !$0.isEmpty }
        if parts.count >= 2 {
            return (parts[0].prefix(1) + parts[1].prefix(1)).uppercased()
        } else if let first = parts.first {
            return first.prefix(2).uppercased()
        }
        return ""
    }
}
