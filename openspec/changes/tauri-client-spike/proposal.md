## Why

The 8-phase redesign has just landed on main, and the question came up of what it
would cost to rebuild the app on [Tauri](https://tauri.app/). Measured against the
repository the answer is 23 to 30 working days, so 5 to 6 weeks solo, or roughly
14k to 26k euro contracted out. That is far too large to commit to on a hunch.

The estimate is also lopsided. The UI half is nearly risk-free: `Theme.swift` is a
hand-rolled Nocturne palette with bundled Inter faces, no `NavigationSplitView`, no
vibrancy and no native materials, and the API is plain REST polling with no
streaming, so CSS and `fetch` reproduce it with no unknowns. All of the real
uncertainty sits in three small native pieces that move from Swift to Rust: the menu
bar badge icon, the Keychain token read, and the launchd installer. Those are about
480 lines of Swift out of 7,975.

So the sensible next step is 3 to 5 days spent proving the three uncertain pieces,
rather than 5 weeks spent discovering them.

There are three honest reasons this is worth asking at all, and the spike should be
judged against them rather than against novelty:

1. **The verification loop.** `CLAUDE.md` requires UI changes to be proven in a real
   browser with `agent-browser`, and that is impossible against SwiftUI on this
   machine, because screen recording and assistive access are not granted. Manual UI
   testing has already caught two bugs in this app that code review and mocks missed.
   A Tauri client is drivable over CDP.
2. **A non-Mac client later**, which SwiftUI rules out entirely.
3. **Not writing Swift**, with the engine already being TypeScript.

## What Changes

- A new throwaway prototype at `spike/tauri-client/`: Tauri v2, React, TypeScript and
  Vite. It is not wired into any existing build, script or CI, and nothing else in the
  repository imports from it.
- Two screens built against the live engine on `127.0.0.1:4173`: **Today** and
  **Pull requests**, list level only. They are the two that between them exercise the
  sidebar, the shared row and label components, polling, and the badge count, which is
  what makes them the useful pair.
- Three native probes, each of which passes or fails on its own:
  - the menu bar tray icon with the red unread badge drawn onto it,
  - reading the engine's bearer token out of the login Keychain,
  - installing and removing the launchd LaunchAgent that keeps the engine alive.
- Types are imported from `engine/src/types.ts` rather than redeclared, which is one of
  the claimed wins and should be verified rather than assumed.
- A written verdict at the end of the spike, with numbers: lines written per screen,
  days actually spent, bundle size, resident memory against the Swift app, cold start,
  and pass or fail per probe.
- **Nothing in `app/` or `engine/` is touched.** No dependency is added to
  `engine/package.json`. The SwiftUI app stays the primary client throughout and keeps
  working the whole time.
- An explicit exit: if the verdict is no, `spike/tauri-client/` is deleted and the
  change is archived with the verdict kept. A spike with no way to end in a deletion
  is not a spike.

## Capabilities

### New Capabilities

None. This change sets `skip_specs: true`.

Workbench's behaviour does not change: the user still runs the SwiftUI app, against
the same engine, with the same features. The prototype is a decision aid that is
either deleted or replaced by a real change, so writing a `tauri-client` capability
spec now would put requirements for a throwaway into the main specs. If the verdict is
yes, the follow-up change owns those specs properly. Inventing a requirement here just
to satisfy `openspec validate` would be the wrong record.

The spike's own pass conditions are not product requirements, so they live in
`tasks.md` as checks, and the decision itself lands in `design.md`.

### Modified Capabilities

None. `openspec/specs/` is currently empty, so there is nothing to delta.

## Impact

**New**
- `spike/tauri-client/`, self-contained: `src-tauri/` (Rust), `src/` (React), its own
  `package.json` and lockfile.
- `.gitignore` needs `spike/tauri-client/target/`, which is large.

**On this machine**
- The Rust toolchain via `rustup`, plus a `target/` directory that reaches several GB.
  This is a real cost of the spike even if the verdict is no.

**Not affected**
- `app/` and everything in it. The Xcode project, `project.yml` and the 39 Swift test
  files stay as they are.
- `engine/`, its API, its port, its token and its launchd plist. The prototype is a
  second reader of an API that already exists, which is exactly the extension the
  README says the client split was designed to allow.
- The installed LaunchAgent. The launchd probe must use a **different label and port**
  so it cannot fight the real agent for port 4173.

**Risk**
- The Rust learning curve is the thing most likely to eat the timebox. The mitigation
  is ordering: the three probes come before the two screens, because the screens are
  the part already known to be low risk. If day 3 arrives with no working probes, that
  is itself the answer.
- `KeychainClient.swift` already records that reading a Keychain item from a locally
  built binary makes macOS ask for authorization on every rebuild, which once hung a
  test run. An unsigned Tauri dev binary will hit the same wall or a worse one, so
  "does this prompt on every `cargo run`" is a pass condition, not a footnote.
- Tauri's tray takes raw image bytes, so the badge that `MenuBarIconRenderer` gets from
  18 lines of `NSBezierPath` has to be drawn by hand. It may also lose the template
  image behaviour that currently adapts the idle icon to light and dark menu bars.
- A spike that goes well is tempting to keep and grow. The deletion clause above is
  there to make that a decision instead of a drift.
