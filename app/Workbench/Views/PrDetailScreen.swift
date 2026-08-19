import SwiftUI

enum PrDetailTab: String, CaseIterable, Identifiable {
    case files
    case conversation

    var id: String { rawValue }
}

struct PrDetailScreen: View {
    let pr: PullRequest
    let onBack: () -> Void
    let onOpenAgent: () -> Void
    let onDidMerge: () -> Void

    @State private var viewModel = PrDetailViewModel()
    @State private var tab: PrDetailTab = .files
    @State private var collapsedFiles: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s6) {
                backLink
                summary
                tabBar
                content
            }
            .frame(maxWidth: 1180, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(Theme.Space.s8)
        }
        .background(Theme.nocturneBg)
        .task { await viewModel.load(prId: pr.id) }
        .alert(
            "Error",
            isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private var backLink: some View {
        Button(action: onBack) {
            HStack(spacing: Theme.Space.s2) {
                Image(systemName: "arrow.left")
                Text("All pull requests")
                    .font(.system(size: Theme.FontSize.secondary))
            }
            .padding(.vertical, Theme.Space.s1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.Neutral.n500)
    }

    /// Painted from the list row first, so a slow or failing GitHub call still
    /// leaves a screen that says which pull request you are looking at.
    private var summary: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(spacing: Theme.Space.s3) {
                Text(PRsLogic.statusLabel(pr))
                    .font(.system(size: Theme.FontSize.tag))
                    .foregroundStyle(Theme.Neutral.n400)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 8)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.sm)
                            .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
                    )
                if let detail = viewModel.detail {
                    Text(PrDetailLogic.openedLine(detail: detail, authoredByMe: pr.authoredByMe))
                        .font(.system(size: Theme.FontSize.tableMeta))
                        .foregroundStyle(Theme.Neutral.n600)
                }
                Spacer()
                if pr.authoredByMe {
                    mergeButton
                }
            }
            Text(viewModel.detail?.title ?? pr.title)
                .font(Theme.heading(Theme.FontSize.screenTitle))
                .foregroundStyle(Theme.nocturneText)
            facts
        }
    }

    @ViewBuilder
    private var facts: some View {
        if let detail = viewModel.detail {
            let parts = PrDetailLogic.factsParts(detail: detail)
            HStack(spacing: Theme.Space.s4) {
                Text(parts.branches)
                    .font(.system(size: Theme.FontSize.tableMeta, design: .monospaced))
                    .foregroundStyle(Theme.Neutral.n400)
                Text(parts.commits)
                Text(parts.files)
                Text(parts.churn)
                    .foregroundStyle(Theme.Status.approved)
            }
            .font(.system(size: Theme.FontSize.tableMeta))
            .foregroundStyle(Theme.Neutral.n600)
        }
    }

    /// Only ever shown on a pull request you wrote. The engine refuses anything
    /// else, but a squash merge is irreversible so the button is not offered at
    /// all rather than offered and then denied.
    private var mergeButton: some View {
        Button {
            Task {
                await viewModel.merge(prId: pr.id)
                onDidMerge()
            }
        } label: {
            Text(viewModel.isMerging ? "Merging…" : "Merge")
                .font(Theme.heading(Theme.FontSize.secondary))
                .padding(.vertical, Theme.Space.s2)
                .padding(.horizontal, Theme.Space.s4)
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.Status.approved)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Status.approved, lineWidth: 1)
        )
        .disabled(viewModel.isMerging)
    }

    private var tabBar: some View {
        HStack(spacing: Theme.Space.s1) {
            ForEach(PrDetailTab.allCases) { option in
                Button { tab = option } label: {
                    HStack(spacing: Theme.Space.s2) {
                        Image(systemName: option == .files ? "doc.text" : "bubble.left")
                        Text(option == .files ? "Files changed" : "Conversation")
                        Text(count(for: option))
                            .foregroundStyle(Theme.Neutral.n600)
                            .monospacedDigit()
                    }
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(option == tab ? Theme.nocturneText : Theme.Neutral.n500)
                    .padding(.vertical, Theme.Space.s2)
                    .padding(.horizontal, Theme.Space.s4)
                    .background(option == tab ? Theme.nocturneSurface : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                    .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                }
                .buttonStyle(.plain)
            }
            Spacer()
            agentButton
        }
        .padding(Theme.Space.s1)
        .background(Theme.Neutral.n900.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }

    private func count(for tab: PrDetailTab) -> String {
        guard let detail = viewModel.detail else { return "" }
        let counts = PrDetailLogic.tabCounts(detail: detail)
        return String(tab == .files ? counts.files : counts.conversation)
    }

    /// Scoped to this pull request. The header's Agent button stays
    /// project-scoped, so the two never mean the same thing.
    private var agentButton: some View {
        Button(action: onOpenAgent) {
            HStack(spacing: Theme.Space.s2) {
                Image(systemName: "sparkles")
                Text(pr.messageCount > 0 ? "Agent · \(pr.messageCount)" : "Agent")
            }
            .font(.system(size: Theme.FontSize.secondary))
            .padding(.vertical, Theme.Space.s2)
            .padding(.horizontal, Theme.Space.s4)
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.nocturneAccent)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(Theme.nocturneAccent, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.detail == nil {
            Text("Loading from GitHub…")
                .font(.system(size: Theme.FontSize.secondary))
                .foregroundStyle(Theme.Neutral.n600)
        } else if viewModel.detail == nil {
            Text("Could not reach GitHub. The pull request's own details are shown above.")
                .font(.system(size: Theme.FontSize.secondary))
                .foregroundStyle(Theme.Neutral.n600)
        } else if tab == .files {
            filesTab
        } else {
            conversationTab
        }
    }

    @ViewBuilder
    private var filesTab: some View {
        if let detail = viewModel.detail {
            let sections = PrDetailLogic.sections(detail: detail)
            if sections.isEmpty {
                Text("This pull request changes no files.")
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.Neutral.n600)
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    ForEach(sections) { section in
                        PrFileSectionView(
                            section: section,
                            isExpanded: !collapsedFiles.contains(section.id),
                            onToggle: {
                                if collapsedFiles.contains(section.id) {
                                    collapsedFiles.remove(section.id)
                                } else {
                                    collapsedFiles.insert(section.id)
                                }
                            },
                            threadContent: { thread in
                                let commentId = thread.comments.first?.id ?? 0
                                ReviewThreadView(
                                    thread: thread,
                                    draft: viewModel.drafts[commentId],
                                    isBusy: viewModel.busyCommentId == commentId,
                                    onDraft: { Task { await viewModel.draftReply(prId: pr.id, commentId: commentId) } },
                                    onPost: { text in
                                        Task { await viewModel.postReply(prId: pr.id, commentId: commentId, text: text) }
                                    },
                                    onDiscard: { viewModel.drafts[commentId] = nil }
                                )
                            }
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var conversationTab: some View {
        if let detail = viewModel.detail {
            if detail.conversation.isEmpty {
                Text("No reviews or comments yet.")
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.Neutral.n600)
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    ForEach(detail.conversation) { item in
                        ConversationItemView(item: item)
                    }
                }
            }
        }
    }
}

private struct ReviewThreadView: View {
    let thread: PrReviewThread
    let draft: String?
    let isBusy: Bool
    let onDraft: () -> Void
    let onPost: (String) -> Void
    let onDiscard: () -> Void

    // nil means the user has not touched the box, so show the agent's draft.
    // An empty string is a real edit and must be respected, not treated as absent.
    @State private var edited: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            ForEach(thread.comments) { comment in
                VStack(alignment: .leading, spacing: Theme.Space.s1) {
                    HStack(spacing: Theme.Space.s2) {
                        Text(comment.author)
                            .font(Theme.heading(Theme.FontSize.tableMeta))
                            .foregroundStyle(Theme.nocturneText)
                        Spacer()
                        if !thread.isResolved {
                            Text("Unresolved")
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
                    Text(comment.body)
                        .font(.system(size: Theme.FontSize.secondary))
                        .foregroundStyle(Theme.Neutral.n300)
                        .textSelection(.enabled)
                }
            }
            if let draft {
                replyBox(draft)
            } else if let commentId = thread.comments.first?.id {
                Button(action: onDraft) {
                    HStack(spacing: Theme.Space.s2) {
                        Image(systemName: "sparkles")
                        Text(isBusy ? "Drafting…" : "Draft a reply with the agent")
                    }
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(isBusy ? Theme.Neutral.n700 : Theme.nocturneAccent)
                .disabled(isBusy)
                .accessibilityLabel("Draft a reply to comment \(commentId)")
            }
        }
        .padding(Theme.Space.s4)
        .background(Theme.nocturneSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
        )
        // The draft going away means discard or a successful post, and either
        // way any local edit is stale and must not resurface on the next draft.
        .onChange(of: draft) { _, new in if new == nil { edited = nil } }
    }

    /// The draft is editable and nothing leaves the machine until Post is
    /// pressed, because this text lands in a repository other people read.
    private func replyBox(_ draft: String) -> some View {
        let text = edited ?? draft
        let isBlank = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: Theme.Space.s2) {
            TextEditor(text: Binding(get: { edited ?? draft }, set: { edited = $0 }))
                .font(.system(size: Theme.FontSize.secondary))
                .foregroundStyle(Theme.nocturneText)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 72)
                .padding(Theme.Space.s2)
                .background(Theme.nocturneBg)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.sm)
                        .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
                )
            HStack(spacing: Theme.Space.s3) {
                Text("This will be posted to GitHub.")
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n600)
                Spacer()
                Button(action: onDiscard) {
                    Text("Discard")
                        .padding(.vertical, Theme.Space.s1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n500)
                .disabled(isBusy)
                Button(action: { onPost(text) }) {
                    Text(isBusy ? "Posting…" : "Post")
                        .padding(.vertical, Theme.Space.s1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .font(Theme.heading(Theme.FontSize.tableMeta))
                .foregroundStyle(isBusy || isBlank ? Theme.Neutral.n700 : Theme.nocturneAccent)
                .disabled(isBusy || isBlank)
            }
        }
    }
}

/// Read-only. Replying at the conversation level, approving and resolving
/// threads are all GitHub writes the mockup does not show, so they are out.
private struct ConversationItemView: View {
    let item: PrConversationItem

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(spacing: Theme.Space.s3) {
                Text(item.author)
                    .font(Theme.heading(Theme.FontSize.secondary))
                    .foregroundStyle(Theme.nocturneText)
                if let label = stateLabel {
                    Text(label)
                        .font(.system(size: Theme.FontSize.tag))
                        .foregroundStyle(stateColor)
                        .padding(.vertical, 1)
                        .padding(.horizontal, 7)
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                                .strokeBorder(stateColor, lineWidth: 1)
                        )
                }
                Spacer()
            }
            if !item.body.isEmpty {
                Text(item.body)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.Neutral.n300)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Space.s4)
        .background(Theme.nocturneSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Neutral.n900, lineWidth: 1)
        )
    }

    private var stateLabel: String? {
        switch item.state {
        case "APPROVED": "Approved"
        case "CHANGES_REQUESTED": "Changes requested"
        default: nil
        }
    }

    private var stateColor: Color {
        item.state == "APPROVED" ? Theme.Status.approved : Theme.Status.changesRequested
    }
}
