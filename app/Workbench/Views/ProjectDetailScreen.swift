import SwiftUI

enum ProjectDetailTab: String, CaseIterable, Identifiable {
    case tasks = "Tasks"
    case notes = "Notes"

    var id: String { rawValue }
}

struct ProjectDetailScreen: View {
    let project: Project
    let projects: [Project]
    let todos: [Todo]
    let tickets: [Ticket]
    let prs: [PullRequest]
    let onBack: () -> Void
    let onEdit: () -> Void
    let onAddTask: (String) -> Void
    let onToggleTask: (TodayTaskRow) -> Void
    let onOpenWork: (OpenWorkItem) -> Void
    let onChat: (OpenWorkItem) -> Void
    let onChatTodo: (Todo) -> Void

    @State private var tab: ProjectDetailTab = .tasks
    @State private var draft = ""
    @State private var notesModel = ProjectDetailViewModel()

    private var rows: [TodayTaskRow] {
        ProjectDetailLogic.taskRows(
            todos: todos, project: project, projects: projects,
            today: TodayLogic.dayString(for: Date())
        )
    }

    var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: Theme.Space.s8) {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    header
                    tabs
                    if let saveError = notesModel.saveError {
                        Text(saveError)
                            .font(.system(size: Theme.FontSize.label))
                            .foregroundStyle(Theme.Accent.a400)
                    }
                    if tab == .tasks { tasks } else { notes }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)

                rightColumn
                    .frame(width: 300)
            }
            .padding(Theme.Space.s8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.nocturneBg)
        .task(id: project.id) { notesModel.start(project: project) }
        // .task(id:) only fires on a project switch, not on a notes-only change. A save made
        // elsewhere in the same visit (the departing write from a fast project switch, or a late
        // refresh landing after this instance already started from a stale copy) surfaces here.
        .onChange(of: project.notes) { notesModel.start(project: project) }
        .onDisappear { Task { await notesModel.flush() } }
    }

    private var header: some View {
        HStack(spacing: Theme.Space.s3) {
            Button(action: onBack) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                    Text("All projects")
                }
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n500)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer()

            Button(action: onEdit) {
                Text("Edit")
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.Accent.a400)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var tabs: some View {
        HStack(spacing: 0) {
            ForEach(ProjectDetailTab.allCases) { candidate in
                Button {
                    if candidate != tab { Task { await notesModel.flush() } }
                    tab = candidate
                } label: {
                    Text(candidate.rawValue)
                        .font(.system(size: 13))
                        .foregroundStyle(candidate == tab ? Theme.Accent.a200 : Theme.Neutral.n500)
                        .padding(.vertical, Theme.Space.s2)
                        .padding(.horizontal, Theme.Space.s6)
                        .background(candidate == tab ? Theme.Accent.a900 : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .contentShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Neutral.n900, lineWidth: 1)
        )
        .fixedSize()
    }

    private var tasks: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            quickAdd
            let taskRows = rows
            if taskRows.isEmpty {
                Text(ProjectDetailLogic.noTasksText)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.Neutral.n600)
                    .padding(.vertical, Theme.Space.s4)
            } else {
                ForEach(taskRows) { row in
                    TaskRow(
                        row: row,
                        onToggle: { onToggleTask(row) },
                        onCyclePriority: { _ in },
                        onPromote: { _ in },
                        onChat: onChatTodo
                    )
                }
            }
        }
    }

    private var quickAdd: some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "plus")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.nocturneAccent)
            TextField("Add a task, press Enter", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(size: Theme.FontSize.body))
                .foregroundStyle(Theme.nocturneText)
                .onSubmit(addTask)
            Text(project.name)
                .font(.system(size: Theme.FontSize.label))
                .foregroundStyle(Theme.Neutral.n500)
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
        onAddTask(text)
    }

    private var notes: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            TextEditor(text: Binding(
                get: { notesModel.draft },
                set: { notesModel.edited($0) }
            ))
            .font(.system(size: Theme.FontSize.body))
            .lineSpacing(7)
            .scrollContentBackground(.hidden)
            .frame(minHeight: 420)
            .padding(Theme.Space.s6)
            .background(Theme.nocturneSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(Theme.Neutral.n900, lineWidth: 1)
            )
            .overlay(alignment: .topLeading) {
                if notesModel.draft.isEmpty {
                    Text(ProjectDetailLogic.notesPlaceholder)
                        .font(.system(size: Theme.FontSize.body))
                        .foregroundStyle(Theme.Neutral.n600)
                        .padding(Theme.Space.s6)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    private var facts: ProjectFacts {
        ProjectDetailLogic.facts(
            project: project, todos: todos, tickets: tickets, prs: prs, now: Date()
        )
    }

    private var rightColumn: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s6) {
            let projectFacts = facts
            VStack(spacing: Theme.Space.s3) {
                factRow("Status", projectFacts.status)
                factRow("Open tasks", "\(projectFacts.openTasks)")
                factRow("Open PRs", "\(projectFacts.openPrs)")
                factRow("Last activity", projectFacts.lastActivity)
            }
            .padding(Theme.Space.s6)
            .background(Theme.nocturneSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(Theme.Neutral.n900, lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: Theme.Space.s3) {
                Text("OPEN WORK")
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.88)
                    .foregroundStyle(Theme.Neutral.n600)

                let items = ProjectDetailLogic.openWork(project: project, tickets: tickets, prs: prs)
                if items.isEmpty {
                    Text(ProjectDetailLogic.noOpenWorkText)
                        .font(.system(size: Theme.FontSize.tableMeta))
                        .foregroundStyle(Theme.Neutral.n600)
                } else {
                    ForEach(items) { item in
                        OpenWorkRow(
                            item: item,
                            onOpen: { onOpenWork(item) },
                            onChat: { onChat(item) }
                        )
                    }
                }
            }
        }
    }

    private func factRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n500)
            Spacer()
            Text(value)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.nocturneText)
        }
    }
}

private struct OpenWorkRow: View {
    let item: OpenWorkItem
    let onOpen: () -> Void
    let onChat: () -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            HStack(spacing: Theme.Space.s2) {
                Image(systemName: item.symbol)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.Accent.a400)
                Text("\(item.ref) — \(item.title)")
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.nocturneText)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }

            Button(action: onChat) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.Neutral.n500)
                    .padding(.vertical, Theme.Space.s2)
                    .padding(.horizontal, Theme.Space.s4)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Ask the agent about this")
        }
        .padding(.vertical, Theme.Space.s3)
        .padding(.horizontal, Theme.Space.s4)
        .background(Theme.nocturneSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(isHovered ? Theme.Accent.a700 : Theme.Neutral.n900, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .onHover { isHovered = $0 }
    }
}
