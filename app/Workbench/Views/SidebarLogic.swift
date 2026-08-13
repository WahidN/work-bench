import SwiftUI

enum SidebarLogic {
    static func navCount(
        for section: SidebarSection,
        todos: [Todo],
        tickets: [Ticket],
        prs: [PullRequest],
        projects: [Project]
    ) -> Int {
        switch section {
        case .today: todos.filter { !$0.done }.count
        case .projects: projects.count
        case .pullRequests: prs.count
        case .issues: tickets.count
        }
    }

    static func projectOpenCount(for project: Project, todos: [Todo]) -> Int {
        todos.filter { $0.projectId == project.id && !$0.done }.count
    }

    static func projectDotColor(at index: Int) -> Color {
        Theme.projectDotColors[index % Theme.projectDotColors.count]
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
