import SwiftUI

enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case tickets = "Tickets"
    case pullRequests = "Pull Requests"
    case projects = "Projects"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .today: "sun.max"
        case .tickets: "ticket"
        case .pullRequests: "arrow.triangle.pull"
        case .projects: "folder"
        }
    }
}

struct ContentView: View {
    @Environment(AppDelegate.self) private var appDelegate
    @State private var selection: SidebarSection? = .today
    @State private var todayViewModel = TodayViewModel()
    @State private var ticketsViewModel = TicketsViewModel()
    @State private var prsViewModel = PRsViewModel()
    @State private var projectsViewModel = ProjectsViewModel()

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(SidebarSection.allCases) { section in
                    Label(section.rawValue, systemImage: section.symbol)
                        .tag(section)
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(180)
        } detail: {
            switch selection {
            case .today:
                TodayScreen(viewModel: todayViewModel)
            case .tickets:
                TicketsScreen(viewModel: ticketsViewModel)
            case .pullRequests:
                PRsScreen(viewModel: prsViewModel)
            case .projects:
                ProjectsScreen(viewModel: projectsViewModel)
            case .none:
                Text("Select a section")
            }
        }
        .frame(minWidth: 900, minHeight: 560)
        .preferredColorScheme(.dark)
        .task {
            var previousKeys: Set<String> = []
            var isFirstCycle = true
            while !Task.isCancelled {
                await todayViewModel.load()
                let currentKeys = Set(todayViewModel.needsInput.map(\.uniqueKey))
                if !isFirstCycle {
                    let newlyAppeared = todayViewModel.needsInput.filter { !previousKeys.contains($0.uniqueKey) }
                    for item in newlyAppeared {
                        appDelegate.notify(title: notificationTitle(for: item), body: item.title)
                    }
                }
                previousKeys = currentKeys
                isFirstCycle = false
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .onChange(of: todayViewModel.needsInput.count) { _, newCount in
            appDelegate.updateBadge(count: newCount)
        }
    }

    private func notificationTitle(for item: TodayItem) -> String {
        if item.status == "needs_attention" {
            return item.kind == .ticket ? "Fix failed, needs attention" : "PR needs attention"
        }
        return item.kind == .ticket ? "Ticket ready to spar" : "PR ready for review"
    }
}
