import Observation

struct AgentMessage: Identifiable, Equatable {
    let id: Int
    let role: ChatRole
    let content: String
}

protocol AgentChatAPI {
    func projectMessages(id: Int) async throws -> [ProjectMessage]
    func sendProjectMessage(id: Int, text: String) async throws -> ChatReply
    func ticket(id: Int) async throws -> Ticket
    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply
    func pullRequest(id: Int) async throws -> PullRequest
    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult
    func diff(prId: Int) async throws -> DiffResponse
    func mergePr(id: Int) async throws -> PrChatResult
    func todoMessages(id: Int) async throws -> [TodoMessage]
    func sendTodoMessage(id: Int, text: String) async throws -> ChatReply
}

extension APIClient: AgentChatAPI {}

@Observable
@MainActor
final class AgentChatViewModel {
    private(set) var target: AgentChatTarget?
    private(set) var messages: [AgentMessage] = []
    private(set) var isSending = false
    private(set) var diffText: String?
    var draft = ""
    var errorMessage: String?

    private let api: any AgentChatAPI
    private var loadToken = 0

    var isOpen: Bool { target != nil }

    init(api: any AgentChatAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func open(_ target: AgentChatTarget) async {
        loadToken += 1
        let token = loadToken
        self.target = target
        messages = []
        diffText = nil
        draft = ""
        await loadThread(token: token)
    }

    func close() {
        loadToken += 1
        target = nil
        messages = []
        diffText = nil
        draft = ""
    }

    func send(_ text: String) async {
        guard let target, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard !isSending else { return }
        let token = loadToken
        isSending = true
        defer { isSending = false }
        do {
            switch target {
            case .project(let project):
                _ = try await api.sendProjectMessage(id: project.id, text: text)
            case .ticket(let ticket):
                _ = try await api.sendTicketMessage(id: ticket.id, text: text)
            case .pullRequest(let pr):
                _ = try await api.sendPrMessage(id: pr.id, text: text)
            case .todo(let todo):
                _ = try await api.sendTodoMessage(id: todo.id, text: text)
            }
            guard token == loadToken else { return }
            await loadThread(token: token)
        } catch {
            guard token == loadToken else { return }
            present(error)
        }
    }

    func merge() async {
        guard case .pullRequest(let pr) = target else { return }
        guard !isSending else { return }
        let token = loadToken
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.mergePr(id: pr.id)
            guard token == loadToken else { return }
            await loadThread(token: token)
        } catch {
            guard token == loadToken else { return }
            present(error)
        }
    }

    private func loadThread(token: Int) async {
        guard let target else { return }
        do {
            switch target {
            case .project(let project):
                let thread = try await api.projectMessages(id: project.id)
                guard token == loadToken else { return }
                messages = thread.map { AgentMessage(id: $0.id, role: $0.role, content: $0.content) }
            case .ticket(let ticket):
                let detail = try await api.ticket(id: ticket.id)
                guard token == loadToken else { return }
                self.target = .ticket(detail)
                messages = (detail.messages ?? []).map { AgentMessage(id: $0.id, role: $0.role, content: $0.content) }
            case .pullRequest(let pr):
                let detail = try await api.pullRequest(id: pr.id)
                guard token == loadToken else { return }
                self.target = .pullRequest(detail)
                messages = (detail.messages ?? []).map { AgentMessage(id: $0.id, role: $0.role, content: $0.content) }
                await loadDiff(for: detail, token: token)
            // Chatting cannot change a todo's state the way it can a ticket's or a
            // PR's, so this mirrors .project: a plain thread fetch, no target refresh.
            case .todo(let todo):
                let thread = try await api.todoMessages(id: todo.id)
                guard token == loadToken else { return }
                messages = thread.map { AgentMessage(id: $0.id, role: $0.role, content: $0.content) }
            }
        } catch {
            guard token == loadToken else { return }
            present(error)
        }
    }

    // A merged PR has no diff, and the engine answers 409 while another job holds
    // the PR lock. Neither is worth interrupting the thread for.
    private func loadDiff(for pr: PullRequest, token: Int) async {
        guard pr.status != .merged else {
            diffText = nil
            return
        }
        let diff = try? await api.diff(prId: pr.id).diff
        guard token == loadToken else { return }
        diffText = diff
    }
}
