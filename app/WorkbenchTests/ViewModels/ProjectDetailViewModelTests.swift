import Testing
@testable import Workbench

private final class StubNotesAPI: ProjectNotesAPI {
    var saved: [String] = []
    var error: Error?

    func updateProjectNotes(id: Int, notes: String) async throws -> Project {
        if let error { throw error }
        saved.append(notes)
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
        await model.pendingSave?.value

        #expect(api.saved == ["first line"])
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

        #expect(api.saved == ["abc"], "keystrokes coalesce into one save")
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

        #expect(api.saved == ["once"])
    }

    @Test func anEmptyEditIsSaved() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(notes: "delete me"))

        model.edited("")
        await model.flush()

        #expect(api.saved == [""], "clearing your notes is a real edit, not a no-op")
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

    @Test func switchingProjectSavesTheOldDraftBeforeReplacingIt() async {
        let api = StubNotesAPI()
        let model = ProjectDetailViewModel(api: api, debounce: never)
        model.start(project: project(id: 1, notes: "atlas notes"))
        model.edited("typing about atlas")

        model.start(project: project(id: 2, notes: "relay notes"))
        await model.pendingSave?.value

        #expect(model.draft == "relay notes")
        #expect(api.saved == ["typing about atlas"], "switching project must not drop the draft")
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
        #expect(api.saved == ["two"])
    }
}
