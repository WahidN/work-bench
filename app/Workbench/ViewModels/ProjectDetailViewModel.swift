import Observation

protocol ProjectNotesAPI {
    func updateProjectNotes(id: Int, notes: String) async throws -> Project
}

extension APIClient: ProjectNotesAPI {}

@Observable
@MainActor
final class ProjectDetailViewModel {
    var draft: String = ""
    private(set) var saveError: String?
    /// Exposed so a test can await the scheduled save instead of sleeping.
    private(set) var pendingSave: Task<Void, Never>?

    private var projectId: Int?
    private var savedValue = ""
    private let api: any ProjectNotesAPI
    private let debounce: Duration
    private let sleep: @Sendable (Duration) async -> Void

    init(
        api: any ProjectNotesAPI = APIClient(),
        debounce: Duration = .milliseconds(1500),
        sleep: @Sendable @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) }
    ) {
        self.api = api
        self.debounce = debounce
        self.sleep = sleep
    }

    /// Called when the screen appears and on every render for the open project. A reload must
    /// not eat what the user is typing, so an unsaved draft for the same project wins over the
    /// server's copy. A different project is a real switch and replaces the draft.
    func start(project: Project) {
        if projectId == project.id {
            if draft != savedValue { return }
            savedValue = project.notes
            draft = project.notes
            return
        }
        pendingSave?.cancel()
        pendingSave = nil
        // Switching project must not drop an unsaved draft. start is synchronous, so the old
        // project's text goes out in its own task instead of being discarded. Today the screen
        // carries .id(project.id) so each project gets its own model and this rarely fires —
        // but relying on a view modifier to prevent data loss puts it one refactor away.
        if let previousId = projectId, draft != savedValue {
            let text = draft
            pendingSave = Task { await self.write(projectId: previousId, notes: text) }
        }
        projectId = project.id
        savedValue = project.notes
        draft = project.notes
        saveError = nil
    }

    func edited(_ text: String) {
        draft = text
        pendingSave?.cancel()
        pendingSave = Task { [debounce, sleep] in
            await sleep(debounce)
            if Task.isCancelled { return }
            await self.save()
        }
    }

    /// Save now if there is anything unsaved. Called on tab switch, on project change and on
    /// disappear, so closing the screen a keystroke after typing cannot lose the text.
    func flush() async {
        pendingSave?.cancel()
        pendingSave = nil
        await save()
    }

    private func save() async {
        guard let projectId, draft != savedValue else { return }
        await write(projectId: projectId, notes: draft, isCurrent: true)
    }

    /// `isCurrent` is false for the departing project's draft in `start`: that write must not
    /// stamp `savedValue`, which by then describes the project now on screen.
    private func write(projectId: Int, notes: String, isCurrent: Bool = false) async {
        do {
            let project = try await api.updateProjectNotes(id: projectId, notes: notes)
            if isCurrent { savedValue = project.notes }
            saveError = nil
        } catch {
            saveError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
