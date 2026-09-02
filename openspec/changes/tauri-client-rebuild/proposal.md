## Why

The user has decided to rebuild the app on Tauri. `tauri-client-spike` measured the
question and returned "not yet"; that verdict was read and overridden, and the reasons
are recorded in its `design.md` rather than rewritten to agree with the outcome.

So this change does not argue the case. It carries the work, and it inherits three facts
from the spike that shape it:

- **Nothing is technically blocked.** All four probes passed. The keychain read, the tray
  badge, the launchd mechanics and the token path all work from Rust, and the two ported
  screens match the SwiftUI geometry on 39 of 39 measured checks.
- **The costs are known and accepted**, not open questions: more code than the SwiftUI it
  replaces, roughly twice the memory, and SF Symbols that cannot ship off Apple platforms.
- **The largest risk is still unmeasured.** `PrDetailScreen.swift` at 563 lines and the
  two diff renderers were deliberately outside the spike. They are the first thing built
  here, before anything easier.

## What Changes

- `spike/tauri-client/` becomes `client/`. Per the spike's exit plan the prototype is
  replaced rather than grown, and its probe pages stay only while they still earn their
  place as verification harnesses.
- **The read-only rule is dropped.** The spike allowlisted five GET paths so a half-built
  prototype could not merge a pull request. A real client has to create pull requests,
  merge them, send revision messages, toggle pins, complete and delete todos, cycle
  priorities and promote issues. The engine client gains POST, PATCH and PUT, and the
  allowlist goes.
- The remaining six screens: Projects, project detail, Jira, pull request detail with both
  diff renderers, plus the agent chat panel, the command palette and the settings sheet.
- The remaining native surface: notifications, the menu bar commands and keyboard
  shortcuts, the folder picker, the clipboard, keychain **writes** for credentials, and the
  launchd installer as a real feature rather than a probe.
- A test suite. The spike shipped one Rust test as a probe harness; this needs real
  coverage of the ported logic, against the 39 Swift test files that cover it today.
- Packaging: bundle identity, icons, signing and notarisation.
- **The SwiftUI app stays untouched and stays the one you use** until this is at parity.
  Nothing in `app/` or `engine/` is edited by this change.

## Capabilities

### New Capabilities

None. This change sets `skip_specs: true`.

Workbench's behaviour does not change: same features, same engine, same screens, same
rules. This is a reimplementation in a different toolkit, and the SwiftUI app plus the
engine's API are the specification. Writing capability specs here would mean transcribing
32 view files and 10 view models into prose, which would be a slower and less precise
description of the behaviour than the Swift already is.

Where a rule is genuinely subtle, the port copies the Swift comment that explains it
rather than paraphrasing it. That is the spike's practice and it caught real drift.

### Modified Capabilities

None. `openspec/specs/` is empty.

## Impact

**New**
- `client/`, self-contained: `src/` (React and TypeScript), `src-tauri/` (Rust),
  `tools/` (the Swift exporters and the launchd stand-in).

**Not affected**
- `app/` and its 113 tracked files. It keeps working and stays the primary client until
  this reaches parity.
- `engine/`, its API, its port, its token and its installed LaunchAgent.

**Risk**
- **The diff renderers are unmeasured**, which is why they are task group 1. If they do
  not come out well, that is worth knowing in days rather than in week five.
- **Mutations are now reachable.** `POST /prs/:id/merge` is a real button in this client.
  Until the client is trusted, merge stays behind the same explicit click the Swift app
  requires, and nothing merges on a timer or a poll.
- **Two clients against one engine** while this is built. Both hold the same bearer token
  and both poll; the engine has no per-client state, so this is safe but it does double
  the polling traffic.
- **Parity is the bar, and parity is unglamorous.** Hover states, context menus, keyboard
  focus order and error alerts are most of what is left after the screens look right, and
  they are what the spike's 1632-versus-1470 line count did not include.
