## 1. Engine client and query layer

- [x] 1.1 Replace the Rust `engine_get` allowlist with one command per verb
      (`engine_get`, `engine_post`, `engine_patch`, `engine_put`), each taking a path and
      optional JSON body, so the frontend cannot turn a read into a write
- [x] 1.2 Add `engine_delete` for `DELETE /todos/:id`, and confirm against
      `engine/src/api/routes/` that no other verb is used anywhere
- [x] 1.3 Extend the Vite dev proxy to forward request bodies and non-GET methods, so
      mutations are exercisable in Chrome as well as in the app
- [x] 1.4 Add TanStack Query with query keys mirroring the engine's paths, plus one
      `useEngineQuery` / `useEngineMutation` pair so screens never import the client
      directly
- [x] 1.5 Port the error surface from `EngineDownBanner.swift`: an unreachable engine says
      so plainly instead of rendering empty lists
- [x] 1.6 Verify: every existing screen still renders and `#tokens` still reports 35/35

## 2. Diff parsing and pull request detail

- [x] 2.1 Port `PrDetailLogic.diffLines` with its counter handling, and unit test the
      `\ No newline at end of file` marker emitting no line and moving neither counter
- [x] 2.2 Port `hunkStarts` and unit test `@@ -14,3 +14,4 @@ trailing context`, plus
      single-line hunks where the count is omitted
- [x] 2.3 Port `PrDetailLogic.sections` and unit test that a `LEFT`-side thread never
      matches a new-file line number and lands in `trailingThreads` instead
- [x] 2.4 Port `missingPatchNote`'s three distinct cases: renamed with no churn, binary or
      empty, and too large
- [x] 2.5 Port `DiffView.swift`, the raw prefix-coloured renderer, sharing the same three
      colour tokens so the two renderers cannot drift
- [x] 2.6 Port `PrFileSectionView`: collapsible per-file header, both 44px gutters, churn,
      and injected thread content
- [x] 2.7 Port `PrDetailScreen.swift`, the largest file in the app at 563 lines: facts
      header, tab counts, files and conversation tabs
- [x] 2.8 Port `PrReviewLogic` and the review findings display
- [x] 2.9 Wire the read-only parts against a real pull request and prove the gutters and
      row heights with the fidelity harness

## 3. Mutations on the two existing screens

- [x] 3.1 Today: toggle done, cycle priority, quick-add, delete with its context menu, and
      promote, each refetching the way its ViewModel does
- [x] 3.2 Today: the checkbox routing from `TaskRow` where a pinned row's checkbox unpins
      rather than completes
- [x] 3.3 Pull requests: pin toggle and the background review action with its
      `startedReviewIds` disable-and-release behaviour
- [x] 3.4 Pull request detail: revision messages and review comment replies
- [x] 3.5 Merge, last and behind an explicit click, with nothing automatic reaching it
- [x] 3.6 Verify each mutation against the live engine and confirm the SwiftUI app sees
      the same result

## 4. The remaining list screens

- [ ] 4.1 Port `ProjectsLogic` including `relativeTime` and `isOpenTask`, with unit tests
- [ ] 4.2 Port `ProjectsScreen.swift` and its cards
- [ ] 4.3 Port `ProjectDetailScreen.swift` and `ProjectDetailLogic`, including the
      debounced save and the in-flight write rules its ViewModel comments describe
- [ ] 4.4 Port `ProjectFormSheet.swift` and `ProjectDraft`
- [ ] 4.5 Port `JiraScreen.swift` and `JiraLogic`, including the split-by-status behaviour
- [ ] 4.6 Sidebar project selection and per-project counts against the real project list

## 5. Agent chat panel

- [ ] 5.1 Port `AgentChatLogic` and the chat target routing across todo, ticket, project
      and pull request
- [ ] 5.2 Port `AgentChatPanel.swift`, the slide-over on the sidebar's raised tone
- [ ] 5.3 Send a message and poll for the reply, matching how the app waits on a headless
      Claude session rather than assuming a fast response

## 6. Commands, palette and shortcuts

- [ ] 6.1 Port `CommandPalette.swift` and `CommandPaletteLogic`
- [ ] 6.2 Port `AppCommands.swift`: Cmd-K, Cmd-1 to Cmd-4 and Cmd-J, as a Tauri menu plus
      in-window key handling
- [ ] 6.3 Confirm the shortcuts do not fire while a text field has focus

## 7. Settings and the engine lifecycle

- [ ] 7.1 Add the Rust keychain **write** and delete commands, separate from the read
- [ ] 7.2 Port `SettingsSheet.swift` and `SettingsViewModel`, including the Jira
      connection flow
- [ ] 7.3 Promote the launchd probe into a real feature: install, remove, start and the
      state reporting from `EngineAgentInstaller`, against the real label and port 4173
- [ ] 7.4 Port the refusal ordering so a rejected install leaves the machine unchanged,
      with tests behind an environment seam like `AgentEnvironment`
- [ ] 7.5 Add the folder picker for the engine directory via the Tauri dialog plugin
- [ ] 7.6 Handle the `bootout` race the spike found: do not report loaded state straight
      after a bootout

## 8. Native surface

- [ ] 8.1 Notifications via the Tauri notification plugin, matching
      `ReviewNotificationLogic` and the newly-appeared rules
- [ ] 8.2 Tray badge from the live `needsInput` count, already working, plus the click
      behaviour that focuses the window
- [ ] 8.3 Clipboard via the Tauri clipboard plugin, replacing `NSPasteboard`
- [ ] 8.4 Expose the account name from Rust, replacing the spike's hard-coded constant for
      `ProcessInfo.processInfo.fullUserName`
- [ ] 8.5 Export any SF Symbols the remaining screens need, extending
      `tools/export-ui-symbols.swift`

## 9. Tests

- [ ] 9.1 Vitest for every ported pure module: diff parsing, today sections, PR filters,
      refs, labels, relative time, project logic
- [ ] 9.2 React Testing Library for the components whose behaviour is worth asserting,
      guided by which of the 39 Swift test files exist and what they cover
- [ ] 9.3 Rust tests for the keychain, plist generation and toolchain resolution behind
      the environment seam
- [ ] 9.4 Compare coverage against the Swift test files and record, per file, what is
      covered and what is deliberately not

## 10. Packaging and handover

- [ ] 10.1 Real bundle identity: name, identifier, version, and icons from the app's own
      asset rather than the Tauri default
- [ ] 10.2 Code signing and notarisation, noting that `.dmg` bundling needs Finder
      automation which this machine does not grant
- [ ] 10.3 Final fidelity and parity pass, screen by screen, against the SwiftUI app
- [ ] 10.4 Measure the finished client the way the spike did: lines, bundle, memory, and
      record how the estimate held up
- [ ] 10.5 Write the parity report and put the question of retiring `app/` to the user as
      a decision, not an assumption
