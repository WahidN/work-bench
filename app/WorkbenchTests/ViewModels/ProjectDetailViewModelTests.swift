import Testing
@testable import Workbench

private struct SavedNote: Equatable {
    let id: Int
    let notes: String
}

/// Lets a test hold `updateProjectNotes` suspended so it can create a real interleaving --
/// two saves racing, or a project switch landing mid-write -- without any sleep. `enter()` is
/// called by the stub on every request; `waitForEntries` lets a test block until N requests have
/// reached the gate; `open()` releases everything waiting (and lets any later arrival straight
/// through).
private actor Gate {
    private var isOpen = false
    private var entryCount = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var entryWaiters: [(threshold: Int, continuation: CheckedContinuation<Void, Never>)] = []

    func enter() async {
        entryCount += 1
        let count = entryCount
        entryWaiters.removeAll { waiter in
            guard count >= waiter.threshold else { return false }
            waiter.continuation.resume()
            return true
        }
        guard !isOpen else { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func waitForEntries(_ count: Int) async {
        if entryCount >= count { return }
        await withCheckedContinuation { entryWaiters.append((count, $0)) }
    }

    func currentEntryCount() -> Int { entryCount }

    func open() {
        isOpen = true
        let toResume = waiters
        waiters = []
        for continuation in toResume {
            continuation.resume()
        }
    }
}

private final class StubNotesAPI: ProjectNotesAPI {
    var saved: [SavedNote] = []
    var error: Error?
    var gate: Gate?

    func updateProjectNotes(id: Int, notes: String) async throws -> Project {
        if let gate { await gate.enter() }
        if let error { throw error }
        saved.append(SavedNote(id: id, notes: notes))
        var project = Project(id: id, name: "Atlas", repoPath: "/repos/atlas", defaultBranch: "main",
                              githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
        project.notes = notes
        return project
    }
}

private func project(id: Int = 1, notes: String = "") -> Project {
    var value = Project(id: id, name: "Atlas", repoPath: "/repos/atlas", defaultBranch: "main",
                        githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    value.notes = notes
    return value
}

/// A never-firing debounce, so a test can prove flush is what saved.
private let never = Duration.seconds(3600)

@MainActor
@Suite(.serialized)
struct ProjectDetailViewModelTests {
    @Test func startLoadsTheProjectsNotes() {
        let model = ProjectDetailViewModel(api: StubNotesAPI(), debounce: never)
        model.start(project: project(notes: "existing"))
        #expect(model.draft == "existing")
    }

    @Test func theDebounceSavesWhatWasTyped() async {
        let api = StubNotesAPI()
        // A no-op sleep makes the scheduled save run immediately, so the test is deterministic
        // rather than timing-dependent.
        let model = ProjectDetailViewModel(api: api, debounce: .zero, sleep: { _ in })
        model.start(project: project())

        model.edited("first line")
        await model.pendingTimer?.value

        #expect(api.saved == [SavedNote(id: 1, notes: "first line")])
        #expect(model.saveError == nil)
    }

    @Test func flushSavesTheLatestTextExactlyOnce() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project())

        model.edited("a")
        model.edited("ab")
        model.edited("abc")
        await model.flush()

        #expect(api.saved == [SavedNote(id: 1, notes: "abc")], "keystrokes coalesce into one save")
    }

    @Test func flushWithNothingTypedSavesNothing() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(notes: "existing"))

        await model.flush()

        #expect(api.saved.isEmpty)
    }

    @Test func flushingTwiceDoesNotSaveTwice() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project())
        model.edited("once")

        await model.flush()
        await model.flush()

        #expect(api.saved == [SavedNote(id: 1, notes: "once")])
    }

    @Test func anEmptyEditIsSaved() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(notes: "delete me"))

        model.edited("")
        await model.flush()

        #expect(api.saved == [SavedNote(id: 1, notes: "")], "clearing your notes is a real edit, not a no-op")
    }

    @Test func aFailedSaveShowsAMessageAndKeepsTheText() async {
        let api = StubNotesAPI()
        api.error = APIError.transportFailed("engine is down")
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project())

        model.edited("still here")
        await model.flush()

        #expect(model.draft == "still here")
        #expect(model.saveError != nil)
    }

    @Test func aReloadOfTheSameProjectDoesNotClobberAnUnsavedDraft() {
        let model = ProjectDetailViewModel(api: StubNotesAPI(), debounce: never)
        model.start(project: project(id: 1, notes: "on the server"))
        model.edited("what I am typing")

        model.start(project: project(id: 1, notes: "on the server"))

        #expect(model.draft == "what I am typing")
    }

    @Test func aReloadOfTheSameProjectAdoptsNewNotesWhenNothingIsUnsaved() {
        let model = ProjectDetailViewModel(api: StubNotesAPI(), debounce: never)
        model.start(project: project(id: 1, notes: "A"))

        model.start(project: project(id: 1, notes: "B"))

        #expect(model.draft == "B", "a late-arriving save for this same project must reach a clean draft")
    }

    @Test func aReloadAfterASaveDoesNotRevertToTheOriginalNotes() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "original"))
        model.edited("updated")
        await model.flush()

        // A re-render can still carry the parent's old copy of the project. Notes are written by
        // exactly one endpoint -- this model -- so that stale copy must not revert what was just saved.
        model.start(project: project(id: 1, notes: "original"))

        #expect(model.draft == "updated", "a reload of the same project must never revert an already-saved edit")
    }

    @Test func switchingProjectSavesTheOldDraftBeforeReplacingIt() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "atlas notes"))
        model.edited("typing about atlas")

        model.start(project: project(id: 2, notes: "relay notes"))
        await model.inFlightWrite?.value

        #expect(model.draft == "relay notes")
        #expect(api.saved == [SavedNote(id: 1, notes: "typing about atlas")],
                 "switching project must not drop the draft, and must target the OLD project id")
    }

    @Test func flushAfterASwitchStillSavesTheDepartingDraft() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "atlas notes"))
        model.edited("typing about atlas")

        model.start(project: project(id: 2, notes: "relay notes"))
        // No manual await of inFlightWrite here: flush itself must wait for a write already
        // in flight rather than abandoning it, so a fast tab switch right after a project
        // switch cannot drop the departing project's text.
        await model.flush()

        #expect(api.saved == [SavedNote(id: 1, notes: "typing about atlas")],
                 "flush must wait for an in-flight departing write, not cancel it")
    }

    @Test func theDepartingWriteDoesNotStampSavedValueForTheNewProject() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "atlas notes"))
        model.edited("typing about atlas")

        model.start(project: project(id: 2, notes: "relay notes"))
        await model.inFlightWrite?.value

        let savedCountBeforeFlush = api.saved.count
        await model.flush()

        #expect(api.saved.count == savedCountBeforeFlush,
                 "a departing write must not mark the new, untouched project dirty")
    }

    @Test func aFailedDepartingWriteDoesNotShowAnErrorOnTheNewProject() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "atlas notes"))
        model.edited("typing about atlas")
        api.error = APIError.transportFailed("engine is down")

        model.start(project: project(id: 2, notes: "relay notes"))
        await model.inFlightWrite?.value

        #expect(model.saveError == nil,
                 "a departing project's failed save must not paint an error banner on the new project")
    }

    @Test func aSuccessfulSaveClearsAnEarlierError() async {
        let api = StubNotesAPI()
        api.error = APIError.transportFailed("engine is down")
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project())
        model.edited("one")
        await model.flush()

        api.error = nil
        model.edited("two")
        await model.flush()

        #expect(model.saveError == nil)
        #expect(api.saved == [SavedNote(id: 1, notes: "two")])
    }

    @Test func twoConcurrentFlushesProduceAtMostOneWrite() async {
        let api = StubNotesAPI()
        let gate = Gate()
        api.gate = gate
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project())
        model.edited("racing")

        let flushA = Task { await model.flush() }
        await gate.waitForEntries(1)
        let flushB = Task { await model.flush() }

        await gate.open()
        await flushA.value
        await flushB.value

        #expect(api.saved == [SavedNote(id: 1, notes: "racing")],
                 "two concurrent flushes must produce at most one write")
    }

    @Test func aWriteThatBecomesStaleMidFlightDoesNotStampTheNewProject() async {
        let api = StubNotesAPI()
        let gate = Gate()
        api.gate = gate
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "atlas notes"))
        model.edited("typing about atlas")

        let flushTask = Task { await model.flush() }
        await gate.waitForEntries(1)

        // The switch lands while the write above is still in flight. start() may itself spawn a
        // second write for the departing project (the draft is still dirty against the pre-switch
        // savedValue); both target project 1, so both are let through the same gate below.
        model.start(project: project(id: 2, notes: "relay notes"))
        await gate.open()
        await flushTask.value
        await model.inFlightWrite?.value

        #expect(model.saveError == nil,
                 "a write that became stale mid-flight must not surface an error for the new project")
        #expect(model.draft == "relay notes")

        let savedCountBeforeFollowUp = api.saved.count
        await model.flush()

        #expect(api.saved.count == savedCountBeforeFollowUp,
                 "a write that became stale mid-flight must not cause a spurious extra write on the new project")
    }

    @Test func departingWriteDoesNotRaceAnAlreadyInFlightSameProjectWrite() async {
        let api = StubNotesAPI()
        let gate = Gate()
        api.gate = gate
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "A"))
        model.edited("B")

        // A save for "B" is already heading to the server, held open at the gate.
        let flushTask = Task { await model.flush() }
        await gate.waitForEntries(1)

        // The user keeps typing before switching away. start()'s departing write must not race
        // the "B" write already in flight -- it has to land after it, not alongside it.
        model.edited("C")
        model.start(project: project(id: 2, notes: "relay notes"))

        // Give the scheduler many chances to run the departing write's own attempt to reach the
        // server. An unordered write would have reached the gate by now; a properly chained one
        // cannot have -- it is still awaiting the "B" task, which nothing has released yet. This
        // is a scheduling yield, not a sleep: it costs no wall-clock time and never times out.
        for _ in 0..<50 {
            await Task.yield()
        }
        let entriesBeforeRelease = await gate.currentEntryCount()

        await gate.open()
        await flushTask.value
        await model.inFlightWrite?.value

        #expect(entriesBeforeRelease == 1,
                 "the departing write must not reach the network before the same-project write already in flight has landed")
        #expect(api.saved == [SavedNote(id: 1, notes: "B"), SavedNote(id: 1, notes: "C")],
                 "the departing write must be ordered after the write already in flight for the same project, so the server ends up holding the newer text, not whichever PUT happens to land last")
    }
}
