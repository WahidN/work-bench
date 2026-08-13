import SwiftUI

struct PRsScreen: View {
    @Bindable var viewModel: PRsViewModel
    let onOpenAgent: (AgentChatTarget) -> Void

    var body: some View {
        HStack(spacing: 0) {
            List(
                viewModel.pullRequests,
                selection: Binding<Int?>(
                    get: { viewModel.selectedPr?.id },
                    set: { id in
                        if let id, let pr = viewModel.pullRequests.first(where: { $0.id == id }) {
                            viewModel.selectedPr = pr
                            Task { await viewModel.select(pr) }
                        }
                    }
                )
            ) { pr in
                VStack(alignment: .leading) {
                    Text("#\(pr.number ?? pr.id)").foregroundStyle(Theme.textPrimary)
                    Text(WorkItemStatusLabel.pullRequest(pr.status))
                        .font(.caption)
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .frame(width: 220)
            .listStyle(.sidebar)

            Divider()

            if let pr = viewModel.selectedPr {
                VStack(alignment: .leading, spacing: 12) {
                    Text("#\(pr.number ?? pr.id)")
                        .font(.headline)
                        .foregroundStyle(Theme.textPrimary)
                    if let score = pr.lastReviewScore {
                        Text("Self-reviewed \(String(format: "%.1f", score))/5")
                            .font(.caption)
                            .foregroundStyle(Theme.success)
                    }
                    HStack {
                        Button("Agent") { onOpenAgent(.pullRequest(pr)) }
                            .tint(Theme.accent)
                        if let urlString = pr.url, let url = URL(string: urlString) {
                            Link("Open in GitHub", destination: url)
                        }
                    }
                    Spacer()
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
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
}
