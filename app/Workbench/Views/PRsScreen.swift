import SwiftUI

struct PRsScreen: View {
    @Bindable var viewModel: PRsViewModel
    let projects: [Project]
    let onOpenAgent: (AgentChatTarget) -> Void

    @State private var filter: PrFilter = .assignedToMe

    private var rows: [PrRow] {
        PRsLogic.rows(prs: viewModel.pullRequests, projects: projects, filter: filter, now: Date())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s6) {
            pills
            table
        }
        .padding(Theme.Space.s8)
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

    private var pills: some View {
        HStack(spacing: Theme.Space.s1) {
            ForEach(PrFilter.allCases) { option in
                Button { filter = option } label: {
                    Text(PRsLogic.label(option))
                        .font(.system(size: Theme.FontSize.secondary))
                        .foregroundStyle(option == filter ? Theme.nocturneText : Theme.Neutral.n500)
                        .padding(.vertical, Theme.Space.s2)
                        .padding(.horizontal, Theme.Space.s4)
                        .background(option == filter ? Theme.nocturneSurface : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(Theme.Space.s1)
        .background(Theme.Neutral.n900.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }

    private var table: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                header
                if rows.isEmpty {
                    Text(PRsLogic.emptyStateText)
                        .font(.system(size: Theme.FontSize.secondary))
                        .foregroundStyle(Theme.Neutral.n600)
                        .padding(.vertical, Theme.Space.s6)
                } else {
                    ForEach(rows) { row in
                        PrTableRow(
                            row: row,
                            onOpenAgent: { onOpenAgent(.pullRequest(row.pr)) },
                            onTogglePin: { Task { await viewModel.togglePin(row.pr) } }
                        )
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: Theme.Space.s3) {
            columnTitle("Pull request").frame(maxWidth: .infinity, alignment: .leading)
            columnTitle("Project").frame(width: 150, alignment: .leading)
            columnTitle("Status").frame(width: 180, alignment: .leading)
            columnTitle("Updated").frame(width: 110, alignment: .leading)
            Spacer().frame(width: 200)
        }
        .padding(.vertical, Theme.Space.s2)
        .padding(.horizontal, Theme.Space.s4)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }

    private func columnTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: Theme.FontSize.label))
            .tracking(0.8)
            .foregroundStyle(Theme.Neutral.n600)
    }
}

private struct PrTableRow: View {
    let row: PrRow
    let onOpenAgent: () -> Void
    let onTogglePin: () -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "arrow.triangle.pull")
                .font(.system(size: 13))
                .foregroundStyle(Theme.Neutral.n600)

            VStack(alignment: .leading, spacing: 3) {
                Text(row.title)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.nocturneText)
                    .lineLimit(1)
                Text(row.ref)
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n600)
                    .monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(row.projectName)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n400)
                .frame(width: 150, alignment: .leading)

            Text(row.statusLabel)
                .font(.system(size: Theme.FontSize.tag))
                .foregroundStyle(Theme.Accent.a400)
                .padding(.vertical, 2)
                .padding(.horizontal, 8)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.sm)
                        .strokeBorder(Theme.Accent.a700, lineWidth: 1)
                )
                .frame(width: 180, alignment: .leading)

            Text(row.updatedText)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n600)
                .frame(width: 110, alignment: .leading)

            actions.frame(width: 200, alignment: .trailing)
        }
        .padding(.vertical, Theme.Space.s3)
        .padding(.horizontal, Theme.Space.s4)
        .background(isHovered ? Theme.nocturneSurface : Color.clear)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpenAgent)
        .onHover { isHovered = $0 }
    }

    private var actions: some View {
        HStack(spacing: Theme.Space.s3) {
            Button(action: onTogglePin) {
                HStack(spacing: 4) {
                    Image(systemName: row.pinned ? "pin.fill" : "pin")
                    Text("Pin to today")
                }
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(row.pinned ? Theme.nocturneAccent : Theme.Neutral.n600)
            }
            .buttonStyle(.plain)
            .help("Show this pull request on Today")

            Button(action: onOpenAgent) {
                HStack(spacing: 4) {
                    Image(systemName: row.messageCount > 0 ? "bubble.left.fill" : "sparkles")
                    Text(row.messageCount > 0 ? "Chat · \(row.messageCount)" : "Agent")
                }
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(row.messageCount > 0 ? Theme.nocturneText : Theme.Neutral.n400)
                .padding(.vertical, Theme.Space.s1)
                .padding(.horizontal, Theme.Space.s3)
                .background(row.messageCount > 0 ? Theme.Accent.a900 : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.sm)
                        .strokeBorder(row.messageCount > 0 ? Color.clear : Theme.Neutral.n800, lineWidth: 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
            }
            .buttonStyle(.plain)
        }
    }
}
