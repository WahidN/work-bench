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

    static func kicker(for section: SidebarSection, activeProjectCount: Int, todayDateString: String) -> String {
        switch section {
        case .today: todayDateString
        case .projects: "\(activeProjectCount) active"
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

    static func resolvedKicker(
        for section: SidebarSection,
        activeProjectCount: Int,
        todayDateString: String,
        override: String?
    ) -> String {
        override ?? kicker(for: section, activeProjectCount: activeProjectCount, todayDateString: todayDateString)
    }

    static func resolvedHeading(for section: SidebarSection, override: String?) -> String {
        override ?? heading(for: section)
    }
}

struct AppHeader: View {
    let section: SidebarSection
    let activeProjectCount: Int
    var kickerOverride: String? = nil
    var headingOverride: String? = nil
    let onOpenAgent: () -> Void
    let onAddProject: () -> Void
    let isRefreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.s4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(AppHeaderLogic.resolvedKicker(
                    for: section,
                    activeProjectCount: activeProjectCount,
                    todayDateString: AppHeaderLogic.todayDateString(for: Date()),
                    override: kickerOverride
                ))
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.8)
                    .foregroundStyle(Theme.Neutral.n600)
                    .textCase(.uppercase)
                Text(AppHeaderLogic.resolvedHeading(for: section, override: headingOverride))
                    .font(Theme.heading(Theme.FontSize.screenTitle))
                    .tracking(-0.33)
                    .foregroundStyle(Theme.nocturneText)
            }
            Spacer()
            HeaderActionButton(
                title: isRefreshing ? "Refreshing" : "Refresh",
                symbol: "arrow.clockwise",
                help: "Fetch new Jira issues and pull requests now",
                isBusy: isRefreshing,
                action: onRefresh
            )
            if section == .projects {
                HeaderActionButton(
                    title: "Add project", symbol: "plus", help: "Add a project", action: onAddProject
                )
            } else {
                HeaderActionButton(
                    title: "Agent", symbol: "sparkles", help: "Open the agent panel", action: onOpenAgent
                )
            }
        }
        .padding(.vertical, Theme.Space.s6)
        .padding(.horizontal, Theme.Space.s8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }
}

private struct HeaderActionButton: View {
    let title: String
    let symbol: String
    /// Passed in rather than derived from the title, which stopped being possible
    /// the moment there was a third button.
    let help: String
    var isBusy: Bool = false
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Space.s2) {
                if isBusy {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 13, height: 13)
                } else {
                    Image(systemName: symbol)
                }
                Text(title)
                    .font(Theme.heading(14))
            }
            .padding(.vertical, Theme.Space.s2)
            .padding(.horizontal, 10.08)
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .foregroundStyle(isBusy ? Theme.Neutral.n600 : Theme.nocturneAccent)
        .background(isHovered && !isBusy ? Theme.nocturneAccent.opacity(0.12) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(isBusy ? Theme.Neutral.n800 : Theme.nocturneAccent, lineWidth: 1)
        )
        .onHover { isHovered = $0 }
        .help(help)
    }
}
