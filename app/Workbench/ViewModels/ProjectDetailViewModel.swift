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
    /// The debounce sleep, then the save it triggers. Cancellable: a new keystroke replaces it.
    private(set) var pendingTimer: Task<Void, Never>?
    /// The network write actually in flight, if any. Awaited, never cancelled -- a save that has
    /// already left for the server must not be abandoned by a later keystroke or tab switch.
    private(set) var inFlightWrite: Task<Void, Never>?

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

    /// Called when the screen appears and on every render for the open project. Notes are written
    /// by exactly one place -- this class -- so once a project is loaded there is no external
    /// change to pick up. A reload of the SAME project is therefore a no-op: applying a re-render's
    /// copy of `Project` here could stomp text this model already saved (or is still holding as an
    /// unsaved draft) with a now-stale value. A different project id is a real switch.
    func start(project: Project) {
        if projectId == project.id {
            return
        }
        pendingTimer?.cancel()
        pendingTimer = nil
        // Switching project must not drop an unsaved draft. start is synchronous, so the old
        // project's text goes out in its own task instead of being discarded. It is stored in
        // inFlightWrite, not the timer slot, so a keystroke on the new project can't cancel it --
        // that used to be able to drop typed text on a fast switch.
        if let previousId = projectId, draft != savedValue {
            let text = draft
            inFlightWrite = Task { await self.write(projectId: previousId, notes: text) }
        }
        projectId = project.id
        savedValue = project.notes
        draft = project.notes
        saveError = nil
    }

    func edited(_ text: String) {
        draft = text
        pendingTimer?.cancel()
        pendingTimer = Task { [debounce, sleep] in
            await sleep(debounce)
            if Task.isCancelled { return }
            await self.save()
        }
    }

    /// Save now if there is anything unsaved. Called on tab switch, on project change and on
    /// disappear, so closing the screen a keystroke after typing cannot lose the text. Only the
    /// timer is cancelled -- a write already in flight is awaited, never abandoned.
    func flush() async {
        pendingTimer?.cancel()
        pendingTimer = nil
        await inFlightWrite?.value
        await save()
    }

    private func save() async {
        guard let projectId, draft != savedValue else { return }
        let notes = draft
        let task = Task { await self.write(projectId: projectId, notes: notes, isCurrent: true) }
        inFlightWrite = task
        await task.value
    }

    /// `isCurrent` is false for the departing project's draft in `start`: that write must not
    /// touch `savedValue` or `saveError`, which by then describe the project now on screen.
    private func write(projectId: Int, notes: String, isCurrent: Bool = false) async {
        do {
            let project = try await api.updateProjectNotes(id: projectId, notes: notes)
            if isCurrent {
                savedValue = project.notes
                saveError = nil
            }
        } catch {
            if isCurrent {
                saveError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
