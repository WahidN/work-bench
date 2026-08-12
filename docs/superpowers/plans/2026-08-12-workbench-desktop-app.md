# Workbench Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native SwiftUI macOS app that is the GUI client for the already-built and fully-tested Workbench engine — the desktop app designed in the product spec (Linear-dark theme, three-pane Today/Tickets/Pull Requests layout, menu bar icon, Projects settings) with zero business logic of its own, since the engine already owns all of it.

**Architecture:** A single Xcode project (generated and kept in sync via `xcodegen` from a committed `project.yml`, since hand-editing `.pbxproj` is fragile and unreviewable). A thin `APIClient` talks to the engine over `http://127.0.0.1:4173` with a Bearer token read from the macOS Keychain. `@Observable` view models hold UI state and call the API client; SwiftUI views render that state and never touch the network directly. An `AppDelegate` (bridged in via `@NSApplicationDelegateAdaptor`) owns a plain `NSStatusItem` for the menu bar icon and badge — not SwiftUI's `MenuBarExtra`, because the spec requires "click the icon, bring the window forward, no dropdown," which `MenuBarExtra` doesn't support out of the box.

**Tech Stack:** Swift 6.2, SwiftUI, Xcode 26 project generated via `xcodegen` (Homebrew), Swift Testing (`import Testing`, `@Test`, `#expect` — not XCTest) for unit tests, `URLSession` for networking (no third-party HTTP library), the `Security` framework for Keychain access (no shell-out to the `security` CLI — Swift has native APIs), `UserNotifications` for native notifications. Deployment target macOS 14.0.

## Global Constraints

- The engine is already running and fully tested; this app is a pure client. Never duplicate business logic (merge-phrase matching, review scoring, job locking) client-side — always call the engine and render what it returns.
- Base URL is exactly `http://127.0.0.1:4173` (loopback only, hardcoded — this app only ever talks to a Workbench engine on the same Mac).
- Every request carries `Authorization: Bearer <token>`, where `<token>` comes from the macOS Keychain: service `"workbench"`, account `"api-token"`, generic password class, read via `SecItemCopyMatching` (never shell out to the `security` CLI from this app).
- Error responses are always `{"error": string}` JSON on 400/401/404/409/500. Success bodies are the exact shapes documented per task below — copied verbatim from the engine's real, current source (not the engine's original plan document, which is now historical and inaccurate in places).
- `GET /tickets/:id` and `GET /prs/:id` responses are the ticket/PR's own fields spread flat, plus a sibling `messages` array — not a nested `{ ticket: {...} }` wrapper.
- `GET /today`'s `needsInput` array items are a distinct synthetic shape (`kind`, `id`, `title`, `status`, `reviewScore`), not raw `Ticket`/`Pr` objects.
- No em dashes in any user-facing string (this has been a standing rule throughout this project) — use plain punctuation.
- No third-party dependencies (no SPM packages) unless a task explicitly calls for one — everything here is buildable with Apple's own frameworks.
- Every new Swift file that contains logic (not a pure SwiftUI View) gets a Swift Testing file under `WorkbenchTests/` mirroring its path. SwiftUI View files are verified manually (build and look at it), matching how the engine plan handled its own untestable bootstrap code — there is no automated UI testing in this plan.

---

### Task 1: Xcode project scaffold via xcodegen

**Files:**
- Create: `app/project.yml`
- Create: `app/Workbench/WorkbenchApp.swift`
- Create: `app/Workbench/Info.plist` properties (via xcodegen's `info.properties`, not a hand-written file)
- Create: `app/WorkbenchTests/WorkbenchTests.swift`
- Generated (not committed — add to `.gitignore`): `app/Workbench.xcodeproj/`

**Interfaces:**
- Produces: a working Xcode project with two targets (`Workbench` app, `WorkbenchTests` unit tests) buildable and testable via `xcodebuild` CLI. Every later task adds files under `app/Workbench/` or `app/WorkbenchTests/` and re-runs `xcodegen generate` to pick them up (xcodegen scans the `sources:` directories, so new files are picked up automatically — no manual project-file editing needed, ever).

- [ ] **Step 1: Create `app/project.yml`**

```yaml
name: Workbench
options:
  bundleIdPrefix: com.linku
targets:
  Workbench:
    type: application
    platform: macOS
    deploymentTarget: "14.0"
    sources: [Workbench]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.linku.workbench
        ENABLE_APP_SANDBOX: NO
        CODE_SIGN_STYLE: Automatic
    info:
      path: Workbench/Info.plist
      properties:
        NSHumanReadableCopyright: ""
  WorkbenchTests:
    type: bundle.unit-test
    platform: macOS
    deploymentTarget: "14.0"
    sources: [WorkbenchTests]
    settings:
      base:
        GENERATE_INFOPLIST_FILE: YES
    dependencies:
      - target: Workbench
```

- [ ] **Step 2: Create `app/Workbench/WorkbenchApp.swift`**

```swift
import SwiftUI

@main
struct WorkbenchApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Workbench")
        }
    }
}
```

- [ ] **Step 3: Create `app/WorkbenchTests/WorkbenchTests.swift`**

```swift
import Testing

@Test func placeholderPassesUntilRealTestsExist() {
    #expect(1 + 1 == 2)
}
```

- [ ] **Step 4: Generate the project**

Run: `cd app && xcodegen generate`
Expected: `Created project at .../app/Workbench.xcodeproj`, and `xcodebuild -list -project Workbench.xcodeproj` shows a `Workbench` scheme.

- [ ] **Step 5: Build and test via CLI**

Run: `cd app && xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 1 test passed.

- [ ] **Step 6: Add `.gitignore` for the generated project and Xcode noise**

Create `app/.gitignore`:
```
Workbench.xcodeproj/
xcuserdata/
DerivedData/
.build/
```

- [ ] **Step 7: Commit**

```bash
cd app && git add project.yml Workbench/WorkbenchApp.swift WorkbenchTests/WorkbenchTests.swift .gitignore
git commit -m "Scaffold Workbench desktop app via xcodegen"
```

---

### Task 2: Codable models

These mirror the engine's `src/types.ts` exactly in field names (Swift's automatic `Codable` synthesis matches JSON keys to property names directly — no `CodingKeys` needed anywhere in this task). Type names are renamed for Swift clarity (`Pr` → `PullRequest`, `PrMessage` → `PullRequestMessage`) — this is safe because `Codable` only cares about property names, never the type's own name. `Job`, `ReviewScore`, and `SourceIssue` are deliberately not modeled: no HTTP endpoint ever returns them.

`Ticket`/`PullRequest` each get an optional `messages` field so the same type decodes both the list endpoint (`GET /tickets`, no `messages` key present → decodes to `nil`) and the detail endpoint (`GET /tickets/:id`, flat fields + a `messages` array) without a second duplicate type.

**Files:**
- Create: `app/Workbench/Models/Project.swift`
- Create: `app/Workbench/Models/Todo.swift`
- Create: `app/Workbench/Models/Ticket.swift`
- Create: `app/Workbench/Models/PullRequest.swift`
- Create: `app/Workbench/Models/TodayResponse.swift`
- Test: `app/WorkbenchTests/Models/ModelDecodingTests.swift`

**Interfaces:**
- Produces: `Project`, `TodoSource`, `Todo`, `TicketSource`, `TicketStatus`, `AnalysisConfidence`, `Analysis`, `Ticket`, `ChatRole`, `TicketMessage`, `PrStatus`, `PullRequest`, `PullRequestMessage`, `TodayItem`, `TodayResponse` — every later networking/view-model task decodes into these exact types.

- [ ] **Step 1: Write the failing tests**

```swift
// app/WorkbenchTests/Models/ModelDecodingTests.swift
import Testing
import Foundation
@testable import Workbench

func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

@Test func decodesProject() throws {
    let json = """
    {"id":1,"name":"demo","repoPath":"/repos/demo","defaultBranch":"main",
     "githubRepo":"linku/demo","jiraProjectKey":"DEMO","sentryProjectSlug":"demo-frontend"}
    """
    let project = try decode(Project.self, json)
    #expect(project.id == 1)
    #expect(project.name == "demo")
    #expect(project.githubRepo == "linku/demo")
}

@Test func decodesProjectWithNullOptionalFields() throws {
    let json = """
    {"id":2,"name":"solo","repoPath":"/repos/solo","defaultBranch":"main",
     "githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null}
    """
    let project = try decode(Project.self, json)
    #expect(project.githubRepo == nil)
}

@Test func decodesTodoFromJira() throws {
    let json = """
    {"id":1,"source":"jira","sourceId":"JIRA-DEMO-1","text":"[DEMO-1] Update env vars",
     "body":"Redirect loop.","url":"https://x/browse/DEMO-1","projectId":1,
     "canPromote":true,"done":false,"promotedTicketId":null,"createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let todo = try decode(Todo.self, json)
    #expect(todo.source == .jira)
    #expect(todo.canPromote == true)
}

@Test func decodesManualTodo() throws {
    let json = """
    {"id":2,"source":"manual","sourceId":null,"text":"renew SSL cert","body":"",
     "url":null,"projectId":null,"canPromote":false,"done":false,
     "promotedTicketId":null,"createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let todo = try decode(Todo.self, json)
    #expect(todo.source == .manual)
    #expect(todo.sourceId == nil)
}

@Test func decodesTicketListShapeWithoutMessages() throws {
    let json = """
    {"id":1,"source":"github","sourceId":"GH-demo#1","projectId":1,"title":"Fix null check",
     "body":"desc","url":"https://x","analysis":null,"status":"new","prId":null,
     "createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let ticket = try decode(Ticket.self, json)
    #expect(ticket.status == .new)
    #expect(ticket.messages == nil)
}

@Test func decodesTicketDetailShapeWithMessagesAndAnalysis() throws {
    let json = """
    {"id":1,"source":"github","sourceId":"GH-demo#1","projectId":1,"title":"Fix null check",
     "body":"desc","url":"https://x",
     "analysis":{"summary":"s","rootCause":"r","proposedFix":"p","affectedFiles":["a.ts"],"confidence":"high"},
     "status":"sparring","prId":null,"createdAt":"2026-08-12T00:00:00.000Z",
     "messages":[{"id":1,"ticketId":1,"role":"user","content":"add retry logic","createdAt":"2026-08-12T00:00:00.000Z"}]}
    """
    let ticket = try decode(Ticket.self, json)
    #expect(ticket.analysis?.confidence == .high)
    #expect(ticket.messages?.count == 1)
    #expect(ticket.messages?.first?.role == .user)
}

@Test func decodesPullRequestListShapeWithoutMessages() throws {
    let json = """
    {"id":142,"ticketId":1,"projectId":1,"branch":"fix/github-1","number":142,
     "url":"https://github.com/x/pull/142","status":"open","lastReviewScore":4.6,
     "createdAt":"2026-08-12T00:00:00.000Z"}
    """
    let pr = try decode(PullRequest.self, json)
    #expect(pr.status == .open)
    #expect(pr.lastReviewScore == 4.6)
    #expect(pr.messages == nil)
}

@Test func decodesPullRequestDetailShapeWithMessages() throws {
    let json = """
    {"id":142,"ticketId":1,"projectId":1,"branch":"fix/github-1","number":142,
     "url":"https://github.com/x/pull/142","status":"needs_attention","lastReviewScore":3.2,
     "createdAt":"2026-08-12T00:00:00.000Z",
     "messages":[{"id":1,"prId":142,"role":"assistant","content":"Fix ready for review.","createdAt":"2026-08-12T00:00:00.000Z"}]}
    """
    let pr = try decode(PullRequest.self, json)
    #expect(pr.status == .needsAttention)
    #expect(pr.messages?.first?.role == .assistant)
}

@Test func decodesTodayResponseWithMixedNeedsInput() throws {
    let json = """
    {"needsInput":[
       {"kind":"ticket","id":1,"title":"Add retry logic","status":"sparring","reviewScore":null},
       {"kind":"pr","id":142,"title":"Fix null check","status":"open","reviewScore":4.6}
     ],
     "todos":[{"id":1,"source":"manual","sourceId":null,"text":"call client","body":"",
       "url":null,"projectId":null,"canPromote":false,"done":false,
       "promotedTicketId":null,"createdAt":"2026-08-12T00:00:00.000Z"}]}
    """
    let today = try decode(TodayResponse.self, json)
    #expect(today.needsInput.count == 2)
    #expect(today.needsInput[0].kind == .ticket)
    #expect(today.needsInput[1].kind == .pr)
    #expect(today.needsInput[1].reviewScore == 4.6)
    #expect(today.todos.count == 1)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'Project' in scope` (and similarly for every other type), since none of the model files exist yet.

- [ ] **Step 3: Write `app/Workbench/Models/Project.swift`**

```swift
struct Project: Codable, Identifiable, Equatable {
    let id: Int
    var name: String
    var repoPath: String
    var defaultBranch: String
    var githubRepo: String?
    var jiraProjectKey: String?
    var sentryProjectSlug: String?
}
```

- [ ] **Step 4: Write `app/Workbench/Models/Todo.swift`**

```swift
enum TodoSource: String, Codable {
    case manual
    case jira
}

struct Todo: Codable, Identifiable, Equatable {
    let id: Int
    let source: TodoSource
    let sourceId: String?
    var text: String
    let body: String
    let url: String?
    let projectId: Int?
    let canPromote: Bool
    var done: Bool
    let promotedTicketId: Int?
    let createdAt: String
}
```

- [ ] **Step 5: Write `app/Workbench/Models/Ticket.swift`**

```swift
enum TicketSource: String, Codable {
    case sentry, github, jira
}

enum TicketStatus: String, Codable {
    case new
    case sparring
    case inReview = "in_review"
    case done
    case needsAttention = "needs_attention"
}

enum AnalysisConfidence: String, Codable {
    case low, medium, high
}

struct Analysis: Codable, Equatable {
    let summary: String
    let rootCause: String
    let proposedFix: String
    let affectedFiles: [String]
    let confidence: AnalysisConfidence
}

enum ChatRole: String, Codable {
    case user, assistant
}

struct TicketMessage: Codable, Identifiable, Equatable {
    let id: Int
    let ticketId: Int
    let role: ChatRole
    let content: String
    let createdAt: String
}

struct Ticket: Codable, Identifiable, Equatable {
    let id: Int
    let source: TicketSource
    let sourceId: String
    let projectId: Int
    let title: String
    let body: String
    let url: String
    let analysis: Analysis?
    var status: TicketStatus
    var prId: Int?
    let createdAt: String
    var messages: [TicketMessage]?
}
```

- [ ] **Step 6: Write `app/Workbench/Models/PullRequest.swift`**

```swift
enum PrStatus: String, Codable {
    case open
    case needsAttention = "needs_attention"
    case merged
}

struct PullRequestMessage: Codable, Identifiable, Equatable {
    let id: Int
    let prId: Int
    let role: ChatRole
    let content: String
    let createdAt: String
}

struct PullRequest: Codable, Identifiable, Equatable {
    let id: Int
    let ticketId: Int
    let projectId: Int
    let branch: String
    let number: Int?
    let url: String?
    var status: PrStatus
    var lastReviewScore: Double?
    let createdAt: String
    var messages: [PullRequestMessage]?
}
```

- [ ] **Step 7: Write `app/Workbench/Models/TodayResponse.swift`**

```swift
struct TodayItem: Codable, Equatable {
    enum Kind: String, Codable {
        case ticket, pr
    }
    let kind: Kind
    let id: Int
    let title: String
    let status: String
    let reviewScore: Double?

    var uniqueKey: String { "\(kind.rawValue)-\(id)" }
}

struct TodayResponse: Codable, Equatable {
    let needsInput: [TodayItem]
    let todos: [Todo]
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 10 tests passed (9 new + the Task 1 placeholder — delete the placeholder test now that real tests exist).

- [ ] **Step 9: Delete the placeholder test**

Remove the `placeholderPassesUntilRealTestsExist` test body from `app/WorkbenchTests/WorkbenchTests.swift` (leave the file empty or delete it — either is fine, xcodegen doesn't require test files to exist beyond at least one, and the model tests now cover that).

- [ ] **Step 10: Commit**

```bash
cd app && git add Workbench/Models WorkbenchTests/Models WorkbenchTests/WorkbenchTests.swift
git commit -m "Add Codable models matching the engine's API contract"
```

---

### Task 3: KeychainClient

A generic wrapper around the `Security` framework's generic-password APIs (`SecItemCopyMatching`/`SecItemAdd`/`SecItemUpdate`/`SecItemDelete`) — the engine's Keychain items (service `workbench`, accounts `api-token`, `jira-api-token`, etc.) were created by its own Node code shelling out to the `security` CLI, but they're plain generic-password Keychain items with no special access-group restriction, so this app reads them directly via the native Swift APIs with no special entitlement needed (this app is not sandboxed — confirmed via `ENABLE_APP_SANDBOX: NO` in Task 1's `project.yml`).

Tests use a distinct service name (`workbench-tests`, not `workbench`) so they never read, write, or delete any of your real credentials.

**Files:**
- Create: `app/Workbench/Networking/KeychainClient.swift`
- Test: `app/WorkbenchTests/Networking/KeychainClientTests.swift`

**Interfaces:**
- Produces: `KeychainClient(service: String = "workbench")` with `readSecret(account: String) throws -> String?`, `writeSecret(_ value: String, account: String) throws`, `deleteSecret(account: String) throws`, and `KeychainError`. The `APIClient` (Task 4) calls `readSecret(account: "api-token")` on a `KeychainClient(service: "workbench")` instance to get the bearer token.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/Networking/KeychainClientTests.swift
import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct KeychainClientTests {
    let client = KeychainClient(service: "workbench-tests")
    let account = "round-trip-test"

    init() throws {
        try? client.deleteSecret(account: account)
    }

    @Test func writeThenReadReturnsTheSameValue() throws {
        try client.writeSecret("hello-keychain", account: account)
        let value = try client.readSecret(account: account)
        #expect(value == "hello-keychain")
        try client.deleteSecret(account: account)
    }

    @Test func readingAMissingAccountReturnsNilNotAnError() throws {
        let value = try client.readSecret(account: "does-not-exist-\(UUID().uuidString)")
        #expect(value == nil)
    }

    @Test func writingTwiceUpdatesInPlaceRatherThanThrowing() throws {
        try client.writeSecret("first", account: account)
        try client.writeSecret("second", account: account)
        let value = try client.readSecret(account: account)
        #expect(value == "second")
        try client.deleteSecret(account: account)
    }

    @Test func deletingAMissingAccountDoesNotThrow() throws {
        try client.deleteSecret(account: "does-not-exist-\(UUID().uuidString)")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'KeychainClient' in scope`.

- [ ] **Step 3: Write `app/Workbench/Networking/KeychainClient.swift`**

```swift
import Foundation
import Security

enum KeychainError: Error, LocalizedError {
    case unexpectedStatus(OSStatus)
    case unableToDecodeData

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status):
            return "Keychain error (status \(status))"
        case .unableToDecodeData:
            return "Keychain item was not valid UTF-8 text"
        }
    }
}

struct KeychainClient {
    let service: String

    init(service: String = "workbench") {
        self.service = service
    }

    func readSecret(account: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainError.unexpectedStatus(status)
        }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw KeychainError.unableToDecodeData
        }
        return value
    }

    func writeSecret(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let existingStatus = SecItemCopyMatching(baseQuery as CFDictionary, nil)
        if existingStatus == errSecSuccess {
            let update: [String: Any] = [kSecValueData as String: data]
            let status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
            guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        } else {
            var addQuery = baseQuery
            addQuery[kSecValueData as String] = data
            let status = SecItemAdd(addQuery as CFDictionary, nil)
            guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        }
    }

    func deleteSecret(account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 4 new tests passed (14 total).

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/Networking/KeychainClient.swift WorkbenchTests/Networking/KeychainClientTests.swift
git commit -m "Add KeychainClient"
```

---

### Task 4: APIClient core — request building, auth, error mapping

The base HTTP plumbing every endpoint method (Tasks 5-8) builds on: constructs a `URLRequest` against `http://127.0.0.1:4173`, attaches `Authorization: Bearer <token>` from Keychain, and maps every status code the engine can return (200/201/204 success; 400/401/404/409/500 error, each with the exact `{"error": string}` body shape confirmed against the engine's real source) into a typed `APIError`. Tested with `URLProtocol` mocking — no real network call, no real server needed — reusing Task 3's `KeychainClient` pointed at the `workbench-tests` service so no real credentials are touched.

**Files:**
- Create: `app/Workbench/Networking/APIError.swift`
- Create: `app/Workbench/Networking/APIClient.swift`
- Test: `app/WorkbenchTests/Networking/MockURLProtocol.swift` (test helper, not itself tested)
- Test: `app/WorkbenchTests/Networking/APIClientCoreTests.swift`

**Interfaces:**
- Consumes: `KeychainClient` (Task 3).
- Produces: `APIError` (cases: `.unauthorized`, `.badRequest(String)`, `.notFound(String)`, `.conflict(String)`, `.serverError(String)`, `.decodingFailed(String)`, `.transportFailed(String)`, `.unexpectedStatus(Int, String)`); `APIClient(session: URLSession = .shared, keychain: KeychainClient = KeychainClient())` with `func send<Response: Decodable>(_ method: String, _ path: String, body: Encodable?) async throws -> Response` and `func sendNoContent(_ method: String, _ path: String, body: Encodable?) async throws`. Tasks 5-8 add endpoint-specific methods as `extension APIClient { ... }` blocks calling these two.

- [ ] **Step 1: Write the failing tests**

```swift
// app/WorkbenchTests/Networking/MockURLProtocol.swift
import Foundation

final class MockURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

func mockedSession(handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    MockURLProtocol.requestHandler = handler
    return URLSession(configuration: config)
}

func jsonResponse(_ url: URL, status: Int, body: String) -> (HTTPURLResponse, Data) {
    let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
    return (response, Data(body.utf8))
}
```

```swift
// app/WorkbenchTests/Networking/APIClientCoreTests.swift
import Testing
import Foundation
@testable import Workbench

private struct Echo: Decodable, Equatable {
    let value: Int
}

@Suite(.serialized)
struct APIClientCoreTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token-123", account: "api-token")
    }

    @Test func attachesBearerTokenFromKeychain() async throws {
        var capturedAuth: String?
        let session = mockedSession { request in
            capturedAuth = request.value(forHTTPHeaderField: "Authorization")
            return jsonResponse(request.url!, status: 200, body: #"{"value":1}"#)
        }
        let client = APIClient(session: session, keychain: testKeychain)
        let result: Echo = try await client.send("GET", "/today", body: nil)
        #expect(capturedAuth == "Bearer test-token-123")
        #expect(result == Echo(value: 1))
    }

    @Test func missingTokenThrowsTransportFailedWithoutMakingARequest() async throws {
        try testKeychain.deleteSecret(account: "api-token")
        let session = mockedSession { _ in
            Issue.record("should not have made a request with no token")
            return jsonResponse(URL(string: "http://127.0.0.1:4173/today")!, status: 200, body: "{}")
        }
        let client = APIClient(session: session, keychain: testKeychain)
        await #expect(throws: APIError.self) {
            let _: Echo = try await client.send("GET", "/today", body: nil)
        }
        try testKeychain.writeSecret("test-token-123", account: "api-token")
    }

    @Test func mapsEachStatusCodeToTheRightAPIError() async throws {
        let cases: [(Int, String, APIError)] = [
            (400, #"{"error":"repoPath is required"}"#, .badRequest("repoPath is required")),
            (401, #"{"error":"unauthorized"}"#, .unauthorized),
            (404, #"{"error":"not found"}"#, .notFound("not found")),
            (409, #"{"error":"already working on this"}"#, .conflict("already working on this")),
            (500, #"{"error":"Error: boom"}"#, .serverError("Error: boom")),
        ]
        for (status, body, expected) in cases {
            let session = mockedSession { request in jsonResponse(request.url!, status: status, body: body) }
            let client = APIClient(session: session, keychain: testKeychain)
            await #expect(throws: expected) {
                let _: Echo = try await client.send("GET", "/today", body: nil)
            }
        }
    }

    @Test func decodingFailureThrowsDecodingFailed() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"unexpectedShape":true}"#) }
        let client = APIClient(session: session, keychain: testKeychain)
        await #expect(throws: APIError.self) {
            let _: Echo = try await client.send("GET", "/today", body: nil)
        }
    }

    @Test func sendNoContentSucceedsOn204WithNoBody() async throws {
        let session = mockedSession { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }
        let client = APIClient(session: session, keychain: testKeychain)
        try await client.sendNoContent("DELETE", "/projects/1", body: nil)
    }

    @Test func encodesTheRequestBodyAsJSON() async throws {
        var capturedBody: Data?
        let session = mockedSession { request in
            capturedBody = request.httpBodyStreamOrData()
            return jsonResponse(request.url!, status: 201, body: #"{"value":1}"#)
        }
        let client = APIClient(session: session, keychain: testKeychain)
        let _: Echo = try await client.send("POST", "/todos", body: ["text": "renew SSL cert"])
        let decoded = try JSONSerialization.jsonObject(with: capturedBody ?? Data()) as? [String: String]
        #expect(decoded?["text"] == "renew SSL cert")
    }
}

private extension URLRequest {
    func httpBodyStreamOrData() -> Data? {
        httpBody
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'APIClient' in scope` / `Cannot find type 'APIError' in scope`.

- [ ] **Step 3: Write `app/Workbench/Networking/APIError.swift`**

```swift
import Foundation

enum APIError: Error, LocalizedError, Equatable {
    case unauthorized
    case badRequest(String)
    case notFound(String)
    case conflict(String)
    case serverError(String)
    case decodingFailed(String)
    case transportFailed(String)
    case unexpectedStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Not authorized. Check the Workbench engine is running."
        case .badRequest(let message), .notFound(let message), .conflict(let message), .serverError(let message):
            return message
        case .decodingFailed(let message):
            return "Could not understand the engine's response: \(message)"
        case .transportFailed(let message):
            return "Could not reach the Workbench engine: \(message)"
        case .unexpectedStatus(let code, let message):
            return "Unexpected response (\(code)): \(message)"
        }
    }
}

struct APIErrorBody: Decodable {
    let error: String
}
```

- [ ] **Step 4: Write `app/Workbench/Networking/APIClient.swift`**

```swift
import Foundation

final class APIClient {
    static let baseURL = URL(string: "http://127.0.0.1:4173")!

    private let session: URLSession
    private let keychain: KeychainClient

    init(session: URLSession = .shared, keychain: KeychainClient = KeychainClient()) {
        self.session = session
        self.keychain = keychain
    }

    private func makeRequest(_ method: String, _ path: String, body: Encodable?) throws -> URLRequest {
        guard let token = try keychain.readSecret(account: "api-token") else {
            throw APIError.transportFailed("No Workbench engine token found in Keychain. Is the engine running?")
        }
        var request = URLRequest(url: Self.baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        return request
    }

    private func errorMessage(from data: Data) -> String {
        (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
            ?? String(data: data, encoding: .utf8) ?? "unknown error"
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transportFailed("No HTTP response")
        }
        switch http.statusCode {
        case 200, 201, 204:
            return
        case 400:
            throw APIError.badRequest(errorMessage(from: data))
        case 401:
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound(errorMessage(from: data))
        case 409:
            throw APIError.conflict(errorMessage(from: data))
        case 500:
            throw APIError.serverError(errorMessage(from: data))
        default:
            throw APIError.unexpectedStatus(http.statusCode, errorMessage(from: data))
        }
    }

    private func fetch(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw APIError.transportFailed(error.localizedDescription)
        }
    }

    func send<Response: Decodable>(_ method: String, _ path: String, body: Encodable?) async throws -> Response {
        let request = try makeRequest(method, path, body: body)
        let (data, response) = try await fetch(request)
        try validate(response, data: data)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decodingFailed(String(describing: error))
        }
    }

    func sendNoContent(_ method: String, _ path: String, body: Encodable?) async throws {
        let request = try makeRequest(method, path, body: body)
        let (data, response) = try await fetch(request)
        try validate(response, data: data)
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 6 new tests passed (20 total).

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/Networking/APIError.swift Workbench/Networking/APIClient.swift WorkbenchTests/Networking/MockURLProtocol.swift WorkbenchTests/Networking/APIClientCoreTests.swift
git commit -m "Add APIClient core with auth and error mapping"
```

---

### Task 5: APIClient — Today and Projects endpoints

Note on PATCH semantics: Swift's compiler-synthesized `Encodable` conformance uses `encodeIfPresent` for `Optional` properties, which **omits** the JSON key entirely when the value is `nil` (it does not encode `null`). This is exactly what `ProjectUpdate` needs — a view model only sets the fields the user actually changed, and the rest are omitted from the PATCH body, matching the engine's partial-merge behavior confirmed in the exploration.

**Files:**
- Create: `app/Workbench/Networking/ProjectInput.swift`
- Modify: `app/Workbench/Networking/APIClient.swift` — add `extension APIClient` with Today/Projects methods
- Test: `app/WorkbenchTests/Networking/APIClientTodayProjectsTests.swift`

**Interfaces:**
- Consumes: `APIClient.send`/`sendNoContent` (Task 4); `TodayResponse`, `Project` (Task 2).
- Produces: `ProjectInput` (Encodable: `name`, `repoPath`, `defaultBranch`, `githubRepo?`, `jiraProjectKey?`, `sentryProjectSlug?`), `ProjectUpdate` (Encodable, all fields optional); `APIClient.today() async throws -> TodayResponse`, `.projects() async throws -> [Project]`, `.project(id: Int) async throws -> Project`, `.createProject(_ input: ProjectInput) async throws -> Project`, `.updateProject(id: Int, _ input: ProjectUpdate) async throws -> Project`, `.deleteProject(id: Int) async throws -> Void`. The `TodayViewModel` (Task 9) and `ProjectsViewModel` (Task 12) call these.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/Networking/APIClientTodayProjectsTests.swift
import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientTodayProjectsTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func todayHitsTheRightPathAndDecodesTheResponse() async throws {
        var capturedPath: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            return jsonResponse(request.url!, status: 200, body: #"{"needsInput":[],"todos":[]}"#)
        }
        let result = try await APIClient(session: session, keychain: testKeychain).today()
        #expect(capturedPath == "/today")
        #expect(result.needsInput.isEmpty)
    }

    @Test func createProjectPostsTheExactBodyAndDecodesTheCreatedProject() async throws {
        var capturedMethod: String?
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedMethod = request.httpMethod
            capturedBody = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 201, body: """
            {"id":1,"name":"demo","repoPath":"/repos/demo","defaultBranch":"main","githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null}
            """)
        }
        let input = ProjectInput(name: "demo", repoPath: "/repos/demo", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
        let project = try await APIClient(session: session, keychain: testKeychain).createProject(input)
        #expect(capturedMethod == "POST")
        #expect(capturedBody?["name"] as? String == "demo")
        #expect(capturedBody?["githubRepo"] == nil, "nil optional fields should be omitted, not sent as null")
        #expect(project.id == 1)
    }

    @Test func createProjectWithMissingFieldSurfacesTheEngineMessage() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 400, body: #"{"error":"repoPath is required"}"#)
        }
        let input = ProjectInput(name: "demo", repoPath: "", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
        await #expect(throws: APIError.badRequest("repoPath is required")) {
            _ = try await APIClient(session: session, keychain: testKeychain).createProject(input)
        }
    }

    @Test func updateProjectOnlySendsChangedFields() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":1,"name":"demo","repoPath":"/repos/demo","defaultBranch":"develop","githubRepo":null,"jiraProjectKey":null,"sentryProjectSlug":null}
            """)
        }
        let update = ProjectUpdate(defaultBranch: "develop")
        let project = try await APIClient(session: session, keychain: testKeychain).updateProject(id: 1, update)
        #expect(capturedBody?.count == 1)
        #expect(capturedBody?["defaultBranch"] as? String == "develop")
        #expect(project.defaultBranch == "develop")
    }

    @Test func deleteProjectWithDependentsSurfacesTheConflict() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 409, body: #"{"error":"project still has tickets or todos referencing it"}"#)
        }
        await #expect(throws: APIError.conflict("project still has tickets or todos referencing it")) {
            try await APIClient(session: session, keychain: testKeychain).deleteProject(id: 1)
        }
    }

    @Test func deleteProjectSucceedsOn204() async throws {
        let session = mockedSession { request in
            (HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!, Data())
        }
        try await APIClient(session: session, keychain: testKeychain).deleteProject(id: 1)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'ProjectInput' in scope` / `value of type 'APIClient' has no member 'today'`.

- [ ] **Step 3: Write `app/Workbench/Networking/ProjectInput.swift`**

```swift
struct ProjectInput: Encodable {
    var name: String
    var repoPath: String
    var defaultBranch: String
    var githubRepo: String?
    var jiraProjectKey: String?
    var sentryProjectSlug: String?
}

struct ProjectUpdate: Encodable {
    var name: String?
    var repoPath: String?
    var defaultBranch: String?
    var githubRepo: String?
    var jiraProjectKey: String?
    var sentryProjectSlug: String?
}
```

- [ ] **Step 4: Add the extension to `app/Workbench/Networking/APIClient.swift`**

```swift
extension APIClient {
    func today() async throws -> TodayResponse {
        try await send("GET", "/today", body: nil)
    }

    func projects() async throws -> [Project] {
        try await send("GET", "/projects", body: nil)
    }

    func project(id: Int) async throws -> Project {
        try await send("GET", "/projects/\(id)", body: nil)
    }

    func createProject(_ input: ProjectInput) async throws -> Project {
        try await send("POST", "/projects", body: input)
    }

    func updateProject(id: Int, _ input: ProjectUpdate) async throws -> Project {
        try await send("PATCH", "/projects/\(id)", body: input)
    }

    func deleteProject(id: Int) async throws {
        try await sendNoContent("DELETE", "/projects/\(id)", body: nil)
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 6 new tests passed (26 total).

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/Networking/ProjectInput.swift Workbench/Networking/APIClient.swift WorkbenchTests/Networking/APIClientTodayProjectsTests.swift
git commit -m "Add Today and Projects API methods"
```

---

### Task 6: APIClient — Todos endpoints

`createTodo`/`setTodoDone` use plain dictionary literals for their one-field request bodies (`Dictionary<String, String>`/`Dictionary<String, Bool>` both conform to `Encodable` natively) rather than single-purpose structs — there's nothing a dedicated type would add for a one-key body. `promoteTodo` is the one endpoint in this group with three distinct failure modes to distinguish (not found, not promotable, already running) — this is exactly the "Start fixing this" action from the product spec.

**Files:**
- Modify: `app/Workbench/Networking/APIClient.swift` — add `extension APIClient` with Todos methods
- Test: `app/WorkbenchTests/Networking/APIClientTodosTests.swift`

**Interfaces:**
- Consumes: `APIClient.send` (Task 4); `Todo`, `Ticket` (Task 2).
- Produces: `APIClient.todos() async throws -> [Todo]`, `.createTodo(text: String) async throws -> Todo`, `.setTodoDone(id: Int, done: Bool) async throws -> Todo`, `.promoteTodo(id: Int) async throws -> Ticket`. The `TodayViewModel` (Task 9) calls all four.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/Networking/APIClientTodosTests.swift
import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientTodosTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func createTodoPostsTheTextField() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 201, body: """
            {"id":1,"source":"manual","sourceId":null,"text":"renew SSL cert","body":"","url":null,
             "projectId":null,"canPromote":false,"done":false,"promotedTicketId":null,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: testKeychain).createTodo(text: "renew SSL cert")
        #expect(capturedBody?["text"] as? String == "renew SSL cert")
        #expect(todo.text == "renew SSL cert")
    }

    @Test func setTodoDonePatchesTheDoneField() async throws {
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedBody = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"manual","sourceId":null,"text":"x","body":"","url":null,
             "projectId":null,"canPromote":false,"done":true,"promotedTicketId":null,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let todo = try await APIClient(session: session, keychain: testKeychain).setTodoDone(id: 1, done: true)
        #expect(capturedBody?["done"] as? Bool == true)
        #expect(todo.done == true)
    }

    @Test func promoteTodoReturnsTheTicketOnSuccess() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"jira","sourceId":"JIRA-DEMO-1","projectId":1,"title":"Update env vars",
             "body":"b","url":"u","analysis":null,"status":"new","prId":null,"createdAt":"2026-08-12T00:00:00.000Z"}
            """)
        }
        let ticket = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 1)
        #expect(ticket.source == .jira)
    }

    @Test func promoteTodoNotFoundSurfacesNotFound() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 404, body: #"{"error":"Todo 999 not found"}"#) }
        await #expect(throws: APIError.notFound("Todo 999 not found")) {
            _ = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 999)
        }
    }

    @Test func promoteTodoNotPromotableSurfacesBadRequest() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 400, body: #"{"error":"Todo 1 cannot be promoted (not a Jira item)"}"#)
        }
        await #expect(throws: APIError.badRequest("Todo 1 cannot be promoted (not a Jira item)")) {
            _ = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 1)
        }
    }

    @Test func promoteTodoAlreadyRunningSurfacesConflict() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 409, body: #"{"error":"already working on this"}"#) }
        await #expect(throws: APIError.conflict("already working on this")) {
            _ = try await APIClient(session: session, keychain: testKeychain).promoteTodo(id: 1)
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `value of type 'APIClient' has no member 'createTodo'`.

- [ ] **Step 3: Add the extension to `app/Workbench/Networking/APIClient.swift`**

```swift
extension APIClient {
    func todos() async throws -> [Todo] {
        try await send("GET", "/todos", body: nil)
    }

    func createTodo(text: String) async throws -> Todo {
        try await send("POST", "/todos", body: ["text": text])
    }

    func setTodoDone(id: Int, done: Bool) async throws -> Todo {
        try await send("PATCH", "/todos/\(id)", body: ["done": done])
    }

    func promoteTodo(id: Int) async throws -> Ticket {
        try await send("POST", "/todos/\(id)/promote", body: nil)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 6 new tests passed (32 total).

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/Networking/APIClient.swift WorkbenchTests/Networking/APIClientTodosTests.swift
git commit -m "Add Todos API methods"
```

---

### Task 7: APIClient — Tickets endpoints

`POST /tickets/:id/messages` returns `{"reply": string}`, not the ticket or the message list — the caller re-fetches the ticket detail separately if it wants the updated transcript (the `TicketsViewModel` in Task 10 does this). `POST /tickets/:id/create-pr`'s two distinct 409 cases ("ticket already has a PR" vs. the job-lock's "already working on this") both surface as `APIError.conflict(message)` — the message text itself carries the distinction, so there's no need for a separate error case per 409 reason.

**Files:**
- Create: `app/Workbench/Networking/ChatReply.swift`
- Modify: `app/Workbench/Networking/APIClient.swift` — add `extension APIClient` with Tickets methods
- Test: `app/WorkbenchTests/Networking/APIClientTicketsTests.swift`

**Interfaces:**
- Consumes: `APIClient.send` (Task 4); `Ticket` (Task 2).
- Produces: `ChatReply` (Decodable: `reply: String`), `FixResult` (Decodable: `ticketStatus: TicketStatus`, `prId: Int`); `APIClient.tickets() async throws -> [Ticket]`, `.ticket(id: Int) async throws -> Ticket`, `.sendTicketMessage(id: Int, text: String) async throws -> ChatReply`, `.createPr(ticketId: Int) async throws -> FixResult`. The `TicketsViewModel` (Task 10) calls all four.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/Networking/APIClientTicketsTests.swift
import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientTicketsTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func ticketDetailDecodesMessages() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: """
            {"id":1,"source":"github","sourceId":"GH-1","projectId":1,"title":"t","body":"b","url":"u",
             "analysis":null,"status":"sparring","prId":null,"createdAt":"2026-08-12T00:00:00.000Z",
             "messages":[{"id":1,"ticketId":1,"role":"user","content":"go ahead","createdAt":"2026-08-12T00:00:00.000Z"}]}
            """)
        }
        let ticket = try await APIClient(session: session, keychain: testKeychain).ticket(id: 1)
        #expect(ticket.messages?.count == 1)
    }

    @Test func sendTicketMessagePostsTextAndReturnsReply() async throws {
        var capturedPath: String?
        var capturedBody: [String: Any]?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            capturedBody = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            return jsonResponse(request.url!, status: 200, body: #"{"reply":"Sounds good."}"#)
        }
        let reply = try await APIClient(session: session, keychain: testKeychain).sendTicketMessage(id: 1, text: "go ahead")
        #expect(capturedPath == "/tickets/1/messages")
        #expect(capturedBody?["text"] as? String == "go ahead")
        #expect(reply.reply == "Sounds good.")
    }

    @Test func createPrReturnsTicketStatusAndPrId() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: #"{"ticketStatus":"in_review","prId":5}"#)
        }
        let result = try await APIClient(session: session, keychain: testKeychain).createPr(ticketId: 1)
        #expect(result.ticketStatus == .inReview)
        #expect(result.prId == 5)
    }

    @Test func createPrWhenTicketAlreadyHasAPrSurfacesConflict() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 409, body: #"{"error":"ticket already has a PR"}"#) }
        await #expect(throws: APIError.conflict("ticket already has a PR")) {
            _ = try await APIClient(session: session, keychain: testKeychain).createPr(ticketId: 1)
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'ChatReply' in scope`.

- [ ] **Step 3: Write `app/Workbench/Networking/ChatReply.swift`**

```swift
struct ChatReply: Decodable {
    let reply: String
}

struct FixResult: Decodable {
    let ticketStatus: TicketStatus
    let prId: Int
}
```

- [ ] **Step 4: Add the extension to `app/Workbench/Networking/APIClient.swift`**

```swift
extension APIClient {
    func tickets() async throws -> [Ticket] {
        try await send("GET", "/tickets", body: nil)
    }

    func ticket(id: Int) async throws -> Ticket {
        try await send("GET", "/tickets/\(id)", body: nil)
    }

    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply {
        try await send("POST", "/tickets/\(id)/messages", body: ["text": text])
    }

    func createPr(ticketId: Int) async throws -> FixResult {
        try await send("POST", "/tickets/\(ticketId)/create-pr", body: nil)
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 4 new tests passed (36 total).

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/Networking/ChatReply.swift Workbench/Networking/APIClient.swift WorkbenchTests/Networking/APIClientTicketsTests.swift
git commit -m "Add Tickets API methods"
```

---

### Task 8: APIClient — Pull Requests endpoints

The last APIClient task. `GET /prs/:id/diff` on an already-merged PR returns a distinct 409 (`"PR already merged, diff no longer available"`) checked before the engine even touches git — worth its own test since the `PRsViewModel` (Task 11) will want to show a specific "already merged" state rather than a generic error. `POST /prs/:id/merge` and a chat message that says "merge it" both return the identical `PrChatResult` shape from the same underlying engine function — this app has no separate "merge" model, just one action button and one chat endpoint sharing one result type.

**Files:**
- Create: `app/Workbench/Networking/PrChatResult.swift`
- Modify: `app/Workbench/Networking/APIClient.swift` — add `extension APIClient` with PRs methods
- Test: `app/WorkbenchTests/Networking/APIClientPRsTests.swift`

**Interfaces:**
- Consumes: `APIClient.send` (Task 4); `PullRequest` (Task 2).
- Produces: `PrChatAction` (Decodable enum: `revised`, `merged`), `PrChatResult` (Decodable: `action: PrChatAction`, `reply: String`), `DiffResponse` (Decodable: `diff: String`); `APIClient.pullRequests() async throws -> [PullRequest]`, `.pullRequest(id: Int) async throws -> PullRequest`, `.diff(prId: Int) async throws -> DiffResponse`, `.sendPrMessage(id: Int, text: String) async throws -> PrChatResult`, `.mergePr(id: Int) async throws -> PrChatResult`. The `PRsViewModel` (Task 11) calls all five.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/Networking/APIClientPRsTests.swift
import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct APIClientPRsTests {
    let testKeychain = KeychainClient(service: "workbench-tests")

    init() throws {
        try testKeychain.writeSecret("test-token", account: "api-token")
    }

    @Test func pullRequestDetailDecodesMessages() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 200, body: """
            {"id":142,"ticketId":1,"projectId":1,"branch":"fix/gh-1","number":142,"url":"https://x/pull/142",
             "status":"open","lastReviewScore":4.6,"createdAt":"2026-08-12T00:00:00.000Z",
             "messages":[{"id":1,"prId":142,"role":"assistant","content":"Fix ready.","createdAt":"2026-08-12T00:00:00.000Z"}]}
            """)
        }
        let pr = try await APIClient(session: session, keychain: testKeychain).pullRequest(id: 142)
        #expect(pr.messages?.count == 1)
    }

    @Test func diffReturnsTheDiffText() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"diff":"--- a/x.ts\n+++ b/x.ts"}"#) }
        let result = try await APIClient(session: session, keychain: testKeychain).diff(prId: 1)
        #expect(result.diff.contains("--- a/x.ts"))
    }

    @Test func diffOnAMergedPrSurfacesTheSpecificConflict() async throws {
        let session = mockedSession { request in
            jsonResponse(request.url!, status: 409, body: #"{"error":"PR already merged, diff no longer available"}"#)
        }
        await #expect(throws: APIError.conflict("PR already merged, diff no longer available")) {
            _ = try await APIClient(session: session, keychain: testKeychain).diff(prId: 1)
        }
    }

    @Test func sendPrMessageDecodesARevisedAction() async throws {
        let session = mockedSession { request in jsonResponse(request.url!, status: 200, body: #"{"action":"revised","reply":"Updated, pushed to the branch."}"#) }
        let result = try await APIClient(session: session, keychain: testKeychain).sendPrMessage(id: 1, text: "also guard the email field")
        #expect(result.action == .revised)
    }

    @Test func mergePrDecodesAMergedAction() async throws {
        var capturedPath: String?
        let session = mockedSession { request in
            capturedPath = request.url?.path
            return jsonResponse(request.url!, status: 200, body: #"{"action":"merged","reply":"Merged https://x/pull/142."}"#)
        }
        let result = try await APIClient(session: session, keychain: testKeychain).mergePr(id: 1)
        #expect(capturedPath == "/prs/1/merge")
        #expect(result.action == .merged)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'DiffResponse' in scope`.

- [ ] **Step 3: Write `app/Workbench/Networking/PrChatResult.swift`**

```swift
enum PrChatAction: String, Decodable {
    case revised, merged
}

struct PrChatResult: Decodable {
    let action: PrChatAction
    let reply: String
}

struct DiffResponse: Decodable {
    let diff: String
}
```

- [ ] **Step 4: Add the extension to `app/Workbench/Networking/APIClient.swift`**

```swift
extension APIClient {
    func pullRequests() async throws -> [PullRequest] {
        try await send("GET", "/prs", body: nil)
    }

    func pullRequest(id: Int) async throws -> PullRequest {
        try await send("GET", "/prs/\(id)", body: nil)
    }

    func diff(prId: Int) async throws -> DiffResponse {
        try await send("GET", "/prs/\(prId)/diff", body: nil)
    }

    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult {
        try await send("POST", "/prs/\(id)/messages", body: ["text": text])
    }

    func mergePr(id: Int) async throws -> PrChatResult {
        try await send("POST", "/prs/\(id)/merge", body: nil)
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 5 new tests passed (41 total).

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/Networking/PrChatResult.swift Workbench/Networking/APIClient.swift WorkbenchTests/Networking/APIClientPRsTests.swift
git commit -m "Add Pull Requests API methods"
```

---

### Task 9: TodayViewModel

Every remaining view model follows this same shape: a small local protocol naming only the API methods that view model needs, `APIClient` conforms to it via a one-line `extension`, and tests use a hand-written mock (no mocking library, no HTTP layer involved at all — this is testing state transitions, not networking, which Tasks 4-8 already covered). The class is `@MainActor` since it drives SwiftUI state directly.

**Files:**
- Create: `app/Workbench/ViewModels/TodayViewModel.swift`
- Test: `app/WorkbenchTests/ViewModels/TodayViewModelTests.swift`

**Interfaces:**
- Consumes: `APIClient` (Tasks 4-6, conforming to the new `TodayAPI` protocol via extension), `TodayResponse`, `TodayItem`, `Todo`, `Ticket` (Task 2).
- Produces: `protocol TodayAPI`, `TodayViewModel` with `@MainActor` state (`needsInput: [TodayItem]`, `todos: [Todo]`, `isLoading: Bool`, `errorMessage: String?`) and methods `load() async`, `addTodo(text: String) async`, `toggleDone(_ todo: Todo) async`, `promote(_ todo: Todo) async`. `TodayScreen` (Task 15) binds to this.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/ViewModels/TodayViewModelTests.swift
import Testing
@testable import Workbench

@MainActor
final class MockTodayAPI: TodayAPI {
    var todayResult: Result<TodayResponse, Error> = .success(TodayResponse(needsInput: [], todos: []))
    var createTodoResult: Result<Todo, Error>?
    var setTodoDoneResult: Result<Todo, Error>?
    var promoteTodoResult: Result<Ticket, Error>?
    private(set) var createTodoCalls: [String] = []
    private(set) var setTodoDoneCalls: [(id: Int, done: Bool)] = []
    private(set) var promoteTodoCalls: [Int] = []

    func today() async throws -> TodayResponse { try todayResult.get() }
    func createTodo(text: String) async throws -> Todo {
        createTodoCalls.append(text)
        return try createTodoResult!.get()
    }
    func setTodoDone(id: Int, done: Bool) async throws -> Todo {
        setTodoDoneCalls.append((id, done))
        return try setTodoDoneResult!.get()
    }
    func promoteTodo(id: Int) async throws -> Ticket {
        promoteTodoCalls.append(id)
        return try promoteTodoResult!.get()
    }
}

private func sampleTodo(id: Int = 1, done: Bool = false) -> Todo {
    Todo(id: id, source: .manual, sourceId: nil, text: "x", body: "", url: nil,
         projectId: nil, canPromote: false, done: done, promotedTicketId: nil, createdAt: "2026-08-12T00:00:00.000Z")
}

private func sampleTicket() -> Ticket {
    Ticket(id: 1, source: .jira, sourceId: "JIRA-1", projectId: 1, title: "t", body: "b", url: "u",
           analysis: nil, status: .new, prId: nil, createdAt: "2026-08-12T00:00:00.000Z")
}

@MainActor
@Suite
struct TodayViewModelTests {
    @Test func loadPopulatesStateOnSuccess() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo()]))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.todos.count == 1)
        #expect(viewModel.errorMessage == nil)
        #expect(viewModel.isLoading == false)
    }

    @Test func loadSetsErrorMessageOnFailure() async {
        let api = MockTodayAPI()
        api.todayResult = .failure(APIError.transportFailed("no engine"))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.errorMessage != nil)
    }

    @Test func addTodoAppendsTheCreatedTodo() async {
        let api = MockTodayAPI()
        api.createTodoResult = .success(sampleTodo(id: 2))
        let viewModel = TodayViewModel(api: api)
        await viewModel.addTodo(text: "call client")
        #expect(api.createTodoCalls == ["call client"])
        #expect(viewModel.todos.map(\.id) == [2])
    }

    @Test func toggleDoneRemovesTheTodoFromTheLocalList() async {
        let api = MockTodayAPI()
        api.todayResult = .success(TodayResponse(needsInput: [], todos: [sampleTodo(id: 1)]))
        api.setTodoDoneResult = .success(sampleTodo(id: 1, done: true))
        let viewModel = TodayViewModel(api: api)
        await viewModel.load()
        await viewModel.toggleDone(sampleTodo(id: 1))
        #expect(api.setTodoDoneCalls.first?.id == 1)
        #expect(api.setTodoDoneCalls.first?.done == true)
        #expect(viewModel.todos.isEmpty, "GET /todos only ever returns open todos, so a completed one should disappear from the local list too")
    }

    @Test func promoteReloadsAfterSucceeding() async {
        let api = MockTodayAPI()
        api.promoteTodoResult = .success(sampleTicket())
        api.todayResult = .success(TodayResponse(needsInput: [TodayItem(kind: .ticket, id: 1, title: "t", status: "new", reviewScore: nil)], todos: []))
        let viewModel = TodayViewModel(api: api)
        await viewModel.promote(sampleTodo(id: 1))
        #expect(api.promoteTodoCalls == [1])
        #expect(viewModel.needsInput.count == 1, "promote should reload Today so the newly-created ticket shows up")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'TodayAPI' in scope` / `Cannot find 'TodayViewModel' in scope`.

- [ ] **Step 3: Write `app/Workbench/ViewModels/TodayViewModel.swift`**

```swift
import Observation

protocol TodayAPI {
    func today() async throws -> TodayResponse
    func createTodo(text: String) async throws -> Todo
    func setTodoDone(id: Int, done: Bool) async throws -> Todo
    func promoteTodo(id: Int) async throws -> Ticket
}

extension APIClient: TodayAPI {}

@Observable
@MainActor
final class TodayViewModel {
    private(set) var needsInput: [TodayItem] = []
    private(set) var todos: [Todo] = []
    private(set) var isLoading = false
    var errorMessage: String?

    private let api: any TodayAPI

    init(api: any TodayAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.today()
            needsInput = response.needsInput
            todos = response.todos
            errorMessage = nil
        } catch {
            present(error)
        }
    }

    func addTodo(text: String) async {
        do {
            let todo = try await api.createTodo(text: text)
            todos.append(todo)
        } catch {
            present(error)
        }
    }

    func toggleDone(_ todo: Todo) async {
        do {
            _ = try await api.setTodoDone(id: todo.id, done: !todo.done)
            todos.removeAll { $0.id == todo.id }
        } catch {
            present(error)
        }
    }

    func promote(_ todo: Todo) async {
        do {
            _ = try await api.promoteTodo(id: todo.id)
            await load()
        } catch {
            present(error)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 5 new tests passed (46 total).

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/ViewModels/TodayViewModel.swift WorkbenchTests/ViewModels/TodayViewModelTests.swift
git commit -m "Add TodayViewModel"
```

---

### Task 10: TicketsViewModel

`POST /tickets/:id/messages` returns only `{"reply": string}` (confirmed in Task 7), not the updated ticket — so after sending a message, this view model re-fetches the ticket detail via `GET /tickets/:id` to pick up both the user's message and the assistant's reply in the transcript. Same pattern after `createPr` succeeds: re-fetch the ticket (status changed) and reload the ticket list (so a ticket that's now `in_review` drops out of wherever the list visually distinguishes "ready to spar" tickets).

**Files:**
- Create: `app/Workbench/ViewModels/TicketsViewModel.swift`
- Test: `app/WorkbenchTests/ViewModels/TicketsViewModelTests.swift`

**Interfaces:**
- Consumes: `APIClient` (Task 7, conforming to the new `TicketsAPI` protocol via extension), `Ticket`, `ChatReply`, `FixResult` (Tasks 2, 7).
- Produces: `protocol TicketsAPI`, `TicketsViewModel` with `@MainActor` state (`tickets: [Ticket]`, `selectedTicket: Ticket?`, `isSending: Bool`, `errorMessage: String?`) and methods `load() async`, `select(_ ticket: Ticket) async`, `sendMessage(_ text: String) async`, `createPr() async`. `TicketsScreen` (Task 16) binds to this.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/ViewModels/TicketsViewModelTests.swift
import Testing
@testable import Workbench

private func sampleTicket(id: Int = 1, messageCount: Int = 0, status: TicketStatus = .new) -> Ticket {
    Ticket(id: id, source: .github, sourceId: "GH-\(id)", projectId: 1, title: "Fix null check", body: "b", url: "u",
           analysis: nil, status: status, prId: nil, createdAt: "2026-08-12T00:00:00.000Z",
           messages: (0..<messageCount).map { i in
               TicketMessage(id: i, ticketId: id, role: i % 2 == 0 ? .user : .assistant, content: "msg \(i)", createdAt: "2026-08-12T00:00:00.000Z")
           })
}

@MainActor
final class MockTicketsAPI: TicketsAPI {
    var ticketsResult: Result<[Ticket], Error> = .success([])
    var ticketHandler: (Int) throws -> Ticket = { sampleTicket(id: $0) }
    var sendMessageResult: Result<ChatReply, Error> = .success(ChatReply(reply: "ok"))
    var createPrResult: Result<FixResult, Error> = .success(FixResult(ticketStatus: .inReview, prId: 1))
    private(set) var ticketCalls: [Int] = []
    private(set) var sendMessageCalls: [(id: Int, text: String)] = []
    private(set) var createPrCalls: [Int] = []

    func tickets() async throws -> [Ticket] { try ticketsResult.get() }
    func ticket(id: Int) async throws -> Ticket {
        ticketCalls.append(id)
        return try ticketHandler(id)
    }
    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply {
        sendMessageCalls.append((id, text))
        return try sendMessageResult.get()
    }
    func createPr(ticketId: Int) async throws -> FixResult {
        createPrCalls.append(ticketId)
        return try createPrResult.get()
    }
}

@MainActor
@Suite
struct TicketsViewModelTests {
    @Test func loadPopulatesTicketList() async {
        let api = MockTicketsAPI()
        api.ticketsResult = .success([sampleTicket()])
        let viewModel = TicketsViewModel(api: api)
        await viewModel.load()
        #expect(viewModel.tickets.count == 1)
    }

    @Test func selectFetchesTheFullDetail() async {
        let api = MockTicketsAPI()
        api.ticketHandler = { id in sampleTicket(id: id, messageCount: 2) }
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        #expect(viewModel.selectedTicket?.messages?.count == 2)
    }

    @Test func sendMessageRefetchesTheTicketToPickUpTheReply() async {
        let api = MockTicketsAPI()
        // ticketCalls already includes the in-flight call by the time ticketHandler runs
        // (the mock appends before invoking the handler), so call 1 = select (0 messages),
        // call 2 = the refetch inside sendMessage (2 messages: the new user message + reply).
        api.ticketHandler = { id in sampleTicket(id: id, messageCount: api.ticketCalls.count <= 1 ? 0 : 2) }
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        await viewModel.sendMessage("go ahead")
        #expect(api.sendMessageCalls.first?.text == "go ahead")
        #expect(viewModel.selectedTicket?.messages?.count == 2, "should refetch after sending, since the reply only comes back from a second GET")
    }

    @Test func createPrRefetchesTicketAndReloadsList() async {
        let api = MockTicketsAPI()
        api.ticketsResult = .success([sampleTicket(id: 1, status: .new)])
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        await viewModel.createPr()
        #expect(api.createPrCalls == [1])
        #expect(api.ticketCalls.count == 2, "one select fetch, one refetch after create-pr")
    }

    @Test func createPrConflictSurfacesTheEngineMessage() async {
        let api = MockTicketsAPI()
        api.createPrResult = .failure(APIError.conflict("ticket already has a PR"))
        let viewModel = TicketsViewModel(api: api)
        await viewModel.select(sampleTicket(id: 1))
        await viewModel.createPr()
        #expect(viewModel.errorMessage == "ticket already has a PR")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'TicketsAPI' in scope`.

- [ ] **Step 3: Write `app/Workbench/ViewModels/TicketsViewModel.swift`**

```swift
import Observation

protocol TicketsAPI {
    func tickets() async throws -> [Ticket]
    func ticket(id: Int) async throws -> Ticket
    func sendTicketMessage(id: Int, text: String) async throws -> ChatReply
    func createPr(ticketId: Int) async throws -> FixResult
}

extension APIClient: TicketsAPI {}

@Observable
@MainActor
final class TicketsViewModel {
    private(set) var tickets: [Ticket] = []
    var selectedTicket: Ticket?
    private(set) var isSending = false
    var errorMessage: String?

    private let api: any TicketsAPI

    init(api: any TicketsAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        do {
            tickets = try await api.tickets()
        } catch {
            present(error)
        }
    }

    func select(_ ticket: Ticket) async {
        do {
            selectedTicket = try await api.ticket(id: ticket.id)
        } catch {
            present(error)
        }
    }

    func sendMessage(_ text: String) async {
        guard let ticketId = selectedTicket?.id else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.sendTicketMessage(id: ticketId, text: text)
            selectedTicket = try await api.ticket(id: ticketId)
        } catch {
            present(error)
        }
    }

    func createPr() async {
        guard let ticketId = selectedTicket?.id else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.createPr(ticketId: ticketId)
            selectedTicket = try await api.ticket(id: ticketId)
            await load()
        } catch {
            present(error)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 5 new tests passed (51 total).

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/ViewModels/TicketsViewModel.swift WorkbenchTests/ViewModels/TicketsViewModelTests.swift
git commit -m "Add TicketsViewModel"
```

---

### Task 11: PRsViewModel

Skips fetching the diff entirely for an already-merged PR (checked from the freshly-fetched detail's `status`, not by attempting the call and catching the 409) — no point spending a request on something the engine will always refuse. After a chat message revises the PR, the diff refresh uses `try?` rather than propagating a failure: the revision itself already succeeded by that point, so a diff-refresh hiccup shouldn't be reported as if the whole action failed.

**Files:**
- Create: `app/Workbench/ViewModels/PRsViewModel.swift`
- Test: `app/WorkbenchTests/ViewModels/PRsViewModelTests.swift`

**Interfaces:**
- Consumes: `APIClient` (Task 8, conforming to the new `PRsAPI` protocol via extension), `PullRequest`, `PrChatResult`, `DiffResponse` (Tasks 2, 8).
- Produces: `protocol PRsAPI`, `PRsViewModel` with `@MainActor` state (`pullRequests: [PullRequest]`, `selectedPr: PullRequest?`, `diffText: String?`, `isBusy: Bool`, `errorMessage: String?`) and methods `load() async`, `select(_ pr: PullRequest) async`, `sendMessage(_ text: String) async`, `merge() async`. `PRsScreen` (Task 17) binds to this.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/ViewModels/PRsViewModelTests.swift
import Testing
@testable import Workbench

private func samplePr(id: Int = 1, status: PrStatus = .open) -> PullRequest {
    PullRequest(id: id, ticketId: 1, projectId: 1, branch: "fix/gh-1", number: id,
                url: "https://x/pull/\(id)", status: status, lastReviewScore: 4.6,
                createdAt: "2026-08-12T00:00:00.000Z")
}

@MainActor
final class MockPRsAPI: PRsAPI {
    var pullRequestsResult: Result<[PullRequest], Error> = .success([])
    var pullRequestHandler: (Int) throws -> PullRequest = { samplePr(id: $0) }
    var diffResult: Result<DiffResponse, Error> = .success(DiffResponse(diff: "--- a\n+++ b"))
    var sendMessageResult: Result<PrChatResult, Error> = .success(PrChatResult(action: .revised, reply: "done"))
    var mergeResult: Result<PrChatResult, Error> = .success(PrChatResult(action: .merged, reply: "Merged."))
    private(set) var diffCalls: [Int] = []
    private(set) var mergeCalls: [Int] = []

    func pullRequests() async throws -> [PullRequest] { try pullRequestsResult.get() }
    func pullRequest(id: Int) async throws -> PullRequest { try pullRequestHandler(id) }
    func diff(prId: Int) async throws -> DiffResponse {
        diffCalls.append(prId)
        return try diffResult.get()
    }
    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult { try sendMessageResult.get() }
    func mergePr(id: Int) async throws -> PrChatResult {
        mergeCalls.append(id)
        return try mergeResult.get()
    }
}

@MainActor
@Suite
struct PRsViewModelTests {
    @Test func selectFetchesDetailAndDiff() async {
        let api = MockPRsAPI()
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        #expect(viewModel.selectedPr?.id == 1)
        #expect(viewModel.diffText == "--- a\n+++ b")
        #expect(api.diffCalls == [1])
    }

    @Test func selectOnAnAlreadyMergedPrSkipsTheDiffCall() async {
        let api = MockPRsAPI()
        api.pullRequestHandler = { id in samplePr(id: id, status: .merged) }
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        #expect(viewModel.diffText == nil)
        #expect(api.diffCalls.isEmpty, "should never call diff for a PR already known to be merged")
    }

    @Test func sendMessageRefreshesDetailAndDiff() async {
        let api = MockPRsAPI()
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        await viewModel.sendMessage("also guard the email field")
        #expect(viewModel.diffText != nil)
    }

    @Test func mergeCallsMergeAndReloadsListWithoutFetchingDiff() async {
        let api = MockPRsAPI()
        api.pullRequestHandler = { id in samplePr(id: id, status: .open) }
        api.pullRequestsResult = .success([samplePr(id: 1, status: .merged)])
        let viewModel = PRsViewModel(api: api)
        await viewModel.select(samplePr(id: 1))
        let diffCallsBeforeMerge = api.diffCalls.count
        await viewModel.merge()
        #expect(api.mergeCalls == [1])
        #expect(api.diffCalls.count == diffCallsBeforeMerge, "merging should never attempt a diff fetch")
        #expect(viewModel.pullRequests.first?.status == .merged)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'PRsAPI' in scope`.

- [ ] **Step 3: Write `app/Workbench/ViewModels/PRsViewModel.swift`**

```swift
import Observation

protocol PRsAPI {
    func pullRequests() async throws -> [PullRequest]
    func pullRequest(id: Int) async throws -> PullRequest
    func diff(prId: Int) async throws -> DiffResponse
    func sendPrMessage(id: Int, text: String) async throws -> PrChatResult
    func mergePr(id: Int) async throws -> PrChatResult
}

extension APIClient: PRsAPI {}

@Observable
@MainActor
final class PRsViewModel {
    private(set) var pullRequests: [PullRequest] = []
    var selectedPr: PullRequest?
    private(set) var diffText: String?
    private(set) var isBusy = false
    var errorMessage: String?

    private let api: any PRsAPI

    init(api: any PRsAPI = APIClient()) {
        self.api = api
    }

    private func present(_ error: Error) {
        errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    func load() async {
        do {
            pullRequests = try await api.pullRequests()
        } catch {
            present(error)
        }
    }

    func select(_ pr: PullRequest) async {
        diffText = nil
        do {
            let detail = try await api.pullRequest(id: pr.id)
            selectedPr = detail
            if detail.status != .merged {
                diffText = try await api.diff(prId: pr.id).diff
            }
        } catch {
            present(error)
        }
    }

    func sendMessage(_ text: String) async {
        guard let prId = selectedPr?.id else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.sendPrMessage(id: prId, text: text)
            selectedPr = try await api.pullRequest(id: prId)
            diffText = try? await api.diff(prId: prId).diff
        } catch {
            present(error)
        }
    }

    func merge() async {
        guard let prId = selectedPr?.id else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.mergePr(id: prId)
            selectedPr = try await api.pullRequest(id: prId)
            await load()
        } catch {
            present(error)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 4 new tests passed (55 total).

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/ViewModels/PRsViewModel.swift WorkbenchTests/ViewModels/PRsViewModelTests.swift
git commit -m "Add PRsViewModel"
```

---

### Task 12: ProjectsViewModel

The last view model. Plain CRUD against the Projects settings screen (Task 18). A failed `delete` (409, dependents still exist) must leave the project in the local list — the view model only removes it locally after the server confirms deletion.

**Files:**
- Create: `app/Workbench/ViewModels/ProjectsViewModel.swift`
- Test: `app/WorkbenchTests/ViewModels/ProjectsViewModelTests.swift`

**Interfaces:**
- Consumes: `APIClient` (Task 5, conforming to the new `ProjectsAPI` protocol via extension), `Project`, `ProjectInput`, `ProjectUpdate` (Tasks 2, 5).
- Produces: `protocol ProjectsAPI`, `ProjectsViewModel` with `@MainActor` state (`projects: [Project]`, `selectedProject: Project?`, `errorMessage: String?`) and methods `load() async`, `create(_ input: ProjectInput) async`, `update(_ project: Project, _ changes: ProjectUpdate) async`, `delete(_ project: Project) async`. `ProjectsScreen` (Task 18) binds to this.

- [ ] **Step 1: Write the failing test**

```swift
// app/WorkbenchTests/ViewModels/ProjectsViewModelTests.swift
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: FAIL — `Cannot find type 'ProjectsAPI' in scope`.

- [ ] **Step 3: Write `app/Workbench/ViewModels/ProjectsViewModel.swift`**

```swift
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, 5 new tests passed (60 total).

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/ViewModels/ProjectsViewModel.swift WorkbenchTests/ViewModels/ProjectsViewModelTests.swift
git commit -m "Add ProjectsViewModel"
```

---

### Task 13: App shell — entry point, menu bar icon, badge

This is the first task with no automated test — a status-bar icon and window-activation behavior can't be meaningfully asserted by Swift Testing, matching how the engine plan handled its own untestable bootstrap code (`index.ts`) with manual verification instead. SwiftUI's own `MenuBarExtra` isn't used here because it always shows a menu or a window when clicked; the spec requires "click the icon, bring the window forward, no dropdown," so this uses a plain AppKit `NSStatusItem` with a direct click handler, bridged into the SwiftUI app via `@NSApplicationDelegateAdaptor` (both patterns were compiled and verified working before this plan was written).

The badge is a composited image (base icon + a red circle with a count), not a plain `NSImage.isTemplate` icon — a template image would get monochrome-tinted by the system, including the badge circle, losing the red color. `AppDelegate` is marked `@Observable` and injected into the SwiftUI environment so `ContentView` (Task 14) can call `updateBadge(count:)` whenever the Today view model's `needsInput` count changes, without any other coupling between AppKit and SwiftUI code.

**Files:**
- Modify: `app/Workbench/WorkbenchApp.swift`
- Create: `app/Workbench/AppDelegate.swift`
- Create: `app/Workbench/MenuBarIconRenderer.swift`
- Create: `app/Workbench/Views/ContentView.swift` (placeholder — Task 14 builds it out)

**Interfaces:**
- Produces: `AppDelegate` (`@Observable`, `NSApplicationDelegate`) with `func updateBadge(count: Int)`; `MenuBarIconRenderer.image(badgeCount: Int) -> NSImage`. Task 14's `ContentView` reads `@Environment(AppDelegate.self)` and calls `updateBadge`.

- [ ] **Step 1: Write `app/Workbench/MenuBarIconRenderer.swift`**

```swift
import AppKit

enum MenuBarIconRenderer {
    static func image(badgeCount: Int) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size)
        image.lockFocus()

        if let symbol = NSImage(systemSymbolName: "checkmark.circle", accessibilityDescription: "Workbench") {
            symbol.draw(in: NSRect(origin: .zero, size: size))
        }

        if badgeCount > 0 {
            let diameter: CGFloat = 10
            let badgeRect = NSRect(x: size.width - diameter, y: size.height - diameter, width: diameter, height: diameter)
            NSColor.systemRed.setFill()
            NSBezierPath(ovalIn: badgeRect).fill()

            let text = badgeCount > 9 ? "9+" : "\(badgeCount)"
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 7, weight: .bold),
                .foregroundColor: NSColor.white,
            ]
            let textSize = text.size(withAttributes: attributes)
            let origin = NSPoint(x: badgeRect.midX - textSize.width / 2, y: badgeRect.midY - textSize.height / 2)
            text.draw(at: origin, withAttributes: attributes)
        }

        image.unlockFocus()
        // A template image is auto-tinted monochrome by the system, which would erase the red badge.
        // Only the badge-free idle icon can safely be a template (so it adapts to light/dark menu bars).
        image.isTemplate = badgeCount == 0
        return image
    }
}
```

- [ ] **Step 2: Write `app/Workbench/AppDelegate.swift`**

```swift
import AppKit
import Observation

@Observable
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = MenuBarIconRenderer.image(badgeCount: 0)
        item.button?.action = #selector(statusItemClicked)
        item.button?.target = self
        statusItem = item
    }

    func updateBadge(count: Int) {
        statusItem?.button?.image = MenuBarIconRenderer.image(badgeCount: count)
    }

    @objc private func statusItemClicked() {
        NSApp.activate(ignoringOtherApps: true)
        for window in NSApp.windows {
            window.makeKeyAndOrderFront(nil)
        }
    }
}
```

- [ ] **Step 3: Write `app/Workbench/Views/ContentView.swift`** (placeholder for Task 14 to replace)

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        Text("Workbench")
            .frame(minWidth: 800, minHeight: 500)
    }
}
```

- [ ] **Step 4: Update `app/Workbench/WorkbenchApp.swift`**

```swift
import SwiftUI

@main
struct WorkbenchApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appDelegate)
        }
    }
}
```

- [ ] **Step 5: Regenerate, build, and confirm the test suite is still green**

Run: `cd app && xcodegen generate && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, still 60 tests passing (this task adds no new tests, but must not break existing ones).

- [ ] **Step 6: Manually verify the app actually launches with a menu bar icon**

```bash
cd app
xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS' -derivedDataPath ./.build 2>&1 | tail -5
open ./.build/Build/Products/Debug/Workbench.app
sleep 2
screencapture -x /tmp/workbench-launch-check.png
```

Then use your Read tool on `/tmp/workbench-launch-check.png` and confirm: a menu bar icon (a small checkmark-circle glyph) is visible near the right side of the menu bar, and a window titled "Workbench" (showing the placeholder text) is open. If the icon or window isn't visible, investigate before proceeding — don't guess.

Quit the app when done: `osascript -e 'tell application "Workbench" to quit'` (or `pkill -x Workbench` if that fails).

- [ ] **Step 7: Commit**

```bash
cd app && git add Workbench/WorkbenchApp.swift Workbench/AppDelegate.swift Workbench/MenuBarIconRenderer.swift Workbench/Views/ContentView.swift
git commit -m "Add app shell with menu bar icon and badge"
```

---

### Task 14: Theme and navigation shell

Colors are the exact values confirmed in the approved mockup review (Linear-inspired dark: near-black background, violet accent, minimal borders). `ContentView` establishes the sidebar/detail `NavigationSplitView` and wires the menu bar badge to `TodayViewModel.needsInput.count`, but each detail pane is an inline placeholder — Tasks 15-18 each replace one placeholder with its real screen, so the app keeps building and running after every task rather than only at the very end.

**Files:**
- Create: `app/Workbench/Views/Theme.swift`
- Modify: `app/Workbench/Views/ContentView.swift`

**Interfaces:**
- Produces: `Theme` (color constants), `SidebarSection` (enum: `.today`, `.tickets`, `.pullRequests`, `.projects`). Tasks 15-18 replace `ContentView`'s placeholder `case` bodies with real screens and use `Theme` colors throughout.

- [ ] **Step 1: Write `app/Workbench/Views/Theme.swift`**

```swift
import SwiftUI

enum Theme {
    static let background = Color(red: 0.0549, green: 0.0549, blue: 0.0667)
    static let sidebarBackground = Color(red: 0.0784, green: 0.0784, blue: 0.0902)
    static let cardBackground = Color(red: 0.0902, green: 0.0902, blue: 0.1059)
    static let selectedBackground = Color(red: 0.1098, green: 0.1098, blue: 0.1333)
    static let border = Color(red: 0.1373, green: 0.1373, blue: 0.1608)
    static let accent = Color(red: 0.4863, green: 0.4863, blue: 0.9412)
    static let textPrimary = Color(red: 0.9098, green: 0.9098, blue: 0.9255)
    static let textSecondary = Color(red: 0.6510, green: 0.6510, blue: 0.6824)
    static let textMuted = Color(red: 0.3333, green: 0.3333, blue: 0.3686)
    static let success = Color(red: 0.4353, green: 0.8471, blue: 0.5412)
    static let danger = Color(red: 0.9412, green: 0.6275, blue: 0.6275)
}
```

- [ ] **Step 2: Write `app/Workbench/Views/ContentView.swift`**

```swift
import SwiftUI

enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case tickets = "Tickets"
    case pullRequests = "Pull Requests"
    case projects = "Projects"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .today: "sun.max"
        case .tickets: "ticket"
        case .pullRequests: "arrow.triangle.pull"
        case .projects: "folder"
        }
    }
}

struct ContentView: View {
    @Environment(AppDelegate.self) private var appDelegate
    @State private var selection: SidebarSection? = .today
    @State private var todayViewModel = TodayViewModel()
    @State private var ticketsViewModel = TicketsViewModel()
    @State private var prsViewModel = PRsViewModel()
    @State private var projectsViewModel = ProjectsViewModel()

    var body: some View {
        NavigationSplitView {
            List(SidebarSection.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.symbol)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(180)
        } detail: {
            switch selection {
            case .today:
                Text("Today — Task 15 builds this")
            case .tickets:
                Text("Tickets — Task 16 builds this")
            case .pullRequests:
                Text("Pull Requests — Task 17 builds this")
            case .projects:
                Text("Projects — Task 18 builds this")
            case .none:
                Text("Select a section")
            }
        }
        .frame(minWidth: 900, minHeight: 560)
        .task {
            await todayViewModel.load()
        }
        .onChange(of: todayViewModel.needsInput.count) { _, newCount in
            appDelegate.updateBadge(count: newCount)
        }
    }
}
```

- [ ] **Step 3: Regenerate and build**

Run: `cd app && xcodegen generate && xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Manually verify the sidebar navigation works**

```bash
cd app
xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS' -derivedDataPath ./.build 2>&1 | tail -5
open ./.build/Build/Products/Debug/Workbench.app
sleep 2
screencapture -x /tmp/workbench-sidebar-check.png
```

Read `/tmp/workbench-sidebar-check.png` and confirm: a sidebar on the left with four items (Today, Tickets, Pull Requests, Projects), each with an icon, and the detail pane on the right showing "Today — Task 15 builds this" since Today is selected by default. Note: since no engine credentials/token exist in this environment by default, `todayViewModel.load()` may fail silently into `errorMessage` — that's expected and fine for this task; the navigation shell itself is what's being verified.

Quit the app: `osascript -e 'tell application "Workbench" to quit'`.

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/Views/Theme.swift Workbench/Views/ContentView.swift
git commit -m "Add theme and sidebar navigation shell"
```

---

### Task 15: Today screen

Matches the approved mockup: a "needs your input" section (tickets ready to spar, PRs ready or needing attention) followed by the checkable todo list with an add field at the bottom.

**Files:**
- Create: `app/Workbench/Views/TodayScreen.swift`
- Modify: `app/Workbench/Views/ContentView.swift:` — replace the `.today` placeholder case

**Interfaces:**
- Consumes: `TodayViewModel` (Task 9), `TodayItem`, `Todo` (Task 2), `Theme` (Task 14).

- [ ] **Step 1: Write `app/Workbench/Views/TodayScreen.swift`**

```swift
import SwiftUI

struct TodayScreen: View {
    @Bindable var viewModel: TodayViewModel
    @State private var newTodoText = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                sectionHeader("Needs your input", count: viewModel.needsInput.count)
                ForEach(viewModel.needsInput, id: \.uniqueKey) { item in
                    NeedsInputRow(item: item)
                }

                sectionHeader("Todo", count: viewModel.todos.count)
                ForEach(viewModel.todos) { todo in
                    TodoRow(
                        todo: todo,
                        onToggle: { Task { await viewModel.toggleDone(todo) } },
                        onPromote: { Task { await viewModel.promote(todo) } }
                    )
                }

                HStack {
                    TextField("Add a todo...", text: $newTodoText)
                        .textFieldStyle(.plain)
                        .padding(8)
                        .background(Theme.cardBackground)
                        .cornerRadius(6)
                        .onSubmit(addTodo)
                    Button("Add", action: addTodo)
                        .tint(Theme.accent)
                        .disabled(newTodoText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(24)
        }
        .background(Theme.background)
        .task { await viewModel.load() }
        .alert(
            "Error",
            isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private func sectionHeader(_ title: String, count: Int) -> some View {
        Text("\(title.uppercased()) · \(count)")
            .font(.caption)
            .foregroundStyle(Theme.textMuted)
    }

    private func addTodo() {
        let text = newTodoText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        newTodoText = ""
        Task { await viewModel.addTodo(text: text) }
    }
}

private struct NeedsInputRow: View {
    let item: TodayItem

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).foregroundStyle(Theme.textPrimary)
                Text("\(item.kind == .ticket ? "Ticket" : "PR") · \(item.status)")
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer()
            if let score = item.reviewScore {
                Text(String(format: "%.1f/5", score))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(12)
        .background(Theme.cardBackground)
        .cornerRadius(8)
    }
}

private struct TodoRow: View {
    let todo: Todo
    let onToggle: () -> Void
    let onPromote: () -> Void

    var body: some View {
        HStack {
            Button(action: onToggle) {
                Image(systemName: todo.done ? "checkmark.square.fill" : "square")
            }
            .buttonStyle(.plain)
            Text(todo.text).foregroundStyle(Theme.textPrimary)
            Spacer()
            if todo.canPromote {
                Button("Start fixing this", action: onPromote).font(.caption)
            }
        }
        .padding(8)
    }
}
```

- [ ] **Step 2: Replace the `.today` case in `app/Workbench/Views/ContentView.swift`**

```swift
case .today:
    TodayScreen(viewModel: todayViewModel)
```

- [ ] **Step 3: Regenerate and build**

Run: `cd app && xcodegen generate && xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Manually verify**

Build, `open` the app, `screencapture`, and Read the screenshot — same pattern as Tasks 13-14. Confirm the Today screen shows "NEEDS YOUR INPUT · 0" and "TODO · 0" section headers (empty, since no engine data exists in this environment) and an "Add a todo..." field at the bottom. Quit the app afterward.

- [ ] **Step 5: Commit**

```bash
cd app && git add Workbench/Views/TodayScreen.swift Workbench/Views/ContentView.swift
git commit -m "Add Today screen"
```

---

### Task 16: Tickets screen

Ticket list on the left, chat on the right — matching the approved mockup. User messages align right (a slightly highlighted bubble), assistant messages align left, matching the original chat mockup's visual convention. "Create PR" is only enabled while the ticket is `.new` or `.sparring` — once it moves to `.inReview`/`.needsAttention`/`.done` the engine itself would 409 the request (Task 7's `createPr` conflict case), so the button reflects that up front instead of letting the user hit a preventable error.

**Files:**
- Create: `app/Workbench/Views/ChatBubble.swift` — shared between this screen and the Pull Requests screen (Task 17), so it's a standalone (not `private`) file, not nested inside `TicketsScreen.swift`
- Create: `app/Workbench/Views/TicketsScreen.swift`
- Modify: `app/Workbench/Views/ContentView.swift` — replace the `.tickets` placeholder case

**Interfaces:**
- Consumes: `TicketsViewModel` (Task 10), `Ticket`, `TicketMessage`, `ChatRole` (Task 2), `Theme` (Task 14).
- Produces: `ChatBubble(role: ChatRole, content: String)` — Task 17's `PRsScreen` reuses this directly (both `TicketMessage` and `PullRequestMessage` share the same `role`/`content` shape, so one bubble view serves both chats).

- [ ] **Step 1: Write `app/Workbench/Views/ChatBubble.swift`**

```swift
import SwiftUI

struct ChatBubble: View {
    let role: ChatRole
    let content: String

    var body: some View {
        HStack {
            if role == .user { Spacer(minLength: 40) }
            Text(content)
                .foregroundStyle(Theme.textPrimary)
                .padding(10)
                .background(role == .user ? Theme.selectedBackground : Theme.cardBackground)
                .cornerRadius(8)
            if role == .assistant { Spacer(minLength: 40) }
        }
    }
}
```

- [ ] **Step 2: Write `app/Workbench/Views/TicketsScreen.swift`**

```swift
import SwiftUI

struct TicketsScreen: View {
    @Bindable var viewModel: TicketsViewModel
    @State private var messageText = ""

    var body: some View {
        HStack(spacing: 0) {
            List(
                viewModel.tickets,
                selection: Binding<Int?>(
                    get: { viewModel.selectedTicket?.id },
                    set: { id in
                        if let id, let ticket = viewModel.tickets.first(where: { $0.id == id }) {
                            Task { await viewModel.select(ticket) }
                        }
                    }
                )
            ) { ticket in
                VStack(alignment: .leading) {
                    Text(ticket.title).foregroundStyle(Theme.textPrimary)
                    Text(ticket.status.rawValue).font(.caption).foregroundStyle(Theme.textMuted)
                }
            }
            .frame(width: 220)
            .listStyle(.sidebar)

            Divider()

            if let ticket = viewModel.selectedTicket {
                VStack(alignment: .leading, spacing: 0) {
                    Text(ticket.title)
                        .font(.headline)
                        .foregroundStyle(Theme.textPrimary)
                        .padding()

                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(ticket.messages ?? []) { message in
                                ChatBubble(role: message.role, content: message.content)
                            }
                        }
                        .padding()
                    }

                    HStack {
                        TextField("Reply or redirect Claude...", text: $messageText)
                            .textFieldStyle(.plain)
                            .padding(8)
                            .background(Theme.cardBackground)
                            .cornerRadius(6)
                            .onSubmit(sendMessage)
                            .disabled(viewModel.isSending)
                        Button("Create PR") {
                            Task { await viewModel.createPr() }
                        }
                        .tint(Theme.accent)
                        .disabled(viewModel.isSending || !(ticket.status == .new || ticket.status == .sparring))
                    }
                    .padding()
                }
            } else {
                Text("Select a ticket")
                    .foregroundStyle(Theme.textMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .task { await viewModel.load() }
        .alert(
            "Error",
            isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private func sendMessage() {
        let text = messageText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        messageText = ""
        Task { await viewModel.sendMessage(text) }
    }
}
```

- [ ] **Step 3: Replace the `.tickets` case in `app/Workbench/Views/ContentView.swift`**

```swift
case .tickets:
    TicketsScreen(viewModel: ticketsViewModel)
```

- [ ] **Step 4: Regenerate and build**

Run: `cd app && xcodegen generate && xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Manually verify**

Build, `open`, click "Tickets" in the sidebar, `screencapture`, Read the screenshot. Confirm an empty ticket list on the left and "Select a ticket" in the detail pane (no engine data in this environment). Quit the app afterward.

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/Views/ChatBubble.swift Workbench/Views/TicketsScreen.swift Workbench/Views/ContentView.swift
git commit -m "Add Tickets screen"
```

---

### Task 17: Pull Requests screen

The diff viewer is a plain-text, line-by-line renderer that colors `+`/`-` lines (skipping the `+++`/`---` file-header lines, which start with the same characters but aren't additions/deletions) — not a full syntax highlighter, matching the design spec's "syntax-highlighted unified diff" at the fidelity level actually approved in the mockup (colored diff lines, not per-language token coloring). The Merge button and "already merged" empty state are both driven by `pr.status`, matching Task 11's view model, which already skips fetching a diff for a merged PR.

**Files:**
- Create: `app/Workbench/Views/DiffView.swift`
- Create: `app/Workbench/Views/PRsScreen.swift`
- Modify: `app/Workbench/Views/ContentView.swift` — replace the `.pullRequests` placeholder case

**Interfaces:**
- Consumes: `PRsViewModel` (Task 11), `PullRequest`, `PullRequestMessage` (Task 2), `ChatBubble` (Task 16), `Theme` (Task 14).

Note on color: the Merge button is tinted `Theme.success` (green), not `Theme.accent` (violet) — this matches the approved mockup, where Merge was the one deliberately distinct, green-tinted action (every other primary action across the app uses the violet accent).

- [ ] **Step 1: Write `app/Workbench/Views/DiffView.swift`**

```swift
import SwiftUI

struct DiffView: View {
    let diffText: String

    private var lines: [String] {
        diffText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line.isEmpty ? " " : line)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(foregroundColor(for: line))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .background(backgroundColor(for: line))
                }
            }
        }
        .background(Theme.cardBackground)
        .cornerRadius(8)
    }

    private func isAddition(_ line: String) -> Bool { line.hasPrefix("+") && !line.hasPrefix("+++") }
    private func isDeletion(_ line: String) -> Bool { line.hasPrefix("-") && !line.hasPrefix("---") }

    private func backgroundColor(for line: String) -> Color {
        if isAddition(line) { return Theme.success.opacity(0.12) }
        if isDeletion(line) { return Theme.danger.opacity(0.12) }
        return .clear
    }

    private func foregroundColor(for line: String) -> Color {
        if isAddition(line) { return Theme.success }
        if isDeletion(line) { return Theme.danger }
        return Theme.textSecondary
    }
}
```

- [ ] **Step 2: Write `app/Workbench/Views/PRsScreen.swift`**

```swift
import SwiftUI

struct PRsScreen: View {
    @Bindable var viewModel: PRsViewModel
    @State private var messageText = ""

    var body: some View {
        HStack(spacing: 0) {
            List(
                viewModel.pullRequests,
                selection: Binding<Int?>(
                    get: { viewModel.selectedPr?.id },
                    set: { id in
                        if let id, let pr = viewModel.pullRequests.first(where: { $0.id == id }) {
                            Task { await viewModel.select(pr) }
                        }
                    }
                )
            ) { pr in
                VStack(alignment: .leading) {
                    Text("#\(pr.number ?? pr.id)").foregroundStyle(Theme.textPrimary)
                    Text(pr.status.rawValue).font(.caption).foregroundStyle(Theme.textMuted)
                }
            }
            .frame(width: 220)
            .listStyle(.sidebar)

            Divider()

            if let pr = viewModel.selectedPr {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text("#\(pr.number ?? pr.id)").font(.headline).foregroundStyle(Theme.textPrimary)
                            if let score = pr.lastReviewScore {
                                Text("Self-reviewed \(String(format: "%.1f", score))/5")
                                    .font(.caption)
                                    .foregroundStyle(Theme.success)
                            }
                        }
                        Spacer()
                        if let urlString = pr.url, let url = URL(string: urlString) {
                            Link("Open in GitHub", destination: url)
                        }
                        Button("Merge") {
                            Task { await viewModel.merge() }
                        }
                        .tint(Theme.success)
                        .disabled(viewModel.isBusy || pr.status == .merged)
                    }

                    if pr.status == .merged {
                        Text("This PR has been merged. The diff is no longer available.")
                            .foregroundStyle(Theme.textMuted)
                    } else if let diffText = viewModel.diffText {
                        DiffView(diffText: diffText).frame(maxHeight: 260)
                    }

                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(pr.messages ?? []) { message in
                                ChatBubble(role: message.role, content: message.content)
                            }
                        }
                    }

                    if pr.status != .merged {
                        TextField("Fix this, ask a question, or say merge it...", text: $messageText)
                            .textFieldStyle(.plain)
                            .padding(8)
                            .background(Theme.cardBackground)
                            .cornerRadius(6)
                            .onSubmit(sendMessage)
                            .disabled(viewModel.isBusy)
                    }
                }
                .padding()
            } else {
                Text("Select a pull request")
                    .foregroundStyle(Theme.textMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .task { await viewModel.load() }
        .alert(
            "Error",
            isPresented: Binding(get: { viewModel.errorMessage != nil }, set: { if !$0 { viewModel.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private func sendMessage() {
        let text = messageText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        messageText = ""
        Task { await viewModel.sendMessage(text) }
    }
}
```

- [ ] **Step 3: Replace the `.pullRequests` case in `app/Workbench/Views/ContentView.swift`**

```swift
case .pullRequests:
    PRsScreen(viewModel: prsViewModel)
```

- [ ] **Step 4: Regenerate and build**

Run: `cd app && xcodegen generate && xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Manually verify**

Build, `open`, click "Pull Requests" in the sidebar, `screencapture`, Read the screenshot. Confirm an empty PR list on the left and "Select a pull request" in the detail pane. Quit the app afterward.

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/Views/DiffView.swift Workbench/Views/PRsScreen.swift Workbench/Views/ContentView.swift
git commit -m "Add Pull Requests screen"
```

---

### Task 18: Projects settings screen

The last screen — list of configured projects plus an edit form, replacing the engine's old hand-edited `config.json`. A local `ProjectDraft` struct holds the form's text-field state (empty string for an unset optional field, converted to `nil` on save) and is re-synced from `viewModel.selectedProject` via `.onChange` whenever the selection changes, so the form always reflects whichever project is selected without the view model needing to know anything about form/draft state.

**Files:**
- Create: `app/Workbench/Views/ProjectDraft.swift`
- Create: `app/Workbench/Views/ProjectsScreen.swift`
- Modify: `app/Workbench/Views/ContentView.swift` — replace the `.projects` placeholder case

**Interfaces:**
- Consumes: `ProjectsViewModel` (Task 12), `Project`, `ProjectInput`, `ProjectUpdate` (Tasks 2, 5), `Theme` (Task 14).

- [ ] **Step 1: Write `app/Workbench/Views/ProjectDraft.swift`**

```swift
struct ProjectDraft {
    var name = ""
    var repoPath = ""
    var defaultBranch = "main"
    var githubRepo = ""
    var jiraProjectKey = ""
    var sentryProjectSlug = ""

    init() {}

    init(project: Project) {
        name = project.name
        repoPath = project.repoPath
        defaultBranch = project.defaultBranch
        githubRepo = project.githubRepo ?? ""
        jiraProjectKey = project.jiraProjectKey ?? ""
        sentryProjectSlug = project.sentryProjectSlug ?? ""
    }

    func asInput() -> ProjectInput {
        ProjectInput(
            name: name, repoPath: repoPath, defaultBranch: defaultBranch,
            githubRepo: githubRepo.isEmpty ? nil : githubRepo,
            jiraProjectKey: jiraProjectKey.isEmpty ? nil : jiraProjectKey,
            sentryProjectSlug: sentryProjectSlug.isEmpty ? nil : sentryProjectSlug
        )
    }

    func asUpdate() -> ProjectUpdate {
        ProjectUpdate(
            name: name, repoPath: repoPath, defaultBranch: defaultBranch,
            githubRepo: githubRepo.isEmpty ? nil : githubRepo,
            jiraProjectKey: jiraProjectKey.isEmpty ? nil : jiraProjectKey,
            sentryProjectSlug: sentryProjectSlug.isEmpty ? nil : sentryProjectSlug
        )
    }
}
```

- [ ] **Step 2: Write `app/Workbench/Views/ProjectsScreen.swift`**

```swift
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
                        isCreatingNew = false
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
```

- [ ] **Step 3: Replace the `.projects` case in `app/Workbench/Views/ContentView.swift`**

```swift
case .projects:
    ProjectsScreen(viewModel: projectsViewModel)
```

- [ ] **Step 4: Regenerate and build**

Run: `cd app && xcodegen generate && xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Manually verify**

Build, `open`, click "Projects" in the sidebar, `screencapture`, Read the screenshot. Confirm an empty project list, a "+ Add project" affordance at the bottom of the list, and "No projects yet" in the detail pane. Click "+ Add project" and confirm the edit form appears with all six labeled fields and a "Create" button. Quit the app afterward.

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/Views/ProjectDraft.swift Workbench/Views/ProjectsScreen.swift Workbench/Views/ContentView.swift
git commit -m "Add Projects settings screen"
```

---

### Task 19: Native notifications, polling, and final end-to-end verification

The last task. Folds notification posting into `AppDelegate` (Task 13) rather than a separate manager class — both a menu bar click and a clicked notification need to do the exact same thing (bring the window forward), so they share one `bringWindowForward()` method, matching the spec's "clicking the icon, or a native notification it fires, brings the full window forward." `ContentView`'s single `.task { await todayViewModel.load() }` becomes a polling loop that diffs `needsInput` between cycles and fires one notification per newly-appeared item — the first cycle only establishes a baseline (no notifications fire for what was already there when the app launched).

**Files:**
- Modify: `app/Workbench/AppDelegate.swift` — add `UNUserNotificationCenterDelegate` conformance, `notify(title:body:)`, and authorization request
- Modify: `app/Workbench/Views/ContentView.swift` — replace the one-shot Today load with a polling loop

**Interfaces:**
- Produces: `AppDelegate.notify(title: String, body: String)`. Nothing later depends on this — it's the last task in this plan.

- [ ] **Step 1: Modify `app/Workbench/AppDelegate.swift`**

```swift
import AppKit
import Observation
import UserNotifications

@Observable
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = MenuBarIconRenderer.image(badgeCount: 0)
        item.button?.action = #selector(statusItemClicked)
        item.button?.target = self
        statusItem = item

        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func updateBadge(count: Int) {
        statusItem?.button?.image = MenuBarIconRenderer.image(badgeCount: count)
    }

    func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func bringWindowForward() {
        NSApp.activate(ignoringOtherApps: true)
        for window in NSApp.windows {
            window.makeKeyAndOrderFront(nil)
        }
    }

    @objc private func statusItemClicked() {
        bringWindowForward()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            bringWindowForward()
        }
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
```

- [ ] **Step 2: Modify `app/Workbench/Views/ContentView.swift`** — replace the `.task` modifier

```swift
.task {
    var previousKeys: Set<String> = []
    var isFirstCycle = true
    while !Task.isCancelled {
        await todayViewModel.load()
        let currentKeys = Set(todayViewModel.needsInput.map(\.uniqueKey))
        if !isFirstCycle {
            let newlyAppeared = todayViewModel.needsInput.filter { !previousKeys.contains($0.uniqueKey) }
            for item in newlyAppeared {
                appDelegate.notify(title: notificationTitle(for: item), body: item.title)
            }
        }
        previousKeys = currentKeys
        isFirstCycle = false
        try? await Task.sleep(for: .seconds(15))
    }
}
```

Add this helper function inside `ContentView` (a private method, alongside `body`):

```swift
private func notificationTitle(for item: TodayItem) -> String {
    if item.status == "needs_attention" {
        return item.kind == .ticket ? "Fix failed, needs attention" : "PR needs attention"
    }
    return item.kind == .ticket ? "Ticket ready to spar" : "PR ready for review"
}
```

- [ ] **Step 3: Regenerate, build, and confirm the test suite is still green**

Run: `cd app && xcodegen generate && xcodebuild test -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS'`
Expected: `** TEST SUCCEEDED **`, still 60 tests passing (this task touches no tested code, only `AppDelegate` and the polling loop, neither of which has automated tests per this plan's Global Constraints).

- [ ] **Step 4: Manually verify notification permission is requested**

```bash
cd app
xcodebuild build -project Workbench.xcodeproj -scheme Workbench -destination 'platform=macOS' -derivedDataPath ./.build 2>&1 | tail -5
open ./.build/Build/Products/Debug/Workbench.app
sleep 2
```

Open System Settings > Notifications and confirm "Workbench" now appears in the list of apps (macOS only lists apps that have called `requestAuthorization` at least once) — this confirms the permission request actually fired, even though no real notification will appear without engine data. Quit the app: `osascript -e 'tell application "Workbench" to quit'`.

- [ ] **Step 5: Final full end-to-end manual verification**

```bash
cd app
open ./.build/Build/Products/Debug/Workbench.app
sleep 2
screencapture -x /tmp/workbench-final-today.png
```

Read `/tmp/workbench-final-today.png` — confirm the Today screen, menu bar icon, and sidebar all render correctly together (this is the first time everything appears in one running process). Click each of the four sidebar sections in turn (Tickets, Pull Requests, Projects, back to Today) — if you have a way to script clicks (e.g. `osascript` targeting the app's UI), use it; otherwise note in your report that this needs a human click-through, since this plan has no UI automation. Confirm the process doesn't crash (`pgrep -x Workbench` still shows it running) after navigating. Quit the app when done.

If you configured a real Workbench engine (Task setup in the engine's own README) and it's running on `127.0.0.1:4173` with at least one project registered, this is also the point to do a real walkthrough: confirm the Today list actually populates from the engine, add a manual todo, open a ticket and send a chat message, and confirm the reply appears after the request completes.

- [ ] **Step 6: Commit**

```bash
cd app && git add Workbench/AppDelegate.swift Workbench/Views/ContentView.swift
git commit -m "Add native notifications and Today polling"
```

---
