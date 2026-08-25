import SwiftUI

enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case projects = "Projects"
    case pullRequests = "Pull requests"
    case issues = "Jira"

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
    @State private var jiraViewModel = JiraViewModel()
    @State private var projectSheet: ProjectSheetMode?
    @State private var selectedPr: PullRequest?
    // The id, not the Project. A stored struct goes stale the moment the edit sheet saves or a
    // notes save returns a new row, and the header would keep rendering the pre-edit copy.
    // Resolving by id also means a deleted project falls back to the grid on its own.
    @State private var openProjectId: Int?

    var body: some View {
        HStack(spacing: 0) {
            Sidebar(
                selection: selection,
                todos: todayViewModel.todos,
                jiraTodos: jiraViewModel.todos,
                tickets: ticketsViewModel.tickets,
                prs: prsViewModel.pullRequests,
                projects: projectsViewModel.projects,
                selectedProject: projectsViewModel.selectedProject,
                onSelect: { section in
                    selection = section
                    selectedPr = nil
                    openProjectId = nil
                },
                onSelectProject: { project in
                    selection = .projects
                    projectsViewModel.selectedProject = project
                    selectedPr = nil
                    openProjectId = project.id
                }
            )
            VStack(spacing: 0) {
                AppHeader(
                    section: selection,
                    activeProjectCount: ProjectsLogic.activeCount(projectsViewModel.projects),
                    kickerOverride: prHeaderKicker ?? projectHeaderKicker,
                    headingOverride: prHeaderHeading ?? projectHeaderHeading,
                    onOpenAgent: openProjectChat,
                    onAddProject: { projectSheet = .create }
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
            .sheet(item: $projectSheet) { mode in
                let canDelete: Bool = {
                    if case .edit = mode { return true }
                    return false
                }()
                ProjectFormSheet(
                    mode: mode,
                    errorMessage: projectsViewModel.errorMessage,
                    onSave: { draft in
                        Task {
                            switch mode {
                            case .create:
                                await projectsViewModel.create(draft.asInput())
                            case .edit(let project):
                                await projectsViewModel.update(project, draft.asUpdate())
                            }
                            if projectsViewModel.errorMessage == nil { projectSheet = nil }
                        }
                    },
                    onDelete: canDelete ? {
                        guard case .edit(let project) = mode else { return }
                        Task {
                            await projectsViewModel.delete(project)
                            if projectsViewModel.errorMessage == nil { projectSheet = nil }
                        }
                    } : nil,
                    // Clears the error too: otherwise the alert, which is suppressed only
                    // while the sheet is up, fires the moment it closes and re-shows an
                    // error the user has already read inside the sheet.
                    onCancel: {
                        projectsViewModel.errorMessage = nil
                        projectSheet = nil
                    }
                )
            }
            .alert(
                "Error",
                isPresented: Binding(
                    get: { projectsViewModel.errorMessage != nil && !isProjectSheetOpen },
                    set: { if !$0 { projectsViewModel.errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(projectsViewModel.errorMessage ?? "")
            }
        }
        .background(Theme.nocturneBg)
        .frame(minWidth: 900, minHeight: 560)
        .preferredColorScheme(.dark)
        .task { await projectsViewModel.load() }
        // A PR panel takes its title from the linked ticket, so the tickets have to
        // be loaded even before the Issues screen has ever been opened.
        .task { await ticketsViewModel.load() }
        // Today's rail and the sidebar count both read the PR list, so it can no
        // longer wait for the Pull requests screen to be opened.
        .task { await prsViewModel.load() }
        // The sidebar's Jira count reads this list, so it cannot wait for the
        // screen to be opened.
        .task { await jiraViewModel.load() }
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
            TodayScreen(
                viewModel: todayViewModel,
                projects: projectsViewModel.projects,
                tickets: ticketsViewModel.tickets,
                prs: prsViewModel.pullRequests,
                onOpenAgent: openAgent,
                onTogglePinTicket: { ticket in Task { await ticketsViewModel.togglePin(ticket) } },
                onTogglePinPullRequest: { pr in Task { await prsViewModel.togglePin(pr) } },
                onNavigate: { selection = $0 },
                onDidPromote: { Task { await ticketsViewModel.load() } },
                onTogglePinTodo: { todo in Task { await todayViewModel.togglePin(todo) } }
            )
        case .issues:
            JiraScreen(
                viewModel: jiraViewModel,
                projects: projectsViewModel.projects,
                tickets: ticketsViewModel.tickets,
                onDidMutate: { Task { await ticketsViewModel.load() } }
            )
        case .pullRequests:
            if let pr = selectedPr {
                PrDetailScreen(
                    pr: pr,
                    onBack: { selectedPr = nil },
                    onOpenAgent: { openAgent(.pullRequest(pr)) },
                    onDidMerge: { Task { await prsViewModel.load() } }
                )
                .id(pr.id)
            } else {
                PRsScreen(
                    viewModel: prsViewModel,
                    projects: projectsViewModel.projects,
                    onOpenAgent: openAgent,
                    onSelectPr: { selectedPr = $0 }
                )
            }
        case .projects:
            // The Group exists so .task and .onChange have something to attach to: a modifier
            // cannot trail a bare if/else statement. The .pullRequests case has the same shape.
            Group {
            if let project = openProject {
                ProjectDetailScreen(
                    project: project,
                    projects: projectsViewModel.projects,
                    todos: todayViewModel.todos,
                    tickets: ticketsViewModel.tickets,
                    prs: prsViewModel.pullRequests,
                    onBack: { openProjectId = nil },
                    onEdit: { projectSheet = .edit(project) },
                    onAddTask: { text in
                        Task { await todayViewModel.addTodo(text: text, projectId: project.id) }
                    },
                    onToggleTask: { row in toggleProjectTask(row) },
                    onOpenWork: { item in openWork(item) },
                    onChat: { item in openAgent(chatTarget(for: item)) }
                )
                .id(project.id)
            } else {
                ProjectsScreen(
                    cards: ProjectsLogic.cards(
                        projects: projectsViewModel.projects,
                        todos: jiraViewModel.todos,
                        tickets: ticketsViewModel.tickets,
                        prs: prsViewModel.pullRequests,
                        now: Date()
                    ),
                    onSelect: { project in openProjectId = project.id }
                )
            }
            }
            .task { await projectsViewModel.load() }
            .onChange(of: openProjectId) {
                Task {
                    await projectsViewModel.load()
                    await jiraViewModel.load()
                }
            }
        }
    }

    private var isProjectSheetOpen: Bool {
        if case .some = projectSheet { return true }
        return false
    }

    private var chatProject: Project? {
        guard let target = agentChatViewModel.target else { return nil }
        return projectsViewModel.projects.first { $0.id == target.projectId }
    }

    private var openProject: Project? {
        guard let openProjectId else { return nil }
        return projectsViewModel.projects.first { $0.id == openProjectId }
    }

    private var prHeaderKicker: String? {
        guard let pr = selectedPr,
              let project = projectsViewModel.projects.first(where: { $0.id == pr.projectId })
        else { return nil }
        return "GitHub · \(project.name)"
    }

    private var prHeaderHeading: String? {
        guard let pr = selectedPr else { return nil }
        let project = projectsViewModel.projects.first { $0.id == pr.projectId }
        let ref = PRsLogic.ref(for: pr, githubRepo: project?.githubRepo)
        return ref.isEmpty ? nil : ref
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

    private var projectHeaderKicker: String? {
        guard let openProject else { return nil }
        return ProjectsLogic.statusLabel(openProject.status)
    }

    private var projectHeaderHeading: String? {
        openProject?.name
    }

    private func toggleProjectTask(_ row: TodayTaskRow) {
        switch row.source {
        case .todo(let todo):
            Task { await todayViewModel.toggleDone(todo) }
        case .pinnedTodo(let todo):
            Task { await todayViewModel.togglePin(todo) }
        case .pinnedTicket, .pinnedPullRequest:
            break
        }
    }

    private func openWork(_ item: OpenWorkItem) {
        switch item.target {
        case .pullRequest(let pr):
            openProjectId = nil
            selection = .pullRequests
            selectedPr = pr
        case .ticket(let ticket):
            openAgent(.ticket(ticket))
        }
    }

    private func chatTarget(for item: OpenWorkItem) -> AgentChatTarget {
        switch item.target {
        case .pullRequest(let pr): .pullRequest(pr)
        case .ticket(let ticket): .ticket(ticket)
        }
    }

    private func notificationTitle(for item: TodayItem) -> String {
        if item.status == "needs_attention" {
            return item.kind == .ticket ? "Fix failed, needs attention" : "PR needs attention"
        }
        return item.kind == .ticket ? "Ticket ready to spar" : "PR ready for review"
    }
}
