import SwiftUI

struct TaskRow: View {
    let row: TodayTaskRow
    let onToggle: () -> Void
    let onCyclePriority: (Todo) -> Void
    let onPromote: (Todo) -> Void
    let onChat: (Todo) -> Void
    let onDelete: (Todo) -> Void
    @State private var isHovered = false
    @State private var isCheckboxHovered = false
    @State private var isDeleteHovered = false

    private var todo: Todo? {
        if case .todo(let todo) = row.source { return todo }
        return nil
    }

    /// A mirrored Jira issue, whether it sits here as a plain row or as a pinned
    /// pseudo-task. Only these have an issue to discuss; a manual task has no body,
    /// no reference and no source issue. Kept separate from `todo` above, which
    /// deliberately stays narrower so the promote item does not change behaviour.
    private var jiraTodo: Todo? {
        switch row.source {
        case .todo(let todo), .pinnedTodo(let todo):
            return todo.source == .jira ? todo : nil
        case .pinnedTicket, .pinnedPullRequest:
            return nil
        }
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
            deleteButton
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
            if let jiraTodo {
                Button("Chat with the agent") { onChat(jiraTodo) }
            }
            if let todo, todo.canPromote {
                Button("Start fixing this") { onPromote(todo) }
            }
            // Kept alongside the button, not instead of it. The button is what makes
            // deleting discoverable; this is the only route that does not need a
            // pointer, and the button is hover-gated so it has none.
            if let deletable = TodayLogic.deletableTodo(in: row) {
                Button("Delete task") { onDelete(deletable) }
            }
        }
    }

    /// Revealed on hover rather than always drawn: the rows are dense, and deleting
    /// cannot be undone, so the control should not sit under the cursor on every row.
    /// Absent rather than disabled for a mirrored issue, matching `Start fixing this`.
    ///
    /// The space is reserved on every row, deletable or not. Returning EmptyView for a
    /// mirrored issue contributed no width and no HStack spacing, so on Today, where
    /// manual tasks and pinned Jira rows share a section, the title column was narrower
    /// on some rows than others and titles wrapped at different points.
    private var deleteButton: some View {
        let deletable = TodayLogic.deletableTodo(in: row)
        let isVisible = deletable != nil && isHovered
        return Button {
            if let deletable { onDelete(deletable) }
        } label: {
            Image(systemName: "trash")
                .font(.system(size: 11))
                .foregroundStyle(isDeleteHovered ? Theme.Accent.a400 : Theme.Neutral.n500)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
        .opacity(isVisible ? 1 : 0)
        // Opacity rather than removing it from the view tree, so revealing it never
        // shifts the title or the priority label sideways under the cursor. Hit testing
        // follows the opacity, or an invisible button would still swallow clicks.
        .allowsHitTesting(isVisible)
        .onHover { isDeleteHovered = $0 }
        // The alert takes the pointer on click, so onHover never reports false and the
        // trash stayed accent-coloured on a row the cursor had left.
        .onChange(of: isHovered) { _, hovering in
            if !hovering { isDeleteHovered = false }
        }
        .help("Delete task")
        .accessibilityLabel("Delete task")
        .accessibilityHidden(deletable == nil)
    }

    private var checkbox: some View {
        Button(action: onToggle) {
            RoundedRectangle(cornerRadius: 5)
                .fill(row.isDone ? Theme.Accent.a700 : Color.clear)
                .frame(width: 17, height: 17)
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(checkboxBorderColor, lineWidth: 1)
                )
                .overlay {
                    if row.isDone {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.Accent.a100)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
        .onHover { isCheckboxHovered = $0 }
        .accessibilityLabel(checkboxLabel)
    }

    private var checkboxBorderColor: Color {
        if row.isDone { return Theme.nocturneAccent }
        return isCheckboxHovered ? Theme.nocturneAccent : Theme.Neutral.n700
    }

    private var checkboxLabel: String {
        switch row.source {
        case .todo: "Toggle task"
        case .pinnedTodo, .pinnedTicket, .pinnedPullRequest: "Unpin"
        }
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
