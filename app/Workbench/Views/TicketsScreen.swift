import SwiftUI

struct TicketsScreen: View {
    @Bindable var viewModel: TicketsViewModel
    let onOpenAgent: (AgentChatTarget) -> Void

    var body: some View {
        HStack(spacing: 0) {
            List(
                viewModel.tickets,
                selection: Binding<Int?>(
                    get: { viewModel.selectedTicket?.id },
                    set: { id in
                        if let id, let ticket = viewModel.tickets.first(where: { $0.id == id }) {
                            viewModel.selectedTicket = ticket
                            Task { await viewModel.select(ticket) }
                        }
                    }
                )
            ) { ticket in
                VStack(alignment: .leading) {
                    Text(ticket.title).foregroundStyle(Theme.textPrimary)
                    Text(WorkItemStatusLabel.ticket(ticket.status))
                        .font(.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .frame(width: 220)
            .listStyle(.sidebar)

            Divider()

            if let ticket = viewModel.selectedTicket {
                VStack(alignment: .leading, spacing: 12) {
                    Text(ticket.title)
                        .font(.headline)
                        .foregroundStyle(Theme.textPrimary)
                    Text(ticket.body)
                        .foregroundStyle(Theme.textSecondary)
                    HStack {
                        Button("Agent") { onOpenAgent(.ticket(ticket)) }
                            .tint(Theme.accent)
                        Button("Create PR") {
                            Task { await viewModel.createPr() }
                        }
                        .tint(Theme.accent)
                        .disabled(viewModel.isSending || !(ticket.status == .new || ticket.status == .sparring))
                    }
                    Spacer()
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("Select an issue")
                    .foregroundStyle(Theme.textMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
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
}
