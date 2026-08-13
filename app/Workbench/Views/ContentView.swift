import SwiftUI

enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case projects = "Projects"
    case pullRequests = "Pull requests"
    case issues = "Issues"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .today: "sun.horizon"
        case .projects: "square.grid.2x2"
        case .pullRequests: "arrow.triangle.pull"
        case .issues: "list.bullet.rectangle"
        }
    }
}

struct ContentView: View {
    @Environment(AppDelegate.self) private var appDelegate
    @State private var selection: SidebarSection = .today
    @State private var todayViewModel = TodayViewModel()
    @State private var ticketsViewModel = TicketsViewModel()
    @State private var prsViewModel = PRsViewModel()
    @State private var projectsViewModel = ProjectsViewModel()
    @State private var agentChatViewModel = AgentChatViewModel()

    var body: some View {
        HStack(spacing: 0) {
            Sidebar(
                selection: selection,
                todos: todayViewModel.todos,
                tickets: ticketsViewModel.tickets,
                prs: prsViewModel.pullRequests,
                projects: projectsViewModel.projects,
                selectedProject: projectsViewModel.selectedProject,
                onSelect: { selection = $0 },
                onSelectProject: { project in
                    selection = .projects
                    projectsViewModel.selectedProject = project
                }
            )
            VStack(spacing: 0) {
                AppHeader(
                    section: selection,
                    projectCount: projectsViewModel.projects.count,
                    onOpenAgent: openProjectChat
                )
                content
            }
            .overlay(alignment: .trailing) {
                if agentChatViewModel.isOpen {
                    AgentChatPanel(
                        viewModel: agentChatViewModel,
                        project: chatProject,
                        linkedTicket: chatLinkedTicket,
                        onBackToProject: { project in
                            Task { await agentChatViewModel.open(.project(project)) }
                        },
                        onDidMutate: {
                            Task {
                                await ticketsViewModel.load()
                                await prsViewModel.load()
                            }
                        }
                    )
                    .transition(.wbSlide)
                }
            }
            .animation(.easeOut(duration: 0.16), value: agentChatViewModel.isOpen)
        }
        .background(Theme.nocturneBg)
        .frame(minWidth: 900, minHeight: 560)
        .preferredColorScheme(.dark)
        .task { await projectsViewModel.load() }
        // A PR panel takes its title from the linked ticket, so the tickets have to
        // be loaded even before the Issues screen has ever been opened.
        .task { await ticketsViewModel.load() }
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

    @ViewBuilder
    private var content: some View {
        switch selection {
        case .today:
            TodayScreen(viewModel: todayViewModel)
        case .issues:
            TicketsScreen(viewModel: ticketsViewModel, onOpenAgent: openAgent)
        case .pullRequests:
            PRsScreen(viewModel: prsViewModel, onOpenAgent: openAgent)
        case .projects:
            ProjectsScreen(viewModel: projectsViewModel)
        }
    }

    private var chatProject: Project? {
        guard let target = agentChatViewModel.target else { return nil }
        return projectsViewModel.projects.first { $0.id == target.projectId }
    }

    // A PR carries no title of its own; the ticket it was created from supplies it.
    private var chatLinkedTicket: Ticket? {
        guard case .pullRequest(let pr) = agentChatViewModel.target else { return nil }
        return ticketsViewModel.tickets.first { $0.id == pr.ticketId }
    }

    private func openProjectChat() {
        guard let project = projectsViewModel.selectedProject ?? projectsViewModel.projects.first else { return }
        Task { await agentChatViewModel.open(.project(project)) }
    }

    private func openAgent(_ target: AgentChatTarget) {
        Task { await agentChatViewModel.open(target) }
    }

    private func notificationTitle(for item: TodayItem) -> String {
        if item.status == "needs_attention" {
            return item.kind == .ticket ? "Fix failed, needs attention" : "PR needs attention"
        }
        return item.kind == .ticket ? "Ticket ready to spar" : "PR ready for review"
    }
}
