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
    /// The most recent save attempt, chained behind whatever came before it. It may complete
    /// without writing at all -- the dirty check runs only after its predecessor has landed -- but
    /// it is always awaited and never cancelled, so a write that does reach the server is never
    /// abandoned by a later keystroke or tab switch.
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
        // inFlightWrite, not the timer slot, so a keystroke on the new project can't cancel it.
        // It chains behind whatever is already in inFlightWrite, exactly like save() below: a
        // write already heading to the server for this same project must not be raced by this
        // one, or the two PUTs could land in either order and leave the server holding older
        // text than what the model believes it saved. If a write for the OLD project is still in
        // flight (or arrives later) when it lands, write's own id check is what keeps it from
        // touching the project now on screen -- see write(projectId:notes:).
        if let previousId = projectId, draft != savedValue {
            let text = draft
            let previous = inFlightWrite
            inFlightWrite = Task { await previous?.value; await self.write(projectId: previousId, notes: text) }
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
    /// timer is cancelled here -- save() itself chains behind any write already in flight rather
    /// than abandoning it, so this doesn't need a wait of its own.
    func flush() async {
        pendingTimer?.cancel()
        pendingTimer = nil
        await save()
    }

    /// Chains the new attempt behind whatever is already in `inFlightWrite` instead of racing it.
    /// Two overlapping callers (a tab switch and onDisappear can both flush) would otherwise both
    /// pass the dirty check while the first write is still in flight, sending two PUTs for the same
    /// project. Assigning the slot here, before this task's first suspension, means a second caller
    /// always finds this one already there and chains behind it -- which is why the dirty check
    /// below is evaluated AFTER `previous` lands rather than before: only then does `savedValue`
    /// reflect what the first write actually saved, so the second caller sees a clean draft and
    /// writes nothing.
    private func save() async {
        let previous = inFlightWrite
        let task = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            guard let pid = self.projectId, self.draft != self.savedValue else { return }
            let notes = self.draft
            await self.write(projectId: pid, notes: notes)
        }
        inFlightWrite = task
        await task.value
    }

    /// `projectId` is this write's OWN target, captured when it was created -- it may no longer
    /// equal `self.projectId` by the time this lands, either because `start` switched projects (the
    /// departing write above) or because a write that was current when it began became stale mid-
    /// flight (a switch landed while it was still in the air). Either way, only a write whose target
    /// still matches the project on screen may stamp `savedValue` or `saveError`; one that doesn't
    /// must touch neither, since those fields by then describe a different project.
    private func write(projectId: Int, notes: String) async {
        do {
            let project = try await api.updateProjectNotes(id: projectId, notes: notes)
            if projectId == self.projectId {
                savedValue = project.notes
                saveError = nil
            }
        } catch {
            if projectId == self.projectId {
                saveError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
