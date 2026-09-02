## Why

The engine is a separate Node process the user has to start by hand, and nothing keeps it alive. Over one working session it stopped four times, and each time the app kept running but showed empty screens with no explanation, because a Jira or PR list with no engine behind it looks exactly like a list with no data in it. The user asked for the app to start the engine; the deeper problem is that nothing restarts it.

## What Changes

- The app can install a launchd LaunchAgent that starts the engine at login, restarts it if it exits, and keeps running when the app quits. This is what actually fixes the recurring outage, rather than moving who presses start.
- A new Engine section in the Settings sheet: the engine directory, an install and remove control for the agent, and whether the engine is currently reachable.
- The app tells the user plainly when the engine is unreachable, instead of rendering empty screens. The message offers to start the engine.
- The engine directory is chosen once with a folder picker and remembered, because the app is built into DerivedData and has no reliable relationship to the repository it was built from.
- **No engine changes.** Nothing in `engine/` is touched: this is app code plus a plist written into the user's home directory.

## Capabilities

### New Capabilities

- `engine-lifecycle`: the app can install, remove and observe a managed engine process, and reports plainly when the engine is unreachable.

### Modified Capabilities

None. The only existing capability spec is `jira-issue-status`, whose requirements are unaffected.

## Impact

**App**
- `app/Workbench/AppDelegate.swift` or a new lifecycle type: reachability checking on launch and while running.
- A new engine-lifecycle module: discover the interpreter, write the plist, load and unload it with `launchctl`, report state.
- `app/Workbench/Views/SettingsSheet.swift`: an Engine section beside the Jira one.
- `app/Workbench/ViewModels/SettingsViewModel.swift`: engine state alongside the Jira connection.
- `app/Workbench/Views/ContentView.swift`: the unreachable banner.
- Somewhere to remember the engine directory. `UserDefaults`, not the Keychain: a path is not a secret.

**Outside the repository**
- Writes `~/Library/LaunchAgents/nl.linku.workbench.engine.plist`.
- Writes engine stdout and stderr to a log file under `~/Library/Logs/`, so a failure to start is diagnosable.

**Not affected**
- The engine itself, its API, its port, and how the app authenticates to it.
- Anything about which data the app fetches.

**Risk**
- A GUI application inherits a minimal `PATH`, so it can find neither `pnpm` at `/opt/homebrew/bin/pnpm` nor `node` at `/Users/wahidlinku/.vite-plus/bin/node`. Any naive spawn fails with "command not found". The design has to solve this explicitly.
- launchd's `KeepAlive` plus a port already in use produces an endless restart loop. Installing while a hand-started engine holds port 4173 must be refused rather than attempted.
- The plist embeds an absolute path. Moving or deleting the checkout leaves an agent that fails on every attempt.
