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
            List(SidebarSection.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.symbol)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(180)
        } detail: {
            switch selection {
            case .today:
                Text("Today — Task 15 builds this")
            case .tickets:
                Text("Tickets — Task 16 builds this")
            case .pullRequests:
                Text("Pull Requests — Task 17 builds this")
            case .projects:
                Text("Projects — Task 18 builds this")
            case .none:
                Text("Select a section")
            }
        }
        .frame(minWidth: 900, minHeight: 560)
        .task {
            await todayViewModel.load()
        }
        .onChange(of: todayViewModel.needsInput.count) { _, newCount in
            appDelegate.updateBadge(count: newCount)
        }
    }
}
