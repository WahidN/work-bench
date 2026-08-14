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
                VStack(alignment: .leading, spacing: Theme.Space.s6) {
                    quickAdd
                    ForEach(sections) { section in
                        TaskSectionView(
                            section: section,
                            onToggle: toggle,
                            onCyclePriority: { todo in Task { await viewModel.cyclePriority(todo) } },
                            onPromote: { todo in Task { await viewModel.promote(todo) } }
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

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
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
                TaskRow(row: row, onToggle: { onToggle(row) }, onCyclePriority: onCyclePriority, onPromote: onPromote)
            }
        }
    }
}

private struct TaskRow: View {
    let row: TodayTaskRow
    let onToggle: () -> Void
    let onCyclePriority: (Todo) -> Void
    let onPromote: (Todo) -> Void
    @State private var isHovered = false

    private var todo: Todo? {
        if case .todo(let todo) = row.source { return todo }
        return nil
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            checkbox
            VStack(alignment: .leading, spacing: 3) {
                Text(row.title)
                    .font(.system(size: Theme.FontSize.body))
                    .lineSpacing(2)
                    .strikethrough(row.isDone)
                    .foregroundStyle(row.isDone ? Theme.Neutral.n500 : Theme.nocturneText)
                meta
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let priority = row.priority {
                Button {
                    if let todo { onCyclePriority(todo) }
                } label: {
                    Text(TodayLogic.priorityLabel(priority))
                        .font(.system(size: Theme.FontSize.label))
                        .tracking(0.44)
                        .foregroundStyle(TodayLogic.priorityColor(priority))
                }
                .buttonStyle(.plain)
                .padding(.top, 3)
                .help("Change priority")
            }
        }
        .padding(.vertical, Theme.Space.s3)
        .padding(.horizontal, Theme.Space.s4)
        .background(row.isDone ? Color.clear : Theme.nocturneSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(isHovered ? Theme.Neutral.n800 : Color.clear, lineWidth: 1)
        )
        .opacity(row.isDone ? 0.42 : 1)
        .onHover { isHovered = $0 }
        .contextMenu {
            if let todo, todo.canPromote {
                Button("Start fixing this") { onPromote(todo) }
            }
        }
    }

    private var checkbox: some View {
        Button(action: onToggle) {
            RoundedRectangle(cornerRadius: 5)
                .fill(row.isDone ? Theme.Accent.a700 : Color.clear)
                .frame(width: 17, height: 17)
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(row.isDone ? Theme.nocturneAccent : Theme.Neutral.n700, lineWidth: 1)
                )
                .overlay {
                    if row.isDone {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.Accent.a100)
                    }
                }
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
        .accessibilityLabel(row.tag == TodayLogic.pinnedTag ? "Unpin" : "Toggle task")
    }

    private var meta: some View {
        HStack(spacing: Theme.Space.s3) {
            HStack(spacing: 5) {
                Circle().fill(row.projectDot).frame(width: 5, height: 5)
                Text(row.projectName)
            }
            .font(.system(size: Theme.FontSize.label))
            .foregroundStyle(Theme.Neutral.n500)

            if let ref = row.ref {
                HStack(spacing: 4) {
                    Image(systemName: row.refSymbol)
                    Text(ref).monospacedDigit()
                }
                .font(.system(size: Theme.FontSize.label))
                .foregroundStyle(Theme.Accent.a400)
            }

            if let tag = row.tag {
                Text(tag)
                    .font(.system(size: Theme.FontSize.tag))
                    .foregroundStyle(Theme.Neutral.n400)
                    .padding(.vertical, 1)
                    .padding(.horizontal, 7)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.sm)
                            .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
                    )
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
