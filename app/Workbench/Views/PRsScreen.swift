import SwiftUI

struct PRsScreen: View {
    @Bindable var viewModel: PRsViewModel
    @State private var messageText = ""

    var body: some View {
        HStack(spacing: 0) {
            List(
                viewModel.pullRequests,
                selection: Binding<Int?>(
                    get: { viewModel.selectedPr?.id },
                    set: { id in
                        if let id, let pr = viewModel.pullRequests.first(where: { $0.id == id }) {
                            Task { await viewModel.select(pr) }
                        }
                    }
                )
            ) { pr in
                VStack(alignment: .leading) {
                    Text("#\(pr.number ?? pr.id)").foregroundStyle(Theme.textPrimary)
                    Text(pr.status.rawValue).font(.caption).foregroundStyle(Theme.textMuted)
                }
            }
            .frame(width: 220)
            .listStyle(.sidebar)

            Divider()

            if let pr = viewModel.selectedPr {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text("#\(pr.number ?? pr.id)").font(.headline).foregroundStyle(Theme.textPrimary)
                            if let score = pr.lastReviewScore {
                                Text("Self-reviewed \(String(format: "%.1f", score))/5")
                                    .font(.caption)
                                    .foregroundStyle(Theme.success)
                            }
                        }
                        Spacer()
                        if let urlString = pr.url, let url = URL(string: urlString) {
                            Link("Open in GitHub", destination: url)
                        }
                        Button("Merge") {
                            Task { await viewModel.merge() }
                        }
                        .tint(Theme.success)
                        .disabled(viewModel.isBusy || pr.status == .merged)
                    }

                    if pr.status == .merged {
                        Text("This PR has been merged. The diff is no longer available.")
                            .foregroundStyle(Theme.textMuted)
                    } else if let diffText = viewModel.diffText {
                        DiffView(diffText: diffText).frame(maxHeight: 260)
                    }

                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(pr.messages ?? []) { message in
                                ChatBubble(role: message.role, content: message.content)
                            }
                        }
                    }

                    if pr.status != .merged {
                        TextField("Fix this, ask a question, or say merge it...", text: $messageText)
                            .textFieldStyle(.plain)
                            .padding(8)
                            .background(Theme.cardBackground)
                            .cornerRadius(6)
                            .onSubmit(sendMessage)
                            .disabled(viewModel.isBusy)
                    }
                }
                .padding()
            } else {
                Text("Select a pull request")
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
