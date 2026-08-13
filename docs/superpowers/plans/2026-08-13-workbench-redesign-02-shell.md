# Workbench Redesign Phase 2: App Shell & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current native `NavigationSplitView` shell with the redesign's custom sidebar + persistent header shell, using Phase 1's tokens, while every screen underneath (`TodayScreen`, `TicketsScreen`, `PRsScreen`, `ProjectsScreen`) keeps rendering exactly as it does today — this phase touches only the chrome around them.

**Architecture:** `ContentView.swift`'s `NavigationSplitView` is replaced with a plain `HStack { Sidebar(...); VStack { AppHeader(...); <existing content switch> } }`. This is a deliberate departure from the native split-view control: the design has no native macOS toolbar/traffic-light chrome, a fixed non-resizable 228pt sidebar, and (in later phases) overlays that must be absolutely positioned within the main column only — a `NavigationSplitView` fights all three. Two new files carry the new chrome (`Sidebar.swift`, `AppHeader.swift`); their non-view logic (counts, colors, initials, kicker/heading text) is extracted into two small pure-function helper types so it can be unit tested the way this codebase already tests logic (Models/ViewModels/Networking have tests; Views never have — this phase follows that convention: helper *logic* gets tests, the *View* structs do not).

**Tech Stack:** SwiftUI, Swift Testing (`@Test`).

## Global Constraints

- Every screen (`TodayScreen`, `TicketsScreen`, `PRsScreen`, `ProjectsScreen`) must render unmodified — do not edit those four files in this phase.
- `ContentView`'s existing `.task` polling loop (15s `todayViewModel.load()`, notification-on-new-`needsInput`, badge update via `.onChange(of: todayViewModel.needsInput.count)`) must survive this rewrite byte-for-byte in behavior — only the surrounding layout changes.
- The search/palette button, the header's Agent button, and the footer's gear button are **intentional stubs** in this phase — give them empty `action: {}` closures. Command palette (Phase 7), the agent chat panel (Phase 3), and any settings screen are future phases' work, not this one's.
- Exact values from the design (`README.md` "Sidebar (persistent)" and "Header (persistent)" sections, already verified — use these, don't re-derive):
  - Sidebar: width 228pt, `border-right: 1px solid` `Theme.Neutral.n900`, background a top-to-bottom gradient from `#1a1c2b` (new token, add it) to `Theme.nocturneBg` (`#161826`), padding `Theme.Space.s6` vertical / `Theme.Space.s4` horizontal, vertical stack with `Theme.Space.s6` gaps between brand/search/nav/projects-list/footer regions.
  - Brand row: 22×22pt rounded-square (radius `Theme.Radius.md` is 8 — spec says 6px; use a dedicated `6` literal here, it's a one-off not on the radius scale) with a 1px `Theme.nocturneAccent` border, `wrench.and.screwdriver` SF Symbol (Phosphor's toolbox has no direct SF Symbol equivalent) in `Theme.nocturneAccent` at 12pt, plus "Workbench" in `Theme.heading(15)` with `-0.01em`-equivalent tracking (SwiftUI: `.tracking(-0.15)` at size 15 approximates -0.01em).
  - Search button: full width, 1px `Theme.Neutral.n800` border, radius `Theme.Radius.md`, `magnifyingglass` SF Symbol + "Search or add" in `Theme.Neutral.n400`, trailing "⌘K" in `Theme.FontSize.label` / `Theme.Neutral.n600`.
  - Nav rows (`SidebarSection`, in this exact order): Today (`sun.horizon`), Projects (`square.grid.2x2`), Pull requests (`arrow.triangle.pull`), Issues (`list.bullet.rectangle`). Each row: `Theme.Space.s3` horizontal padding is `--space-3`, `--space-2` per spec ("padding: var(--space-2) var(--space-3)") → vertical `Theme.Space.s2`, horizontal `Theme.Space.s3`; radius `Theme.Radius.md`; label at `Theme.FontSize.body` (14); trailing count at `Theme.FontSize.label` (11) in `Theme.Neutral.n600`. Selected row: background `Theme.Accent.a900`, text `Theme.Accent.a200`. Unselected: text `Theme.Neutral.n400`.
  - "PROJECTS" section label: `Theme.FontSize.label` uppercase, `Theme.Neutral.n600`, with the total project count on the right in `Theme.Neutral.n700`. Project rows: 6pt dot (color from `Theme.projectDotColors`, one per project by index, wrapping), name at `Theme.FontSize.secondary` (13) truncating with an ellipsis, trailing open-count at `Theme.FontSize.label` in `Theme.Neutral.n600`.
  - Footer: 1px top border `Theme.Neutral.n900`, 22×22pt circular avatar (background `Theme.Accent.a800`, text `Theme.Accent.a200`, `Theme.FontSize.tag` (10) initials), name at `Theme.FontSize.tableMeta` (12) in `Theme.Neutral.n400`, `gearshape` SF Symbol at 14pt in `Theme.Neutral.n600`.
  - Header: padding `Theme.Space.s6` vertical / `Theme.Space.s8` horizontal, 1px bottom border `Theme.Neutral.n900`. Left: kicker at `Theme.FontSize.label` uppercase in `Theme.Neutral.n600`, heading at `Theme.FontSize.screenTitle` (22) in `Theme.heading`. Right: "Agent" button with a `sparkles` SF Symbol, styled as an outlined accent button (1px `Theme.nocturneAccent` border, `Theme.nocturneAccent` text, transparent background).
- Per-screen kicker/heading text (README's Header table, with one intentional deviation noted): Today → kicker is the live date, heading "Today". Projects → kicker is the project count (the design's "N active" requires a `Project.status` field that doesn't exist until Phase 5 — until then, show "N projects" using the total count; Phase 5's plan should revisit this), heading "Projects". Pull requests → kicker "GitHub", heading "Pull requests". Issues → kicker "Jira · GitHub", heading "Issues".
- Nav row counts and project row counts must be real, derived from data the four existing ViewModels already load (`todayViewModel.todos`, `ticketsViewModel.tickets`, `prsViewModel.pullRequests`, `projectsViewModel.projects`) — no new network calls, no new ViewModels.
- `SidebarSection`'s `.tickets` case is renamed to `.issues` in this phase (a pure Swift identifier, not part of any persisted model or API — safe, and keeps naming consistent with the new "Issues" vocabulary used everywhere else in the redesign). The underlying `Ticket` model and `tickets` DB table are NOT renamed (per the roadmap's global constraints).

## Task 1: `SidebarSection` rewrite

**Files:**
- Modify: `app/Workbench/Views/ContentView.swift` (the `SidebarSection` enum only — its usage in `ContentView`'s body is Task 5's job)
- Test: `app/WorkbenchTests/Views/SidebarSectionTests.swift` (new file)

**Interfaces:**
- Produces: `SidebarSection` with cases `.today, .projects, .pullRequests, .issues` (in that order), `.symbol: String`, `.rawValue: String` (used as display label).

- [ ] **Step 1: Write the failing tests**

Create `app/WorkbenchTests/Views/SidebarSectionTests.swift`:

```swift
import Testing
@testable import Workbench

@Test func sidebarSectionOrderMatchesDesignNav() {
    #expect(SidebarSection.allCases == [.today, .projects, .pullRequests, .issues])
}

@Test func sidebarSectionLabelsMatchDesignNav() {
    #expect(SidebarSection.today.rawValue == "Today")
    #expect(SidebarSection.projects.rawValue == "Projects")
    #expect(SidebarSection.pullRequests.rawValue == "Pull Requests")
    #expect(SidebarSection.issues.rawValue == "Issues")
}

@Test func sidebarSectionSymbolsMatchDesignNav() {
    #expect(SidebarSection.today.symbol == "sun.horizon")
    #expect(SidebarSection.projects.symbol == "square.grid.2x2")
    #expect(SidebarSection.pullRequests.symbol == "arrow.triangle.pull")
    #expect(SidebarSection.issues.symbol == "list.bullet.rectangle")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: FAIL to build — `SidebarSection` still has `.tickets` instead of `.projects`/`.issues` in the wrong order, and `.symbol` for `.today`/`.issues` don't exist with these names/values yet (the enum currently has `.tickets` with symbol `"ticket"`, not `.issues` with `"list.bullet.rectangle"`).

- [ ] **Step 3: Rewrite the enum**

In `app/Workbench/Views/ContentView.swift`, replace the existing `SidebarSection` enum (lines 3-19) with:

```swift
enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case projects = "Projects"
    case pullRequests = "Pull Requests"
    case issues = "Issues"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .today: "sun.horizon"
        case .projects: "square.grid.2x2"
        case .pullRequests: "arrow.triangle.pull"
        case .issues: "list.bullet.rectangle"
        }
    }
}
```

Leave the rest of `ContentView.swift` (the `ContentView` struct itself) untouched for now — its references to `.tickets`/`TicketsScreen` will be fixed in Task 5, and the file will not compile as a whole until then. That's expected: this task's own test target (`WorkbenchTests`) only needs `SidebarSection` itself to compile correctly, but `ContentView.swift`'s `switch selection { case .tickets: ... }` will now fail to compile since `.tickets` no longer exists.

To keep the whole target building after this task (so the test run in Step 4 actually succeeds), also update the two references in `ContentView`'s body: change `case .tickets:` to `case .issues:` (same line, same `TicketsScreen(viewModel: ticketsViewModel)` on the right — this screen is untouched, only which enum case routes to it changes) and update `case .projects:` / add nothing else — `.projects` already existed and still routes to `ProjectsScreen`. After this minimal fix, `ContentView.swift`'s `switch` should have exactly: `.today` → `TodayScreen`, `.projects` → `ProjectsScreen`, `.pullRequests` → `PRsScreen`, `.issues` → `TicketsScreen`. Do not touch anything else in `ContentView` — the full shell rewrite is Task 5.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: PASS — the whole target builds and all tests including the 3 new ones are green.

- [ ] **Step 5: Commit**

```bash
git add app/Workbench/Views/ContentView.swift app/WorkbenchTests/Views/SidebarSectionTests.swift
git commit -m "feat(shell): reorder and relabel SidebarSection for the new nav (issues replaces tickets)"
```

## Task 2: Sidebar display-logic helpers

**Files:**
- Create: `app/Workbench/Views/SidebarLogic.swift`
- Test: `app/WorkbenchTests/Views/SidebarLogicTests.swift` (new file)

**Interfaces:**
- Produces: `SidebarLogic.navCount(for:todos:tickets:prs:projects:) -> Int`, `SidebarLogic.projectOpenCount(for:todos:) -> Int`, `SidebarLogic.projectDotColor(at:) -> Color`, `SidebarLogic.accountInitials(from:) -> String`.
- Consumes: `SidebarSection` (Task 1), `Todo`/`Ticket`/`PullRequest`/`Project` models (existing), `Theme.projectDotColors` (Phase 1).

- [ ] **Step 1: Write the failing tests**

Create `app/WorkbenchTests/Views/SidebarLogicTests.swift`:

```swift
import Testing
import SwiftUI
@testable import Workbench

private func todo(id: Int, projectId: Int?, done: Bool) -> Todo {
    Todo(id: id, source: .manual, sourceId: nil, text: "t\(id)", body: "", url: nil,
         projectId: projectId, canPromote: false, done: done, promotedTicketId: nil,
         createdAt: "2026-08-13T00:00:00.000Z")
}

@Test func navCountForTodayCountsOnlyIncompleteTodos() {
    let todos = [todo(id: 1, projectId: 1, done: false), todo(id: 2, projectId: 1, done: true)]
    #expect(SidebarLogic.navCount(for: .today, todos: todos, tickets: [], prs: [], projects: []) == 1)
}

@Test func navCountForProjectsCountsAllProjects() {
    let projects = [
        Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil),
        Project(id: 2, name: "b", repoPath: "/b", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    ]
    #expect(SidebarLogic.navCount(for: .projects, todos: [], tickets: [], prs: [], projects: projects) == 2)
}

@Test func projectOpenCountCountsOnlyIncompleteTodosForThatProject() {
    let project = Project(id: 1, name: "a", repoPath: "/a", defaultBranch: "main", githubRepo: nil, jiraProjectKey: nil, sentryProjectSlug: nil)
    let todos = [
        todo(id: 1, projectId: 1, done: false),
        todo(id: 2, projectId: 1, done: true),
        todo(id: 3, projectId: 2, done: false)
    ]
    #expect(SidebarLogic.projectOpenCount(for: project, todos: todos) == 1)
}

@Test func projectDotColorWrapsAroundThePalette() {
    #expect(SidebarLogic.projectDotColor(at: 0) == Theme.projectDotColors[0])
    #expect(SidebarLogic.projectDotColor(at: 8) == Theme.projectDotColors[0])
    #expect(SidebarLogic.projectDotColor(at: 9) == Theme.projectDotColors[1])
}

@Test func accountInitialsFromTwoWordName() {
    #expect(SidebarLogic.accountInitials(from: "Wahid Linku") == "WL")
}

@Test func accountInitialsFromSingleWordName() {
    #expect(SidebarLogic.accountInitials(from: "Wahid") == "WA")
}

@Test func accountInitialsFromEmptyName() {
    #expect(SidebarLogic.accountInitials(from: "") == "")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: FAIL to build — `SidebarLogic` doesn't exist yet.

- [ ] **Step 3: Implement `SidebarLogic`**

Create `app/Workbench/Views/SidebarLogic.swift`:

```swift
import SwiftUI

enum SidebarLogic {
    static func navCount(
        for section: SidebarSection,
        todos: [Todo],
        tickets: [Ticket],
        prs: [PullRequest],
        projects: [Project]
    ) -> Int {
        switch section {
        case .today: todos.filter { !$0.done }.count
        case .projects: projects.count
        case .pullRequests: prs.count
        case .issues: tickets.count
        }
    }

    static func projectOpenCount(for project: Project, todos: [Todo]) -> Int {
        todos.filter { $0.projectId == project.id && !$0.done }.count
    }

    static func projectDotColor(at index: Int) -> Color {
        Theme.projectDotColors[index % Theme.projectDotColors.count]
    }

    static func accountInitials(from fullName: String) -> String {
        let parts = fullName.split(separator: " ").filter { !$0.isEmpty }
        if parts.count >= 2 {
            return (parts[0].prefix(1) + parts[1].prefix(1)).uppercased()
        } else if let first = parts.first {
            return first.prefix(2).uppercased()
        }
        return ""
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: PASS — all 7 new tests green.

- [ ] **Step 5: Commit**

```bash
git add app/Workbench/Views/SidebarLogic.swift app/WorkbenchTests/Views/SidebarLogicTests.swift
git commit -m "feat(shell): add pure display-logic helpers for the sidebar (counts, dot colors, initials)"
```

## Task 3: `Sidebar.swift` view

**Files:**
- Modify: `app/Workbench/Views/Theme.swift` (one new token)
- Test: `app/WorkbenchTests/Views/ThemeTests.swift` (one new test, same pattern as Phase 1)
- Create: `app/Workbench/Views/Sidebar.swift`

**Interfaces:**
- Consumes: `SidebarSection` (Task 1), `SidebarLogic` (Task 2), `Theme.*` (Phase 1 + this task's new token), `Todo`/`Ticket`/`PullRequest`/`Project` models.
- Produces: `Sidebar`, a SwiftUI `View` with this initializer signature (later tasks/Task 5 depend on this exact signature):
  ```swift
  struct Sidebar: View {
      let selection: SidebarSection
      let todos: [Todo]
      let tickets: [Ticket]
      let prs: [PullRequest]
      let projects: [Project]
      let onSelect: (SidebarSection) -> Void
      let onSelectProject: (Project) -> Void
  }
  ```

- [ ] **Step 1: Write the failing test for the new Theme token**

Append to `app/WorkbenchTests/Views/ThemeTests.swift`:

```swift
@Test func sidebarGradientTopMatchesDesignTokens() {
    expectHex(Theme.sidebarGradientTop, "1A1C2B")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: FAIL to build — `Theme.sidebarGradientTop` doesn't exist yet.

- [ ] **Step 3: Add the token**

In `app/Workbench/Views/Theme.swift`, inside the existing `extension Theme { ... }` block, add:

```swift
static let sidebarGradientTop = Color(hex: "1A1C2B")
```

- [ ] **Step 4: Run tests to verify the token test passes**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: PASS.

- [ ] **Step 5: Build `Sidebar.swift`**

Create `app/Workbench/Views/Sidebar.swift`:

```swift
import SwiftUI

struct Sidebar: View {
    let selection: SidebarSection
    let todos: [Todo]
    let tickets: [Ticket]
    let prs: [PullRequest]
    let projects: [Project]
    let onSelect: (SidebarSection) -> Void
    let onSelectProject: (Project) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s6) {
            brandRow
            searchButton
            navRows
            projectsList
            footer
        }
        .padding(.vertical, Theme.Space.s6)
        .padding(.horizontal, Theme.Space.s4)
        .frame(width: 228, alignment: .leading)
        .frame(maxHeight: .infinity)
        .background(
            LinearGradient(colors: [Theme.sidebarGradientTop, Theme.nocturneBg], startPoint: .top, endPoint: .bottom)
        )
        .overlay(alignment: .trailing) {
            Rectangle().fill(Theme.Neutral.n900).frame(width: 1)
        }
    }

    private var brandRow: some View {
        HStack(spacing: Theme.Space.s3) {
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(Theme.nocturneAccent, lineWidth: 1)
                .frame(width: 22, height: 22)
                .overlay {
                    Image(systemName: "wrench.and.screwdriver")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.nocturneAccent)
                }
            Text("Workbench")
                .font(Theme.heading(15))
                .tracking(-0.15)
                .foregroundStyle(Theme.nocturneText)
        }
    }

    private var searchButton: some View {
        Button(action: {}) {
            HStack {
                HStack(spacing: Theme.Space.s2) {
                    Image(systemName: "magnifyingglass")
                    Text("Search or add")
                }
                Spacer()
                Text("⌘K")
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n600)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.Neutral.n400)
        .padding(.vertical, Theme.Space.s2)
        .padding(.horizontal, Theme.Space.s3)
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.Neutral.n800, lineWidth: 1))
    }

    private var navRows: some View {
        VStack(spacing: 2) {
            ForEach(SidebarSection.allCases) { section in
                let isSelected = section == selection
                Button {
                    onSelect(section)
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: section.symbol).font(.system(size: 16))
                        Text(section.rawValue).font(.system(size: Theme.FontSize.body))
                        Spacer()
                        Text("\(SidebarLogic.navCount(for: section, todos: todos, tickets: tickets, prs: prs, projects: projects))")
                            .font(.system(size: Theme.FontSize.label))
                            .foregroundStyle(Theme.Neutral.n600)
                            .monospacedDigit()
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(isSelected ? Theme.Accent.a200 : Theme.Neutral.n400)
                .padding(.vertical, Theme.Space.s2)
                .padding(.horizontal, Theme.Space.s3)
                .background(isSelected ? Theme.Accent.a900 : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            }
        }
    }

    private var projectsList: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack {
                Text("PROJECTS")
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.8)
                    .foregroundStyle(Theme.Neutral.n600)
                Spacer()
                Text("\(projects.count)")
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n700)
            }
            .padding(.horizontal, Theme.Space.s3)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(Array(projects.enumerated()), id: \.element.id) { index, project in
                        Button {
                            onSelectProject(project)
                        } label: {
                            HStack(spacing: Theme.Space.s3) {
                                Circle().fill(SidebarLogic.projectDotColor(at: index)).frame(width: 6, height: 6)
                                Text(project.name)
                                    .font(.system(size: Theme.FontSize.secondary))
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Spacer()
                                Text("\(SidebarLogic.projectOpenCount(for: project, todos: todos))")
                                    .font(.system(size: Theme.FontSize.label))
                                    .foregroundStyle(Theme.Neutral.n600)
                                    .monospacedDigit()
                            }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.Neutral.n500)
                        .padding(.vertical, Theme.Space.s2)
                        .padding(.horizontal, Theme.Space.s3)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var footer: some View {
        HStack(spacing: Theme.Space.s3) {
            Circle()
                .fill(Theme.Accent.a800)
                .frame(width: 22, height: 22)
                .overlay {
                    Text(SidebarLogic.accountInitials(from: ProcessInfo.processInfo.fullUserName))
                        .font(.system(size: Theme.FontSize.tag))
                        .foregroundStyle(Theme.Accent.a200)
                }
            Text(ProcessInfo.processInfo.fullUserName)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n400)
            Spacer()
            Button(action: {}) {
                Image(systemName: "gearshape").font(.system(size: 14))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.Neutral.n600)
        }
        .padding(.vertical, Theme.Space.s2)
        .padding(.horizontal, Theme.Space.s3)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }
}
```

- [ ] **Step 6: Verify it builds**

Run: `cd app && xcodebuild build -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`. `Sidebar` isn't wired into `ContentView` yet (that's Task 5), so there's nothing to visually check yet — a clean build is this step's only signal.

- [ ] **Step 7: Commit**

```bash
git add app/Workbench/Views/Theme.swift app/WorkbenchTests/Views/ThemeTests.swift app/Workbench/Views/Sidebar.swift
git commit -m "feat(shell): add the redesigned Sidebar view"
```

## Task 4: `AppHeader.swift` view

**Files:**
- Create: `app/Workbench/Views/AppHeader.swift`
- Test: `app/WorkbenchTests/Views/AppHeaderLogicTests.swift` (new file)

**Interfaces:**
- Produces: `AppHeaderLogic.kicker(for:projectCount:todayDateString:) -> String`, `AppHeaderLogic.heading(for:) -> String`, and `AppHeader`, a SwiftUI `View` with this initializer signature (Task 5 depends on this exact signature):
  ```swift
  struct AppHeader: View {
      let section: SidebarSection
      let projectCount: Int
      let onOpenAgent: () -> Void
  }
  ```
- Consumes: `SidebarSection` (Task 1), `Theme.*` (Phase 1).

- [ ] **Step 1: Write the failing tests**

Create `app/WorkbenchTests/Views/AppHeaderLogicTests.swift`:

```swift
import Testing
@testable import Workbench

@Test func kickerForTodayIsTheGivenDateString() {
    #expect(AppHeaderLogic.kicker(for: .today, projectCount: 0, todayDateString: "Thursday, 13 August") == "Thursday, 13 August")
}

@Test func kickerForProjectsShowsThePluralizedCount() {
    #expect(AppHeaderLogic.kicker(for: .projects, projectCount: 1, todayDateString: "") == "1 project")
    #expect(AppHeaderLogic.kicker(for: .projects, projectCount: 8, todayDateString: "") == "8 projects")
}

@Test func kickerForPullRequestsIsGitHub() {
    #expect(AppHeaderLogic.kicker(for: .pullRequests, projectCount: 0, todayDateString: "") == "GitHub")
}

@Test func kickerForIssuesIsJiraGitHub() {
    #expect(AppHeaderLogic.kicker(for: .issues, projectCount: 0, todayDateString: "") == "Jira · GitHub")
}

@Test func headingsMatchEachSection() {
    #expect(AppHeaderLogic.heading(for: .today) == "Today")
    #expect(AppHeaderLogic.heading(for: .projects) == "Projects")
    #expect(AppHeaderLogic.heading(for: .pullRequests) == "Pull requests")
    #expect(AppHeaderLogic.heading(for: .issues) == "Issues")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: FAIL to build — `AppHeaderLogic` doesn't exist yet.

- [ ] **Step 3: Implement `AppHeaderLogic` and `AppHeader`**

Create `app/Workbench/Views/AppHeader.swift`:

```swift
import SwiftUI

enum AppHeaderLogic {
    static func kicker(for section: SidebarSection, projectCount: Int, todayDateString: String) -> String {
        switch section {
        case .today: todayDateString
        case .projects: "\(projectCount) project\(projectCount == 1 ? "" : "s")"
        case .pullRequests: "GitHub"
        case .issues: "Jira · GitHub"
        }
    }

    static func heading(for section: SidebarSection) -> String {
        switch section {
        case .today: "Today"
        case .projects: "Projects"
        case .pullRequests: "Pull requests"
        case .issues: "Issues"
        }
    }
}

struct AppHeader: View {
    let section: SidebarSection
    let projectCount: Int
    let onOpenAgent: () -> Void

    private var todayDateString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, d MMMM"
        return formatter.string(from: Date())
    }

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.s4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(AppHeaderLogic.kicker(for: section, projectCount: projectCount, todayDateString: todayDateString))
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.8)
                    .foregroundStyle(Theme.Neutral.n600)
                Text(AppHeaderLogic.heading(for: section))
                    .font(Theme.heading(Theme.FontSize.screenTitle))
                    .foregroundStyle(Theme.nocturneText)
            }
            Spacer()
            Button(action: onOpenAgent) {
                HStack(spacing: Theme.Space.s2) {
                    Image(systemName: "sparkles")
                    Text("Agent")
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.nocturneAccent)
            .padding(.vertical, Theme.Space.s2)
            .padding(.horizontal, Theme.Space.s3)
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.nocturneAccent, lineWidth: 1))
        }
        .padding(.vertical, Theme.Space.s6)
        .padding(.horizontal, Theme.Space.s8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: PASS — all 6 new tests green.

- [ ] **Step 5: Commit**

```bash
git add app/Workbench/Views/AppHeader.swift app/WorkbenchTests/Views/AppHeaderLogicTests.swift
git commit -m "feat(shell): add the persistent AppHeader view"
```

## Task 5: Wire `Sidebar` and `AppHeader` into `ContentView`

**Files:**
- Modify: `app/Workbench/Views/ContentView.swift`

**Interfaces:**
- Consumes: `Sidebar` (Task 3), `AppHeader` (Task 4), `SidebarSection` (Task 1, already updated).

- [ ] **Step 1: Replace the body**

In `app/Workbench/Views/ContentView.swift`, replace the `body` computed property (currently the `NavigationSplitView { ... } detail: { ... }` block, roughly lines 29-52 after Task 1's edit) with:

```swift
var body: some View {
    HStack(spacing: 0) {
        Sidebar(
            selection: selection ?? .today,
            todos: todayViewModel.todos,
            tickets: ticketsViewModel.tickets,
            prs: prsViewModel.pullRequests,
            projects: projectsViewModel.projects,
            onSelect: { selection = $0 },
            onSelectProject: { project in
                selection = .projects
                projectsViewModel.selectedProject = project
            }
        )
        VStack(spacing: 0) {
            AppHeader(
                section: selection ?? .today,
                projectCount: projectsViewModel.projects.count,
                onOpenAgent: {}
            )
            content
        }
    }
    .background(Theme.nocturneBg)
    .frame(minWidth: 900, minHeight: 560)
    .preferredColorScheme(.dark)
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
    .onChange(of: todayViewModel.needsInput.count) { _, newCount in
        appDelegate.updateBadge(count: newCount)
    }
}

@ViewBuilder
private var content: some View {
    switch selection {
    case .today:
        TodayScreen(viewModel: todayViewModel)
    case .issues:
        TicketsScreen(viewModel: ticketsViewModel)
    case .pullRequests:
        PRsScreen(viewModel: prsViewModel)
    case .projects:
        ProjectsScreen(viewModel: projectsViewModel)
    case .none:
        Text("Select a section")
    }
}
```

Every line of the `.task { ... }` polling block and the `.onChange(...)` badge update is copied verbatim from the current implementation — only their position (now modifiers on the outer `HStack` instead of the `NavigationSplitView`) and the surrounding layout changed. `projectsViewModel.projects` also needs to already be loaded for the header's project count and the sidebar's project list to show real numbers — check `ProjectsViewModel.load()`; if `ContentView` doesn't currently trigger it anywhere (the existing code only `.task`-loads `todayViewModel`), add a one-line `await projectsViewModel.load()` inside the same `.task` block, right before the `while` loop, so it loads once at launch. Similarly check `ticketsViewModel`/`prsViewModel` — if `TodayScreen`/`TicketsScreen`/`PRsScreen` each already call `.load()` in their own `.task` when they first appear (per their existing `.task { await viewModel.load() }` pattern noted in each screen), the sidebar's counts for those two will simply read 0 until the user visits that screen once. That's an acceptable, honest interim gap for this phase (not a data bug — the ViewModels just haven't fetched yet) — do not add duplicate load-triggering logic for `ticketsViewModel`/`prsViewModel` here; leave that to whichever later phase actually needs it addressed, and note it in your report as a self-review finding rather than silently fixing it with un-planned code.

- [ ] **Step 2: Build**

Run: `cd app && xcodebuild build -scheme Workbench -destination 'platform=macOS'`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Run the full test suite**

Run: `cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests`
Expected: PASS on every suite this phase touched (`SidebarSectionTests`, `SidebarLogicTests`, `ThemeTests`, `AppHeaderLogicTests`) plus no new failures in previously-passing suites. The 5 `APIClient*Tests` suites may still show their pre-existing, documented flakiness (see the roadmap's Global Constraints) — that's not this task's concern; note it in your report if you see it, don't try to fix it.

- [ ] **Step 4: Commit**

```bash
git add app/Workbench/Views/ContentView.swift
git commit -m "feat(shell): wire Sidebar and AppHeader into ContentView, replacing NavigationSplitView"
```

## Self-Review Notes

- Spec coverage: sidebar (brand, search stub, nav with real counts, embedded project list with real per-project counts, footer) ✓ Tasks 2-3. Persistent header (kicker/heading per screen, Agent button stub) ✓ Task 4. Integration preserving existing polling/notification/badge behavior ✓ Task 5. The one documented, intentional deviation (Projects kicker shows a count instead of "N active" until Phase 5 adds `Project.status`) is called out in Global Constraints, not silently done.
- No placeholders: every step has literal code. The three stub buttons (search, Agent, gear) have literal empty `action: {}` closures, not TODOs — they are real, intentionally inert UI elements this phase's design calls for, wired up in later phases.
- Type consistency: `Sidebar`'s and `AppHeader`'s initializer signatures declared in Tasks 3-4's "Interfaces" sections are used identically in Task 5's integration code.
- Testing convention: matches the existing codebase's boundary — Models/ViewModels/Networking/pure-logic-helpers get unit tests; View structs (`Sidebar`, `AppHeader`, `ContentView`) do not, verified instead by build success plus (for Task 5) a full test-suite run confirming no regressions in what already had tests.
