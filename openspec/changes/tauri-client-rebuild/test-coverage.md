# Test coverage, Swift against the port

Task 9.4. Per Swift test file: where its coverage went, and what is deliberately not
covered.

Counts are `@Test` declarations on the Swift side and assertion blocks on the port's side.
They are not comparable one to one, and are here to show where the weight sits rather than
to be added up.

**Totals: 457 Swift tests, against 230 vitest and 18 Rust.**

Counted rather than added up by hand, so it can be checked:

```
grep -rho "@Test" app/WorkbenchTests/ | wc -l      # 457
cd client && pnpm test                             # 230
cd client/src-tauri && cargo test --lib            # 18
```

The gap is almost entirely one thing, and it is the thing the port set out to remove: 100
of those Swift tests exist to check hand-written `Codable` structs and the `URLSession`
calls around them. The port has no such structs. It imports the engine's own types, so
there is nothing to drift and nothing to test.

## Pure logic

Ported one for one. This is where a port's bugs are silent, so it is where the tests are.

| Swift | Port | Notes |
| --- | --- | --- |
| `Views/TodayLogicTests` (27) | `logic.test.ts` (60, shared) | sections, rails, priority, refs |
| `Views/PRsLogicTests` (20) | `logic.test.ts` | filters, the draft rule, relative time |
| `Views/SidebarLogicTests` (12) | `logic.test.ts` | counts, dots, initials |
| `Views/WorkItemLabelsTests` (17) | `logic.test.ts` | every status label |
| `Views/AppHeaderLogicTests` (9) | `logic.test.ts` | kickers, the date string |
| `Views/SidebarSectionTests` (3) | `logic.test.ts` | section order and symbols |
| `Views/PrDetailLogicTests` (22) | `prDetailLogic.test.ts` (23) | diff parsing, hunks, thread anchoring |
| `Views/PrReviewLogicTests` (10) | `prReviewLogic.test.ts` (15) | plus the review button's release rule |
| `Views/JiraLogicTests` (25) | `jiraLogic.test.ts` (15) | grouping, status split, sorting |
| `Views/ProjectsLogicTests` (13) | `projectsLogic.test.ts` (15) | cards, activity, open counts |
| `Views/ProjectDetailLogicTests` (10) | `projectsLogic.test.ts` | task rows, facts, open work |
| `Views/AgentChatLogicTests` (21) | `agentChatLogic.test.ts` (18) | subjects, target routing, `canMerge` |
| `Views/CommandPaletteLogicTests` (13) | `commandPaletteLogic.test.ts` (11) | results, matching, clamping |
| `Views/ReviewNotificationLogicTests` (8) | `notificationLogic.test.ts` (13) | plus the newly-appeared rules |

`Views/ThemeTests` (11) has no counterpart here. Its job is checking that the token values
are what the handoff says, and the port answers that question differently and better: the
`#tokens` page renders all 35 and `tokenCheck.ts` measures them in the browser, which
catches a CSS variable that resolves wrongly as well as one that is written wrongly.

## View models

The Swift's view models became the query layer plus a little component state, so their
tests landed in three different places.

| Swift | Port | Notes |
| --- | --- | --- |
| `ViewModels/ProjectDetailViewModelTests` (18) | `projectNotesSaver.test.ts` (12) | the debounce and the write chaining, kept as a class for exactly this |
| `ViewModels/PrReviewViewModelTests` (17) | `prReviewLogic.test.ts` | `shouldReleaseReview` carries the state machine |
| `ViewModels/AgentChatViewModelTests` (21) | `agentChatLogic.test.ts` | the target routing; the load token became a React key |
| `ViewModels/SettingsViewModelTests` (12) | `settingsStore.test.ts` (4) | only the parts that are still ours; the Jira flow is the engine's |
| `ViewModels/TodayViewModelTests` (14) | `TaskRow.test.tsx` (10) | the checkbox routing and the delete gating |
| `ViewModels/PrDetailViewModelTests` (9) | not covered | see below |
| `ViewModels/JiraViewModelTests` (8) | `jiraLogic.test.ts` | the rows; the busy id is component state |
| `ViewModels/ProjectsViewModelTests` (6) | `projectsLogic.test.ts` | |
| `ViewModels/RefreshViewModelTests` (4) | not covered | there is no refresh view model; the query layer's `invalidateQueries` replaced it |
| `ViewModels/PRsViewModelTests` (2) | `logic.test.ts` | |
| `ViewModels/TicketsViewModelTests` (2) | not covered | a plain list fetch with no rules on it |
| `Engine/EngineViewModelTests` (11) | `launchd.rs` tests (partly) | reachability is a query error now, not a probe |

`CommandPalette.test.tsx` (10) has no Swift counterpart: SwiftUI routes the arrows and
Enter through `onMoveCommand` and `onSubmit`, so the app has nothing of its own to test
there. In a webview that routing is ours, so it is tested.

## Networking and models

Not ported, and this is the deliberate part.

| Swift | Why not |
| --- | --- |
| `Models/ModelDecodingTests` (28) | The port imports `engine/src/types.ts`. There are no hand-written structs to decode, so there is no decoding to test. This is the 247 lines of Swift `Codable` the spike identified, and the drift it prevents was already real: the engine's `Pr` gained a `title` while `TodayLogic.linkedTitle` still said a PR carries no title of its own. |
| `Networking/APIClientCoreTests` (12) | `engineClient.ts` is 80 lines with one function per verb. `engineClient.test.ts` (5) covers the one rule with teeth, reading a status out of a message, because that decides whether a 409 is reported as a conflict. |
| `Networking/APIClientTodosTests` (15), `PRsTests` (11), `TodayProjectsTests` (7), `TicketsTests` (5) | These test that a URL was built and a payload decoded. The port has one `send` and one query key table; a wrong path is a 404 in the browser, not a silent wrong answer. |
| `Networking/KeychainClientTests` (4) | `keychain.rs` has one test that reads the real login keychain, which is the only way to answer the question that matters: whether an unsigned local binary triggers an authorization prompt. A stub cannot. |

## Rust

| Area | Tests | Notes |
| --- | --- | --- |
| `launchd.rs` refusals and ordering | 8 | ports `Engine/EngineAgentInstallerTests` (16), including that a rejected install writes nothing |
| `launchd.rs` plist and PATH | 4 | ports `Engine/EngineAgentPlistTests` (14) |
| `launchd.rs` the bootout race | 2 | no Swift counterpart: the spike found it and called it a latent hazard there |
| `keychain.rs` | 1 | reads the real keychain |
| `account.rs` | 1 | reads the real account |

## Not covered, and why

- **`SystemEnvironment::resolve_toolchain`.** It runs the user's shell. The seam exists so
  everything above it is tested without one, and the real path is exercised by
  `cargo run --bin launchd_probe -- check`, which prints what it resolved.
- **`PrDetailViewModel`'s reply and merge paths.** They are mutation hooks now. The rules
  worth testing, that a failed reply keeps the text and that a refusal is read off the
  result, are one line each and are asserted by neither side.
- **The Jira connect flow past the connected state.** Four of its five branches need the
  real connection broken to reach. Recorded as a risk on the pull request rather than
  faked.
- **Notifications actually appearing.** The rules have 13 tests; that macOS draws the
  banner is not something a webview test can see.
- **Anything only the packaged app can do**: the Go menu, the tray click, the folder
  picker, the clipboard plugin. Each is a few lines over a plugin call, and each is
  unreachable in Chrome, which is where this port is verified.
