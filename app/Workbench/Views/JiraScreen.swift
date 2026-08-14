import SwiftUI

struct JiraScreen: View {
    @Bindable var viewModel: JiraViewModel
    let projects: [Project]
    let tickets: [Ticket]

    private var groups: [JiraProjectGroup] {
        JiraLogic.groups(todos: viewModel.todos, projects: projects)
    }

    private var rows: [JiraRow] {
        guard let key = viewModel.selectedKey else { return [] }
        return JiraLogic.rows(todos: viewModel.todos, key: key, tickets: tickets)
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s8) {
            picker
            issues
        }
        .frame(maxWidth: 1180, alignment: .topLeading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.nocturneBg)
        .task { await viewModel.load() }
        .alert(
            "Error",
            isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private var picker: some View {
        ScrollView {
            VStack(spacing: 2) {
                ForEach(groups) { group in
                    let isSelected = group.key == viewModel.selectedKey
                    Button {
                        viewModel.select(group.key)
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Circle().fill(group.dot).frame(width: 6, height: 6)
                            Text(group.displayName)
                                .font(.system(size: Theme.FontSize.secondary))
                                .lineLimit(1)
                                .truncationMode(.tail)
                            Spacer()
                            Text("\(group.openCount)")
                                .font(.system(size: Theme.FontSize.label))
                                .foregroundStyle(Theme.Neutral.n600)
                                .monospacedDigit()
                        }
                    }
                    .buttonStyle(WBRowButtonStyle(isSelected: isSelected, selectedBackground: Theme.Neutral.n900))
                    .foregroundStyle(isSelected ? Theme.nocturneText : Theme.Neutral.n500)
                }
            }
            .padding(.vertical, Theme.Space.s8)
            .padding(.leading, Theme.Space.s8)
        }
        .frame(width: 232)
    }

    private var issues: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    Text(JiraLogic.emptyStateText)
                        .font(.system(size: Theme.FontSize.secondary))
                        .foregroundStyle(Theme.Neutral.n600)
                        .padding(.vertical, Theme.Space.s6)
                } else {
                    ForEach(rows) { row in
                        JiraIssueRow(
                            row: row,
                            isBusy: viewModel.busyTodoId == row.id,
                            onPromote: { Task { await viewModel.promote(row) } },
                            onTogglePin: { Task { await viewModel.togglePin(row) } },
                            onCreatePr: { Task { await viewModel.createPr(row) } }
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, Theme.Space.s8)
            .padding(.trailing, Theme.Space.s8)
        }
    }
}

private struct JiraIssueRow: View {
    let row: JiraRow
    let isBusy: Bool
    let onPromote: () -> Void
    let onTogglePin: () -> Void
    let onCreatePr: () -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: TodayLogic.issueSymbol)
                .font(.system(size: 14))
                .foregroundStyle(row.stateColor ?? Theme.Accent.a400)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
                Text(row.title)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.nocturneText)
                HStack(spacing: Theme.Space.s3) {
                    Text(row.ref)
                        .font(.system(size: Theme.FontSize.label))
                        .foregroundStyle(Theme.Accent.a400)
                        .monospacedDigit()
                    if let stateLabel = row.stateLabel {
                        Text(stateLabel)
                            .font(.system(size: Theme.FontSize.tag))
                            .foregroundStyle(Theme.Neutral.n400)
                            .padding(.vertical, 1)
                            .padding(.horizontal, 7)
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.sm)
                                    .strokeBorder(row.stateColor ?? Theme.Neutral.n800, lineWidth: 1)
                            )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            actions
        }
        .padding(.vertical, Theme.Space.s3)
        .padding(.horizontal, Theme.Space.s4)
        .background(isHovered ? Theme.nocturneSurface : Color.clear)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
        .onHover { isHovered = $0 }
    }

    private var actions: some View {
        HStack(spacing: Theme.Space.s3) {
            if row.showsPromote {
                Button("Start fixing this", action: onPromote)
                    .buttonStyle(.plain)
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(isBusy ? Theme.Neutral.n700 : Theme.nocturneAccent)
                    .disabled(isBusy)
                    .help("Analyse this issue and turn it into a ticket")
            }
            if row.showsCreatePr {
                Button("Create PR", action: onCreatePr)
                    .buttonStyle(.plain)
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(isBusy ? Theme.Neutral.n700 : Theme.nocturneAccent)
                    .disabled(isBusy)
                    .help("Create a pull request for this issue's fix")
            }
            JiraIconButton(
                symbol: row.isPinned ? "pin.fill" : "pin",
                tint: row.isPinned ? Theme.nocturneAccent : Theme.Neutral.n700,
                label: row.isPinned ? "Pinned" : "Pin to today",
                action: onTogglePin
            )
            if let url = row.url, let link = URL(string: url) {
                Link(destination: link) {
                    Image(systemName: "arrow.up.right.square").font(.system(size: 14))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.Neutral.n600)
                .help("Open in Jira")
                .accessibilityLabel("Open in Jira")
            }
            // Present but inert until the per-issue agent thread ships in the next phase.
            Image(systemName: "sparkles")
                .font(.system(size: 14))
                .foregroundStyle(Theme.Neutral.n800)
                .help("Agent chat for a Jira issue is not built yet")
                .accessibilityLabel("Chat with the agent, not available yet")
        }
        .padding(.top, 1)
    }
}

private struct JiraIconButton: View {
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
