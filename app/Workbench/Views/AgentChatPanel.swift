import SwiftUI

struct AgentChatPanel: View {
    @Bindable var viewModel: AgentChatViewModel
    let project: Project?
    let linkedTicket: Ticket?
    let onBackToProject: (Project) -> Void
    /// A send or a merge can change the target's status engine-side, so the lists
    /// behind the panel have to reload.
    let onDidMutate: () -> Void

    private var subject: AgentChatSubject? {
        viewModel.target.map {
            AgentChatLogic.subject(for: $0, project: project, linkedTicket: linkedTicket)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let subject {
                header(subject)
                if let note = subject.note {
                    NoteBanner(text: note)
                }
                messages
                composer(subject)
            }
        }
        .frame(width: 360)
        .frame(maxHeight: .infinity)
        .background(Theme.panelBackground)
        .overlay(alignment: .leading) {
            Rectangle().fill(Theme.Neutral.n800).frame(width: 1)
        }
        .shadow(color: .black.opacity(0.65), radius: 20, x: 0, y: 16)
        .alert(
            "Error",
            isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private func header(_ subject: AgentChatSubject) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1) {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                Image(systemName: targetSymbol)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.nocturneAccent)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: Theme.Space.s1) {
                    Text(subject.kicker)
                        .font(.system(size: Theme.FontSize.label))
                        .tracking(0.8)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.Neutral.n600)
                    Text(subject.title)
                        .font(Theme.heading(Theme.FontSize.secondary))
                        .foregroundStyle(Theme.nocturneText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                PanelIconButton(symbol: "xmark", label: "Close the agent panel") {
                    viewModel.close()
                }
            }
            if let name = subject.backToProjectName, let project {
                BackToProjectButton(projectName: name) { onBackToProject(project) }
            }
        }
        .padding(Theme.Space.s6)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }

    private var targetSymbol: String {
        switch viewModel.target {
        case .pullRequest: "arrow.triangle.pull"
        case .ticket: "list.bullet.rectangle"
        case .todo: "checklist"
        case .project, .none: "folder"
        }
    }

    private var messages: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s6) {
                if let diffText = viewModel.diffText {
                    DiffView(diffText: diffText).frame(maxHeight: 200)
                }
                ForEach(viewModel.messages) { message in
                    MessageBubble(message: message)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Space.s6)
        }
        .defaultScrollAnchor(.bottom)
        .frame(maxHeight: .infinity)
    }

    private func composer(_ subject: AgentChatSubject) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            if AgentChatLogic.canMerge(viewModel.target) {
                MergeButton(isBusy: viewModel.isSending, action: merge)
            }
            FlowRow(spacing: Theme.Space.s2) {
                ForEach(subject.quickPrompts, id: \.self) { prompt in
                    // A chip must not eat a draft the user has already typed.
                    QuickPromptChip(text: prompt) { send(prompt, clearDraft: false) }
                }
            }
            HStack(spacing: Theme.Space.s2) {
                TextField(subject.placeholder, text: $viewModel.draft)
                    .textFieldStyle(.plain)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.nocturneText)
                    .padding(.vertical, Theme.Space.s2)
                    .padding(.horizontal, Theme.Space.s3)
                    .background(Theme.nocturneSurface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.md)
                            .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
                    )
                    .disabled(viewModel.isSending)
                    .onSubmit { send(viewModel.draft, clearDraft: true) }
                SendButton(isBusy: viewModel.isSending) { send(viewModel.draft, clearDraft: true) }
            }
        }
        .padding(Theme.Space.s6)
    }

    // The draft survives a failed send, so the user can retry instead of retyping.
    private func send(_ text: String, clearDraft: Bool) {
        guard !viewModel.isSending else { return }
        Task {
            await viewModel.send(text)
            if viewModel.errorMessage == nil {
                if clearDraft { viewModel.draft = "" }
                onDidMutate()
            }
        }
    }

    private func merge() {
        guard !viewModel.isSending else { return }
        Task {
            await viewModel.merge()
            if viewModel.errorMessage == nil { onDidMutate() }
        }
    }
}

private struct MessageBubble: View {
    let message: AgentMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: Theme.Space.s2) {
            Text(AgentChatLogic.authorLabel(for: message.role))
                .font(.system(size: Theme.FontSize.tag))
                .tracking(0.8)
                .foregroundStyle(Theme.Neutral.n600)
            Text(message.content)
                .font(.system(size: Theme.FontSize.secondary))
                .lineSpacing(3)
                .foregroundStyle(isUser ? Theme.Accent.a100 : Theme.nocturneText)
                .padding(.vertical, Theme.Space.s3)
                .padding(.horizontal, Theme.Space.s4)
                .background(isUser ? Theme.Accent.a900 : Theme.nocturneSurface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.md)
                        .strokeBorder(isUser ? Theme.Accent.a800 : Theme.Neutral.n900, lineWidth: 1)
                )
                .frame(maxWidth: 280, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }
}

private struct QuickPromptChip: View {
    let text: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.system(size: Theme.FontSize.label))
                .padding(.vertical, 3)
                .padding(.horizontal, Theme.Space.s3)
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovered ? Theme.Accent.a200 : Theme.Neutral.n400)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(isHovered ? Theme.nocturneAccent : Theme.Neutral.n800, lineWidth: 1)
        )
        .onHover { isHovered = $0 }
    }
}

private struct SendButton: View {
    let isBusy: Bool
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.up")
                .font(.system(size: 12))
                .padding(Theme.Space.s2)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.nocturneAccent)
        .background(isHovered ? Theme.nocturneAccent.opacity(0.12) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.nocturneAccent, lineWidth: 1)
        )
        .onHover { isHovered = $0 }
        .disabled(isBusy)
        .opacity(isBusy ? 0.5 : 1)
        .accessibilityLabel("Send")
    }
}

private struct NoteBanner: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: Theme.FontSize.tableMeta))
            .foregroundStyle(Theme.Neutral.n600)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.Space.s6)
            .padding(.vertical, Theme.Space.s3)
            .background(Theme.nocturneSurface)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
            }
    }
}

private struct MergeButton: View {
    let isBusy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Merge")
                .font(.system(size: Theme.FontSize.label))
                .padding(.vertical, 3)
                .padding(.horizontal, Theme.Space.s3)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.success)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.sm)
                .strokeBorder(Theme.success, lineWidth: 1)
        )
        .disabled(isBusy)
        .opacity(isBusy ? 0.5 : 1)
    }
}

private struct BackToProjectButton: View {
    let projectName: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Space.s2) {
                Image(systemName: "arrow.left").font(.system(size: 9))
                Text("Back to \(projectName)").font(.system(size: Theme.FontSize.label))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovered ? Theme.nocturneAccent : Theme.Neutral.n500)
        .onHover { isHovered = $0 }
    }
}

private struct PanelIconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12))
                .padding(Theme.Space.s2)
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovered ? Theme.Neutral.n300 : Theme.Neutral.n600)
        .onHover { isHovered = $0 }
        .accessibilityLabel(label)
        .help(label)
    }
}

/// Wraps chips onto as many rows as they need. The three quick prompts do not
/// fit on one 360px row.
private struct FlowRow: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += rowWidth > 0 ? spacing + size.width : size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        return CGSize(width: maxWidth == .infinity ? rowWidth : maxWidth, height: totalHeight + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

extension AnyTransition {
    /// The handoff's `wbSlide`: translateX 24 -> 0 with a fade, 160ms ease-out.
    static var wbSlide: AnyTransition {
        .modifier(
            active: PanelSlideModifier(isActive: true),
            identity: PanelSlideModifier(isActive: false)
        )
    }
}

private struct PanelSlideModifier: ViewModifier {
    let isActive: Bool

    func body(content: Content) -> some View {
        content
            .offset(x: isActive ? 24 : 0)
            .opacity(isActive ? 0 : 1)
    }
}
