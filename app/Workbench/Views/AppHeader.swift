import SwiftUI

enum AppHeaderLogic {
    static func kicker(for section: SidebarSection, projectCount: Int, todayDateString: String) -> String {
        switch section {
        case .today: todayDateString
        case .projects: "\(projectCount) project\(projectCount == 1 ? "" : "s")"
        case .pullRequests: "GitHub"
        case .issues: "Jira · GitHub"
        }
    }

    static func heading(for section: SidebarSection) -> String {
        switch section {
        case .today: "Today"
        case .projects: "Projects"
        case .pullRequests: "Pull requests"
        case .issues: "Issues"
        }
    }
}

struct AppHeader: View {
    let section: SidebarSection
    let projectCount: Int
    let onOpenAgent: () -> Void

    private var todayDateString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, d MMMM"
        return formatter.string(from: Date())
    }

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.s4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(AppHeaderLogic.kicker(for: section, projectCount: projectCount, todayDateString: todayDateString))
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.8)
                    .foregroundStyle(Theme.Neutral.n600)
                Text(AppHeaderLogic.heading(for: section))
                    .font(Theme.heading(Theme.FontSize.screenTitle))
                    .foregroundStyle(Theme.nocturneText)
            }
            Spacer()
            Button(action: onOpenAgent) {
                HStack(spacing: Theme.Space.s2) {
                    Image(systemName: "sparkles")
                    Text("Agent")
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.nocturneAccent)
            .padding(.vertical, Theme.Space.s2)
            .padding(.horizontal, Theme.Space.s3)
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.nocturneAccent, lineWidth: 1))
        }
        .padding(.vertical, Theme.Space.s6)
        .padding(.horizontal, Theme.Space.s8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }
}
