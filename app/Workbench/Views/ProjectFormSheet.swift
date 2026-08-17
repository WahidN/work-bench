import SwiftUI

enum ProjectSheetMode: Identifiable {
    case create
    case edit(Project)

    var id: String {
        switch self {
        case .create: "create"
        case .edit(let project): "edit-\(project.id)"
        }
    }
}

struct ProjectFormSheet: View {
    let mode: ProjectSheetMode
    let errorMessage: String?
    let onSave: (ProjectDraft) -> Void
    let onDelete: (() -> Void)?
    let onCancel: () -> Void

    @State private var draft: ProjectDraft

    init(
        mode: ProjectSheetMode,
        errorMessage: String?,
        onSave: @escaping (ProjectDraft) -> Void,
        onDelete: (() -> Void)?,
        onCancel: @escaping () -> Void
    ) {
        self.mode = mode
        self.errorMessage = errorMessage
        self.onSave = onSave
        self.onDelete = onDelete
        self.onCancel = onCancel
        switch mode {
        case .create: _draft = State(initialValue: ProjectDraft())
        case .edit(let project): _draft = State(initialValue: ProjectDraft(project: project))
        }
    }

    private var isCreating: Bool {
        if case .create = mode { return true }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s6) {
            Text(isCreating ? "Add project" : "Edit project")
                .font(Theme.heading(Theme.FontSize.screenTitle))
                .tracking(-0.33)
                .foregroundStyle(Theme.nocturneText)

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    field("Name", text: $draft.name)
                    field("Local repo path", text: $draft.repoPath)
                    field("Default branch", text: $draft.defaultBranch)
                    field("Blurb", text: $draft.blurb)

                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        label("Status")
                        Picker("Status", selection: $draft.status) {
                            Text("Active").tag(ProjectStatus.active)
                            Text("Paused").tag(ProjectStatus.paused)
                            Text("Planning").tag(ProjectStatus.planning)
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }

                    field("GitHub repo", text: $draft.githubRepo)
                    field("Jira project key", text: $draft.jiraProjectKey)
                    field("Sentry project slug", text: $draft.sentryProjectSlug)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: Theme.Space.s3) {
                Button(isCreating ? "Create" : "Save") { onSave(draft) }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.nocturneAccent)
                    .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty
                              || draft.repoPath.trimmingCharacters(in: .whitespaces).isEmpty
                              || draft.defaultBranch.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel", action: onCancel)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.Neutral.n400)
                Spacer()
                if let onDelete {
                    Button("Remove project", role: .destructive, action: onDelete)
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.danger)
                }
            }
        }
        .padding(Theme.Space.s8)
        .frame(width: 460, height: 560)
        .background(Theme.nocturneBg)
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: Theme.FontSize.label))
            .tracking(0.8)
            .foregroundStyle(Theme.Neutral.n600)
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            label(title)
            TextField(title, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: Theme.FontSize.body))
                .foregroundStyle(Theme.nocturneText)
                .padding(.vertical, Theme.Space.s2)
                .padding(.horizontal, Theme.Space.s3)
                .background(Theme.nocturneSurface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.md)
                        .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
                )
        }
    }
}
