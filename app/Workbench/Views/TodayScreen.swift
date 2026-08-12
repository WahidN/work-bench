import SwiftUI

struct TodayScreen: View {
    @Bindable var viewModel: TodayViewModel
    @State private var newTodoText = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                sectionHeader("Needs your input", count: viewModel.needsInput.count)
                ForEach(viewModel.needsInput, id: \.uniqueKey) { item in
                    NeedsInputRow(item: item)
                }

                sectionHeader("Todo", count: viewModel.todos.count)
                ForEach(viewModel.todos) { todo in
                    TodoRow(
                        todo: todo,
                        onToggle: { Task { await viewModel.toggleDone(todo) } },
                        onPromote: { Task { await viewModel.promote(todo) } }
                    )
                }

                HStack {
                    TextField("Add a todo...", text: $newTodoText)
                        .textFieldStyle(.plain)
                        .padding(8)
                        .background(Theme.cardBackground)
                        .cornerRadius(6)
                        .onSubmit(addTodo)
                    Button("Add", action: addTodo)
                        .tint(Theme.accent)
                        .disabled(newTodoText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(24)
        }
        .background(Theme.background)
        .alert(
            "Error",
            isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private func sectionHeader(_ title: String, count: Int) -> some View {
        Text("\(title.uppercased()) · \(count)")
            .font(.caption)
            .foregroundStyle(Theme.textMuted)
    }

    private func addTodo() {
        let text = newTodoText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        newTodoText = ""
        Task { await viewModel.addTodo(text: text) }
    }
}

private struct NeedsInputRow: View {
    let item: TodayItem

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).foregroundStyle(Theme.textPrimary)
                Text("\(item.kind == .ticket ? "Ticket" : "PR") · \(item.status)")
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer()
            if let score = item.reviewScore {
                Text(String(format: "%.1f/5", score))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(12)
        .background(Theme.cardBackground)
        .cornerRadius(8)
    }
}

private struct TodoRow: View {
    let todo: Todo
    let onToggle: () -> Void
    let onPromote: () -> Void

    var body: some View {
        HStack {
            Button(action: onToggle) {
                Image(systemName: todo.done ? "checkmark.square.fill" : "square")
            }
            .buttonStyle(.plain)
            Text(todo.text).foregroundStyle(Theme.textPrimary)
            Spacer()
            if todo.canPromote {
                Button("Start fixing this", action: onPromote).font(.caption)
            }
        }
        .padding(8)
    }
}
