# Tasks

Read `specs/engine-lifecycle/spec.md` for the contract and `design.md` for the decisions, especially why the plist runs a login shell.

Standing constraints for every task:

- **No changes under `engine/`.** This change is app code plus a plist. If a task seems to need an engine change, stop and say so.
- App tests: from `app/`, `xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests -parallel-testing-enabled NO`, redirected to a file, verdict grepped. Never backgrounded, never polled. `-parallel-testing-enabled NO` is mandatory. It sometimes exceeds 120 seconds.
- Real compile errors match `\.swift:[0-9]+:[0-9]+: error:`; the log also carries unrelated `linkd` noise.
- Run `xcodegen generate` from `app/` after adding any `.swift` file.
- Dutch commit messages, Conventional Commits, one line. No Claude trailer.
- TDD: the failing test first, observed failing, before the implementation.
- **Never install the agent as a side effect of a test.** Every test drives the pure logic or an injected fake. A test that writes to `~/Library/LaunchAgents` or runs `launchctl` is a defect in the test.

## 1. The plist and the paths, as pure logic

The whole point of this task is that the fiddly parts, the shell invocation and the plist contents, are testable without touching the filesystem or launchd.

- [x] 1.1 Write failing tests for a pure plist builder: given an engine directory it produces a plist whose program is `/bin/zsh` with `-lc` and a command that `cd`s to that directory and `exec pnpm start`; whose label is `nl.linku.workbench.engine`; which has `RunAtLoad` true; whose `KeepAlive` is a dictionary with `SuccessfulExit` false and **not** the boolean `true`; and which sends stdout and stderr to a path under the user's Logs directory. Assert `exec` is present, because without it launchd supervises the shell instead of the engine.
- [x] 1.2 Write failing tests for the directory validator: a directory containing the engine's `package.json` is valid; one without it is not; a path that does not exist is not.
- [x] 1.3 Implement the plist builder and the validator as a pure type with no filesystem or process access, and confirm the tests pass.
- [x] 1.4 Run the whole app suite. Commit.

## 2. Installing and removing, behind a seam

- [x] 2.1 Write failing tests for an install and remove coordinator against injected fakes for the filesystem, the process runner and the port check. Cover: install writes the plist then bootstraps it; install is refused when no directory is chosen; refused when the directory is invalid; **refused when the port is already in use, and in that case nothing is written and nothing is run**; remove boots out then deletes the plist; remove succeeds when the process is already gone; a non-zero exit from the runner surfaces as a failure with its message rather than being swallowed.
- [x] 2.2 Implement the coordinator with the seams the tests inject, using `launchctl bootstrap` and `bootout` against the user's GUI domain. Confirm the tests pass.
- [x] 2.3 Run the whole app suite. Commit.

## 3. Reachability

- [x] 3.1 Write failing tests for the reachability rule: a transport-level failure means unreachable; any server-side error means reachable, because the engine answered; a success means reachable. Use the existing `APIError` cases, and assert that `serverError` and `unauthorized` are **not** treated as the engine being down.
- [x] 3.2 Write failing tests for the observable engine state: it starts unknown, becomes unreachable after a transport failure, becomes reachable after a success, and stops polling when asked.
- [x] 3.3 Implement the reachability check and the observable state. Poll every 30 seconds while a window is open. Confirm the tests pass.
- [x] 3.4 Run the whole app suite. Commit.

## 4. The user interface

No tests here: it is view wiring, and every rule it follows is tested above. Manual verification covers it.

- [x] 4.1 Add an Engine section to the Settings sheet: the chosen directory with a folder picker, using the same `NSOpenPanel` approach `ProjectFormSheet` already uses for repository paths; whether an agent is installed; the live reachability; an Install or Remove control; and the log file path so a failure is diagnosable. Show the refusal reasons from task 2 inline.
- [x] 4.2 Show a banner in the app shell whenever the engine is unreachable, visible from every screen, saying the engine is not reachable and offering to start it when an agent is installed or pointing at Engine settings when not. It must disappear on its own once the engine answers.
- [x] 4.3 Start the reachability polling when the app launches, and stop it when the last window closes.
- [x] 4.4 Run `xcodegen generate`, build, and run the whole app suite. Commit.

## 4b. Correcting how launchd starts the engine

The shell wrapper failed three separate times under launchd. See design.md for the full
sequence and why the third failure ruled the whole approach out.

- [x] 4b.1 Reproduce each failure in launchd's own environment rather than in a terminal that already has a working PATH: `-lc` gives Homebrew node v26 and `ERR_DLOPEN_FAILED`; `-ic` gives no pnpm and exit code 127, with `.zshrc` dying on `pyenv` before it finishes building PATH; `-lic` resolves both tools but lands on a `vp` shim that hangs headless, with the job reporting `state = running` while nothing listens and nothing is logged.
- [x] 4b.2 Add `EngineToolchain` and a `resolveToolchain` seam that asks the user's shell once for `process.execPath` and `command -v pnpm`, capturing stdout only so that dotfile noise on stderr cannot corrupt the captured paths.
- [x] 4b.3 Rewrite the plist to run the real node binary directly on the pnpm script with an explicit PATH and `WorkingDirectory`, and no shell. Update the plist tests to assert the new shape and to guard against `/bin/zsh` ever coming back.
- [x] 4b.4 Refuse to install when the toolchain cannot be resolved, before anything is written or run.
- [x] 4b.5 Prove the new plist under real launchd rather than by simulation: bootstrap it, confirm the engine answers on 4173 and that the job stays up without restarting.
- [x] 4b.6 Run the whole app suite serially. 396 tests in 26 suites passed.
- [x] 4b.7 Fix `KeepAlive`, which never fired. `["SuccessfulExit": false]` cannot work here because pnpm traps SIGTERM and exits 0, so a killed engine was recorded as a clean shutdown and left dead. Changed to blanket `true` and verified under launchd both ways: a killed engine comes back with a new pid, and a bootout still stops it for good.

## 5. Verify for real

Only a human can do these, and the first two are the ones that would embarrass us if skipped.

- [ ] 5.1 With no engine running, open the app. The banner appears and the Jira screen does not simply look empty. This is the failure that wasted time before this change existed.
- [ ] 5.2 Install the agent from Settings. The engine starts, the banner clears within a minute, and the Jira screen fills. **Then quit the app entirely and confirm the engine is still running** - that is the difference between this change and merely spawning a child process.
- [x] 5.3 Kill the engine process by hand. Confirm launchd restarts it and the banner clears on its own. This is the behaviour the whole change exists for. Verified: the first attempt did not restart at all, which is what exposed the `KeepAlive` bug in 4b.7. After the fix, killing the engine brings it back with a new pid and `runs` incrementing. The banner clearing is still worth a look in the UI.
- [ ] 5.4 Log out and back in, and confirm the engine is running before the app is opened.
- [ ] 5.5 Try to install while a hand-started engine holds the port. Confirm it is refused with a clear reason and that no plist is written.
- [ ] 5.6 Remove the agent. Confirm the engine stops, nothing restarts it, and `~/Library/LaunchAgents` no longer holds the plist.
- [x] 5.7 Check the log file has the engine's output in it, so a future failure is diagnosable. Verified: it holds `Workbench engine listening on http://localhost:4173` once per start, and it is what diagnosed all three shell failures.
