import Testing
@testable import Workbench

private func sampleProject(id: Int = 1, name: String = "demo") -> Project {
    Project(id: id, name: name, repoPath: "/repos/\(name)", defaultBranch: "main",
            githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
}

@MainActor
final class MockProjectsAPI: ProjectsAPI {
    var projectsResult: Result<[Project], Error> = .success([])
    var createResult: Result<Project, Error> = .success(sampleProject())
    var updateResult: Result<Project, Error> = .success(sampleProject())
    var deleteResult: Result<Void, Error> = .success(())
    private(set) var deleteCalls: [Int] = []

    func projects() async throws -> [Project] { try projectsResult.get() }
    func createProject(_ input: ProjectInput) async throws -> Project { try createResult.get() }
    func updateProject(id: Int, _ input: ProjectUpdate) async throws -> Project { try updateResult.get() }
    func deleteProject(id: Int) async throws {
        deleteCalls.append(id)
        try deleteResult.get()
    }
}

@MainActor
@Suite
struct ProjectsViewModelTests {
    @Test func loadPopulatesAndSelectsTheFirstProject() async {
        let api = MockProjectsAPI()
        api.projectsResult = .success([sampleProject(id: 1), sampleProject(id: 2, name: "other")])
        let viewModel = ProjectsViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.projects.count == 2)
        #expect(viewModel.selectedProject?.id == 1)
    }

    @Test func loadClearsAnErrorLeftBehindByAnEarlierFailure() async {
        let api = MockProjectsAPI()
        api.projectsResult = .failure(APIError.transportFailed("engine is down"))
        let viewModel = ProjectsViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.errorMessage != nil)

        api.projectsResult = .success([sampleProject(id: 1)])
        await viewModel.load()
        #expect(viewModel.errorMessage == nil)
        #expect(viewModel.projects.map(\.id) == [1])
    }

    @Test func createAppendsAndSelectsTheNewProject() async {
        let api = MockProjectsAPI()
        api.createResult = .success(sampleProject(id: 5, name: "new-one"))
        let viewModel = ProjectsViewModel(api: api)
        await viewModel.create(ProjectInput(name: "new-one", repoPath: "/repos/new-one", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil))
        #expect(viewModel.projects.map(\.id) == [5])
        #expect(viewModel.selectedProject?.id == 5)
    }

    @Test func updateReplacesTheProjectInPlace() async {
        let api = MockProjectsAPI()
        api.projectsResult = .success([sampleProject(id: 1)])
        api.updateResult = .success(sampleProject(id: 1, name: "renamed"))
        let viewModel = ProjectsViewModel(api: api)
        await viewModel.load()
        await viewModel.update(sampleProject(id: 1), ProjectUpdate(name: "renamed"))
        #expect(viewModel.projects.first?.name == "renamed")
        #expect(viewModel.selectedProject?.name == "renamed")
    }

    @Test func deleteRemovesFromTheListOnSuccess() async {
        let api = MockProjectsAPI()
        api.projectsResult = .success([sampleProject(id: 1)])
        let viewModel = ProjectsViewModel(api: api)
        await viewModel.load()
        await viewModel.delete(sampleProject(id: 1))
        #expect(viewModel.projects.isEmpty)
    }

    @Test func deleteWithDependentsLeavesTheProjectInTheListAndSurfacesTheConflict() async {
        let api = MockProjectsAPI()
        api.projectsResult = .success([sampleProject(id: 1)])
        api.deleteResult = .failure(APIError.conflict("project still has tickets or todos referencing it"))
        let viewModel = ProjectsViewModel(api: api)
        await viewModel.load()
        await viewModel.delete(sampleProject(id: 1))
        #expect(viewModel.projects.count == 1, "a failed delete must not remove the project locally")
        #expect(viewModel.errorMessage == "project still has tickets or todos referencing it")
    }
}
