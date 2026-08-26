import SwiftUI

struct TodayScreen: View {
    @Bindable var viewModel: TodayViewModel
    let projects: [Project]
    let tickets: [Ticket]
    let prs: [PullRequest]
    let onOpenAgent: (AgentChatTarget) -> Void
    let onTogglePinTicket: (Ticket) -> Void
    let onTogglePinPullRequest: (PullRequest) -> Void
    let onNavigate: (SidebarSection) -> Void
    let onDidPromote: () -> Void
    let onTogglePinTodo: (Todo) -> Void
    let onChatTodo: (Todo) -> Void

    @State private var draft = ""

    private var sections: [TodaySection] {
        TodayLogic.sections(
            todos: viewModel.todos,
            pinnedTickets: tickets.filter(\.pinned),
            pinnedPullRequests: prs.filter(\.pinned),
            tickets: tickets,
            projects: projects,
            today: TodayLogic.dayString(for: Date())
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s8) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.Space.s6) {
                    quickAdd
                    ForEach(sections) { section in
                        TaskSectionView(
                            section: section,
                            onToggle: toggle,
                            onCyclePriority: { todo in Task { await viewModel.cyclePriority(todo) } },
                            onPromote: { todo in Task {
                                await viewModel.promote(todo)
                                onDidPromote()
                            } },
                            onChatTodo: onChatTodo
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Space.s8)
            }

            TodayRail(
                pullRequests: TodayLogic.pullRequestRail(prs: prs, tickets: tickets, projects: projects),
                issues: TodayLogic.issueRail(tickets: tickets, projects: projects),
                onOpenAgent: onOpenAgent,
                onTogglePin: togglePin,
                onNavigate: onNavigate
            )
            .frame(width: 320)
            .padding(.vertical, Theme.Space.s8)
            .padding(.trailing, Theme.Space.s8)
        }
        .frame(maxWidth: 1180, alignment: .topLeading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.nocturneBg)
        .alert(
            "Error",
            isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private var quickAdd: some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "plus")
                .font(.system(size: 15))
                .foregroundStyle(Theme.nocturneAccent)
            TextField("Add a task, press Enter", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(size: Theme.FontSize.body))
                .foregroundStyle(Theme.nocturneText)
                .onSubmit(addTask)
            Text("Today")
                .font(.system(size: Theme.FontSize.label))
                .foregroundStyle(Theme.Neutral.n600)
        }
        .padding(.vertical, Theme.Space.s3)
        .padding(.horizontal, Theme.Space.s4)
        .background(Theme.nocturneSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
        )
    }

    private func addTask() {
        let text = draft.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        draft = ""
        Task { await viewModel.addTodo(text: text) }
    }

    /// A task row's checkbox completes a task; a pinned row's checkbox unpins it.
    private func toggle(_ row: TodayTaskRow) {
        switch row.source {
        case .todo(let todo): Task { await viewModel.toggleDone(todo) }
        case .pinnedTodo(let todo): onTogglePinTodo(todo)
        case .pinnedTicket(let ticket): onTogglePinTicket(ticket)
        case .pinnedPullRequest(let pr): onTogglePinPullRequest(pr)
        }
    }

    private func togglePin(_ target: TodayRailTarget) {
        switch target {
        case .ticket(let ticket): onTogglePinTicket(ticket)
        case .pullRequest(let pr): onTogglePinPullRequest(pr)
        }
    }
}

private struct TaskSectionView: View {
    let section: TodaySection
    let onToggle: (TodayTaskRow) -> Void
    let onCyclePriority: (Todo) -> Void
    let onPromote: (Todo) -> Void
    let onChatTodo: (Todo) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s3) {
                Text(section.label)
                    .font(.system(size: Theme.FontSize.secondary))
                    .tracking(1.04)
                    .textCase(.uppercase)
                    .foregroundStyle(section.color)
                Text("\(section.count)")
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.Neutral.n600)
            }
            .padding(.horizontal, Theme.Space.s1)
            .padding(.bottom, Theme.Space.s2)

            ForEach(section.rows) { row in
                TaskRow(row: row, onToggle: { onToggle(row) }, onCyclePriority: onCyclePriority,
                        onPromote: onPromote, onChat: onChatTodo)
            }
        }
    }
}


private struct TodayRail: View {
    let pullRequests: [TodayRailItem]
    let issues: [TodayRailItem]
    let onOpenAgent: (AgentChatTarget) -> Void
    let onTogglePin: (TodayRailTarget) -> Void
    let onNavigate: (SidebarSection) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s8) {
            railSection(title: "Pull requests", items: pullRequests, destination: .pullRequests)
            railSection(title: "Issues", items: issues, destination: .issues)
        }
    }

    private func railSection(title: String, items: [TodayRailItem], destination: SidebarSection) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.88)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.Neutral.n500)
                Spacer()
                AllLink { onNavigate(destination) }
            }
            ForEach(items) { item in
                RailCard(item: item, onOpenAgent: onOpenAgent, onTogglePin: onTogglePin)
            }
        }
    }
}

private struct AllLink: View {
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button("All", action: action)
            .buttonStyle(.plain)
            .font(.system(size: Theme.FontSize.label))
            .foregroundStyle(isHovered ? Theme.nocturneAccent : Theme.Neutral.n600)
            .onHover { isHovered = $0 }
    }
}

private struct RailCard: View {
    let item: TodayRailItem
    let onOpenAgent: (AgentChatTarget) -> Void
    let onTogglePin: (TodayRailTarget) -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: item.symbol)
                .font(.system(size: 14))
                .foregroundStyle(item.symbolColor)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.nocturneText)
                    .lineLimit(2)
                Text(item.meta)
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n600)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: Theme.Space.s2) {
                RailIconButton(
                    symbol: item.isPinned ? "pin.fill" : "pin",
                    tint: item.isPinned ? Theme.nocturneAccent : Theme.Neutral.n700,
                    label: item.isPinned ? "Pinned" : "Pin to today"
                ) {
                    onTogglePin(item.target)
                }
                RailIconButton(symbol: "sparkles", tint: Theme.Neutral.n600, label: "Chat with the agent") {
                    onOpenAgent(chatTarget)
                }
            }
        }
        .padding(Theme.Space.s3)
        .background(Theme.nocturneSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(isHovered ? Theme.Neutral.n800 : Theme.Neutral.n900, lineWidth: 1)
        )
        .onHover { isHovered = $0 }
    }

    private var chatTarget: AgentChatTarget {
        switch item.target {
        case .ticket(let ticket): .ticket(ticket)
        case .pullRequest(let pr): .pullRequest(pr)
        }
    }
}

private struct RailIconButton: View {
    let symbol: String
    let tint: Color
    let label: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14))
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovered ? Theme.nocturneAccent : tint)
        .onHover { isHovered = $0 }
        .accessibilityLabel(label)
        .help(label)
    }
}
