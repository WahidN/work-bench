import SwiftUI

struct ProjectsScreen: View {
    @Bindable var viewModel: ProjectsViewModel
    @State private var draft = ProjectDraft()
    @State private var isCreatingNew = false

    var body: some View {
        HStack(spacing: 0) {
            List(
                viewModel.projects,
                selection: Binding<Int?>(
                    get: { isCreatingNew ? nil : viewModel.selectedProject?.id },
                    set: { id in
                        isCreatingNew = false
                        viewModel.selectedProject = viewModel.projects.first { $0.id == id }
                    }
                )
            ) { project in
                Text(project.name).foregroundStyle(Theme.textPrimary)
            }
            .frame(width: 200)
            .listStyle(.sidebar)
            .safeAreaInset(edge: .bottom) {
                Button("+ Add project") {
                    draft = ProjectDraft()
                    isCreatingNew = true
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider()

            if isCreatingNew {
                ProjectFormView(draft: $draft, saveTitle: "Create", onSave: {
                    Task {
                        await viewModel.create(draft.asInput())
                        if viewModel.errorMessage == nil {
                            isCreatingNew = false
                        }
                    }
                }, onRemove: nil)
            } else if viewModel.selectedProject != nil {
                ProjectFormView(draft: $draft, saveTitle: "Save", onSave: {
                    guard let project = viewModel.selectedProject else { return }
                    Task { await viewModel.update(project, draft.asUpdate()) }
                }, onRemove: {
                    guard let project = viewModel.selectedProject else { return }
                    Task { await viewModel.delete(project) }
                })
            } else {
                Text("No projects yet")
                    .foregroundStyle(Theme.textMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .task { await viewModel.load() }
        .onChange(of: viewModel.selectedProject?.id) { _, _ in
            if let project = viewModel.selectedProject {
                draft = ProjectDraft(project: project)
            }
        }
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

private struct ProjectFormView: View {
    @Binding var draft: ProjectDraft
    let saveTitle: String
    let onSave: () -> Void
    let onRemove: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                labeledField("Name", text: $draft.name)
                labeledField("Local repo path", text: $draft.repoPath)
                labeledField("Default branch", text: $draft.defaultBranch)
                labeledField("GitHub repo", text: $draft.githubRepo)
                labeledField("Jira project key", text: $draft.jiraProjectKey)
                labeledField("Sentry project slug", text: $draft.sentryProjectSlug)

                HStack {
                    Button(saveTitle, action: onSave)
                        .tint(Theme.accent)
                    if let onRemove {
                        Button("Remove project", role: .destructive, action: onRemove)
                    }
                }
            }
            .padding(24)
        }
    }

    private func labeledField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.caption).foregroundStyle(Theme.textMuted)
            TextField(label, text: text)
                .textFieldStyle(.plain)
                .padding(8)
                .background(Theme.cardBackground)
                .cornerRadius(6)
        }
    }
}
