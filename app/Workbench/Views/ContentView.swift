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
    @State private var isPaletteOpen = false
    @State private var paletteQuery = ""
    @State private var paletteSelection = 0
    @State private var todayViewModel = TodayViewModel()
    @State private var ticketsViewModel = TicketsViewModel()
    @State private var prsViewModel = PRsViewModel()
    @State private var projectsViewModel = ProjectsViewModel()
    @State private var agentChatViewModel = AgentChatViewModel()
    @State private var refreshViewModel = RefreshViewModel()
    @State private var settingsViewModel = SettingsViewModel()
    @State private var engineViewModel = EngineViewModel()
    /// Pull requests already announced, so a waiting review is not re-notified on
    /// every poll until the user gets to it.
    @State private var announcedReviews: Set<Int> = []
    @State private var isSettingsOpen = false
    @State private var jiraViewModel = JiraViewModel()
    @State private var projectSheet: ProjectSheetMode?
    @State private var selectedPr: PullRequest?
    // The id, not the Project. A stored struct goes stale the moment the edit sheet saves or a
    // notes save returns a new row, and the header would keep rendering the pre-edit copy.
    // Resolving by id also means a deleted project falls back to the grid on its own.
    @State private var openProjectId: Int?
    @State private var todoPendingDeletion: Todo?
    @State private var deleteError: String?

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
                onSelect: { section in navigate(to: section) },
                onSelectProject: { project in openProject(project) },
                onOpenPalette: openPalette,
                onOpenSettings: { isSettingsOpen = true }
            )
            VStack(spacing: 0) {
                AppHeader(
                    section: selection,
                    activeProjectCount: ProjectsLogic.activeCount(projectsViewModel.projects),
                    kickerOverride: prHeaderKicker ?? projectHeaderKicker,
                    headingOverride: prHeaderHeading ?? projectHeaderHeading,
                    onOpenAgent: openProjectChat,
                    onAddProject: { projectSheet = .create },
                    isRefreshing: refreshViewModel.isRefreshing,
                    onRefresh: refresh
                )
                // Between the header and the content, so it is visible on every screen.
                // An unreachable engine used to look exactly like a screen with no data
                // in it, which is the confusion this exists to end.
                if engineViewModel.isDown {
                    EngineDownBanner(
                        isAgentInstalled: engineViewModel.isAgentInstalled,
                        errorMessage: engineViewModel.errorMessage,
                        isBusy: engineViewModel.isBusy,
                        onStart: { Task { await engineViewModel.start() } },
                        onOpenSettings: { isSettingsOpen = true }
                    )
                }
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
            // The palette belongs to the main column, right of the sidebar, per the
            // handoff. That is why it hangs off this VStack and not the outer HStack.
            .overlay {
                if isPaletteOpen {
                    CommandPalette(
                        rows: paletteRows,
                        selection: paletteSelection,
                        query: $paletteQuery,
                        onRun: runPaletteRow,
                        onMove: { delta in
                            paletteSelection = CommandPaletteLogic.move(
                                selection: paletteSelection, by: delta, count: paletteRows.count
                            )
                        },
                        onHighlight: { paletteSelection = $0 },
                        onClose: { isPaletteOpen = false }
                    )
                    .transition(.wbIn)
                }
            }
            .animation(.easeOut(duration: 0.13), value: isPaletteOpen)
            // Resetting the selection is what makes Enter right after typing hit the
            // add-task row rather than whatever the arrows last landed on.
            .onChange(of: paletteQuery) { paletteSelection = 0 }
            .sheet(isPresented: $isSettingsOpen) {
                // Closing stops the polling, so an unanswered browser trip does not
                // keep asking the engine in the background.
                SettingsSheet(viewModel: settingsViewModel, engine: engineViewModel, onClose: {
                    settingsViewModel.stopPolling()
                    isSettingsOpen = false
                })
            }
            // Runs for the life of the window and stops with it, which is what the
            // spec's "within one minute" bound needs.
            .task { await engineViewModel.poll() }
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
                await announceFinishedReviews()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .onChange(of: todayViewModel.needsInput.count) { _, newCount in
            appDelegate.updateBadge(count: newCount)
        }
        .focusedSceneValue(\.paletteCommands, PaletteCommands(
            openPalette: openPalette,
            navigate: navigate(to:),
            askAgent: openProjectChat
        ))
        // A poll can fail per source, so this is also where an expired Jira token
        // finally becomes visible instead of only reaching the engine's console.
        .alert(
            "Refresh",
            isPresented: Binding(
                get: { refreshViewModel.errorMessage != nil },
                set: { if !$0 { refreshViewModel.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(refreshViewModel.errorMessage ?? "")
        }
    }

    private var content: some View {
        contentBody
            // Here rather than in TaskRow: the row is rendered once per task, so an
            // alert inside it would give every row its own presentation state. Both
            // screens that show a task row route their delete through this one
            // confirmation. Deliberately not on the outer chain next to the Refresh
            // alert: SwiftUI presents one alert per view, and a pending Refresh error
            // swallowed this one, leaving the trash button looking dead.
            .alert(
                "Delete this task?",
                isPresented: Binding(
                    get: { todoPendingDeletion != nil },
                    set: { if !$0 { todoPendingDeletion = nil } }
                ),
                presenting: todoPendingDeletion
            ) { todo in
                Button("Delete", role: .destructive) {
                    todoPendingDeletion = nil
                    Task { deleteError = await todayViewModel.delete(todo) }
                }
                Button("Cancel", role: .cancel) { todoPendingDeletion = nil }
            } message: { todo in
                Text("\u{201C}\(todo.text)\u{201D} and anything the agent said about it are removed for good. There is no undo.")
            }
            // A failed delete has to say so on whichever screen it was started from.
            // TodayViewModel.errorMessage only reaches an alert inside TodayScreen, so a
            // delete from a project's Tasks tab used to fail in complete silence.
            .alert(
                "Could not delete the task",
                isPresented: Binding(
                    get: { deleteError != nil },
                    set: { if !$0 { deleteError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(deleteError ?? "")
            }
    }

    @ViewBuilder
    private var contentBody: some View {
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
                onTogglePinTodo: { todo in Task { await todayViewModel.togglePin(todo) } },
                onChatTodo: openTodoChat,
                onDeleteTodo: { todoPendingDeletion = $0 }
            )
        case .issues:
            JiraScreen(
                viewModel: jiraViewModel,
                projects: projectsViewModel.projects,
                tickets: ticketsViewModel.tickets,
                onDidMutate: { Task { await ticketsViewModel.load() } },
                onChat: { row in openTodoChat(row.todo) }
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
                    onChat: { item in openAgent(chatTarget(for: item)) },
                    onChatTodo: openTodoChat,
                    onDeleteTodo: { todoPendingDeletion = $0 }
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
        guard let projectId = agentChatViewModel.target?.projectId else { return nil }
        return projectsViewModel.projects.first { $0.id == projectId }
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

    /// Asks the engine to fetch Jira and pull requests now, then reloads every list
    /// that could have changed. The view model owns the busy guard, so a second
    /// click while one is in flight is a no-op rather than a second poll.
    private func refresh() {
        Task {
            guard await refreshViewModel.refresh() else { return }
            await todayViewModel.load()
            await ticketsViewModel.load()
            await prsViewModel.load()
            await jiraViewModel.load()
            await projectsViewModel.load()
        }
    }

    private func openTodoChat(_ todo: Todo) {
        openAgent(AgentChatLogic.target(for: todo, tickets: ticketsViewModel.tickets))
    }

    private var paletteRows: [PaletteRow] {
        CommandPaletteLogic.results(query: paletteQuery, projects: projectsViewModel.projects)
    }

    private func openPalette() {
        paletteQuery = ""
        paletteSelection = 0
        isPaletteOpen = true
    }

    /// Clearing both detail routes is not optional: they drive the project detail
    /// and PR detail screens, so leaving them set lands the user on a stale detail
    /// screen instead of the list.
    private func navigate(to section: SidebarSection) {
        selection = section
        selectedPr = nil
        openProjectId = nil
    }

    private func openProject(_ project: Project) {
        selection = .projects
        projectsViewModel.selectedProject = project
        selectedPr = nil
        openProjectId = project.id
    }

    private func runPaletteRow(_ row: PaletteRow) {
        isPaletteOpen = false
        switch row.action {
        case .navigate(let section):
            navigate(to: section)
        case .openProject(let project):
            openProject(project)
        case .askAgent:
            openProjectChat()
        case .addTask(let text):
            Task {
                await todayViewModel.addTodo(text: text)
                navigate(to: .today)
            }
        }
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

    /// Notifies once per pull request whose review has finished with something to
    /// post. Its own signal rather than `needsInput`, which deliberately excludes
    /// review-requested pull requests. See ReviewNotificationLogic.
    private func announceFinishedReviews() async {
        let client = APIClient()
        var reviews: [Int: PrReview] = [:]
        for pr in prsViewModel.pullRequests {
            // A pull request whose review is already announced needs no fetching,
            // and one that has never been reviewed answers with an empty list.
            guard !announcedReviews.contains(pr.id) else { continue }
            if let review = try? await client.review(prId: pr.id) {
                reviews[pr.id] = review
            }
        }

        for prId in ReviewNotificationLogic.toAnnounce(reviews: reviews, alreadyAnnounced: announcedReviews) {
            guard let pr = prsViewModel.pullRequests.first(where: { $0.id == prId }),
                  let review = reviews[prId] else { continue }
            appDelegate.notify(
                title: ReviewNotificationLogic.title(),
                body: ReviewNotificationLogic.body(
                    prTitle: pr.title,
                    count: PrReviewLogic.unposted(review.findings).count
                )
            )
            announcedReviews.insert(prId)
        }
    }

    private func notificationTitle(for item: TodayItem) -> String {
        if item.status == "needs_attention" {
            return item.kind == .ticket ? "Fix failed, needs attention" : "PR needs attention"
        }
        return item.kind == .ticket ? "Ticket ready to spar" : "PR ready for review"
    }
}
