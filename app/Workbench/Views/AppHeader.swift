import SwiftUI

enum AppHeaderLogic {
    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, d MMMM"
        return formatter
    }()

    static func todayDateString(for date: Date, locale: Locale = Locale(identifier: "en_US_POSIX")) -> String {
        dateFormatter.locale = locale
        return dateFormatter.string(from: date)
    }

    static func kicker(for section: SidebarSection, projectCount: Int, todayDateString: String) -> String {
        switch section {
        case .today: todayDateString
        case .projects: "\(projectCount) project\(projectCount == 1 ? "" : "s")"
        case .pullRequests: "GitHub"
        case .issues: "Jira"
        }
    }

    static func heading(for section: SidebarSection) -> String {
        switch section {
        case .today: "Today"
        case .projects: "Projects"
        case .pullRequests: "Pull requests"
        case .issues: "Jira"
        }
    }
}

struct AppHeader: View {
    let section: SidebarSection
    let projectCount: Int
    let onOpenAgent: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.s4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(AppHeaderLogic.kicker(
                    for: section,
                    projectCount: projectCount,
                    todayDateString: AppHeaderLogic.todayDateString(for: Date())
                ))
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.8)
                    .foregroundStyle(Theme.Neutral.n600)
                    .textCase(.uppercase)
                Text(AppHeaderLogic.heading(for: section))
                    .font(Theme.heading(Theme.FontSize.screenTitle))
                    .tracking(-0.33)
                    .foregroundStyle(Theme.nocturneText)
            }
            Spacer()
            AgentButton(onOpenAgent: onOpenAgent)
        }
        .padding(.vertical, Theme.Space.s6)
        .padding(.horizontal, Theme.Space.s8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }
}

private struct AgentButton: View {
    let onOpenAgent: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onOpenAgent) {
            HStack(spacing: Theme.Space.s2) {
                Image(systemName: "sparkles")
                Text("Agent")
                    .font(Theme.heading(14))
            }
            .padding(.vertical, Theme.Space.s2)
            .padding(.horizontal, 10.08)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.nocturneAccent)
        .background(isHovered ? Theme.nocturneAccent.opacity(0.12) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.nocturneAccent, lineWidth: 1)
        )
        .onHover { isHovered = $0 }
        .help("Open the agent panel")
    }
}
