import Observation

protocol ProjectsAPI {
    func projects() async throws -> [Project]
    func createProject(_ input: ProjectInput) async throws -> Project
    func updateProject(id: Int, _ input: ProjectUpdate) async throws -> Project
    func deleteProject(id: Int) async throws
}

extension APIClient: ProjectsAPI {}

@Observable
@MainActor
final class ProjectsViewModel {
    private(set) var projects: [Project] = []
    var selectedProject: Project?
    var errorMessage: String?

    private let api: any ProjectsAPI

    init(api: any ProjectsAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        do {
            projects = try await api.projects()
            if selectedProject == nil {
                selectedProject = projects.first
            }
        } catch {
            present(error)
        }
    }

    func create(_ input: ProjectInput) async {
        do {
            let project = try await api.createProject(input)
            projects.append(project)
            selectedProject = project
        } catch {
            present(error)
        }
    }

    func update(_ project: Project, _ changes: ProjectUpdate) async {
        do {
            let updated = try await api.updateProject(id: project.id, changes)
            if let index = projects.firstIndex(where: { $0.id == updated.id }) {
                projects[index] = updated
            }
            if selectedProject?.id == updated.id {
                selectedProject = updated
            }
        } catch {
            present(error)
        }
    }

    func delete(_ project: Project) async {
        do {
            try await api.deleteProject(id: project.id)
            projects.removeAll { $0.id == project.id }
            if selectedProject?.id == project.id {
                selectedProject = projects.first
            }
        } catch {
            present(error)
        }
    }
}
