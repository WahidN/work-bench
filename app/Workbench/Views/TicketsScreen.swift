import SwiftUI

struct TicketsScreen: View {
    @Bindable var viewModel: TicketsViewModel
    @State private var messageText = ""

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
                    Text(ticket.status.rawValue).font(.caption).foregroundStyle(Theme.textMuted)
                }
            }
            .frame(width: 220)
            .listStyle(.sidebar)

            Divider()

            if let ticket = viewModel.selectedTicket {
                VStack(alignment: .leading, spacing: 0) {
                    Text(ticket.title)
                        .font(.headline)
                        .foregroundStyle(Theme.textPrimary)
                        .padding()

                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(ticket.messages ?? []) { message in
                                ChatBubble(role: message.role, content: message.content)
                            }
                        }
                        .padding()
                    }

                    HStack {
                        TextField("Reply or redirect Claude...", text: $messageText)
                            .textFieldStyle(.plain)
                            .padding(8)
                            .background(Theme.cardBackground)
                            .cornerRadius(6)
                            .onSubmit(sendMessage)
                            .disabled(viewModel.isSending)
                        Button("Create PR") {
                            Task { await viewModel.createPr() }
                        }
                        .tint(Theme.accent)
                        .disabled(viewModel.isSending || !(ticket.status == .new || ticket.status == .sparring))
                    }
                    .padding()
                }
            } else {
                Text("Select a ticket")
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

    private func sendMessage() {
        let text = messageText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        messageText = ""
        Task { await viewModel.sendMessage(text) }
    }
}
