## 1. Setup

- [x] 1.1 Install the Rust toolchain with `rustup`, then confirm `cargo --version` and
      note the total size of `~/.cargo` and `~/.rustup` for the cost record
- [x] 1.2 Scaffold `spike/tauri-client/` with Tauri v2, React, TypeScript and Vite, and
      confirm `pnpm tauri dev` opens a window showing the default page
- [x] 1.3 Add `spike/tauri-client/target/` and `spike/tauri-client/node_modules/` to
      `.gitignore`, then confirm `git status` stays clean after a debug build
- [x] 1.4 Confirm nothing outside the spike directory changed: `git status` shows no
      modifications under `app/` or `engine/`
- [x] 1.5 Port `Theme.swift` to CSS custom properties (the Nocturne ramps, `Space`,
      `Radius`, `FontSize`) and load the Inter faces already in
      `app/Workbench/Resources/Fonts`, then render a swatch page and check three hex
      values against `Theme.swift` with the browser's computed styles

## 2. Probe 1: the verification loop

- [x] 2.1 Start the Vite dev server and drive the swatch page from task 1.5 with
      `agent-browser`: `set viewport`, `open`, `snapshot -i`, `screenshot`
- [x] 2.2 Read a real measurement out of the page with `eval --stdin` and a
      `getBoundingClientRect()` sample, proving the loop returns numbers and not just
      images
- [x] 2.3 Try the same against the running Tauri window, expect it to fail, and record
      what the failure looks like so the limit is documented rather than assumed
- [x] 2.4 Write the probe 1 result: pass or fail, plus the exact boundary between what
      is drivable and what is not

## 3. Probe 2: the Keychain token read

- [x] 3.1 Add a Rust command that runs
      `security find-generic-password -s workbench -a api-token -w` and returns the
      trimmed token, mirroring `engine/src/keychain.ts`
- [x] 3.2 Call one authenticated GET endpoint with that token and confirm the engine
      answers 200 rather than 401
- [x] 3.3 Rebuild the binary five times and record whether macOS prompts for
      authorization on any of them, which is the failure mode
      `KeychainClient.swift` documents for the native API
- [x] 3.4 Confirm the prototype never writes to the Keychain: grep the Rust and TS
      sources for `add-generic-password` and `delete-generic-password` and expect no
      hits
- [x] 3.5 Write the probe 2 result, including the prompt behaviour and how it compares
      to the Swift app's

## 4. Probe 3: the tray badge

- [x] 4.1 Create a bundled base icon to stand in for the SF Symbol
      `checkmark.circle`, at the sizes the tray needs
- [x] 4.2 Draw the badge in a canvas in the webview (red disc, white bold count, "9+"
      above nine) and hand the RGBA bytes to a Rust command that sets the tray icon
- [x] 4.3 Show the tray icon at counts 0, 1, 9 and 12, screenshot each, and compare
      against the Swift app's icon at the same counts
- [x] 4.4 Check the idle icon in both a light and a dark menu bar and record whether
      the template image adaptation survived
- [x] 4.5 Write the probe 3 result, listing every fidelity loss found rather than
      fixing them

## 5. Probe 4: the launchd mechanics

- [x] 5.1 Run `zsh -lic` from Rust to resolve node via
      `node -e 'process.stdout.write(process.execPath)'`, plus `command -v pnpm` and
      `command -v claude`, and confirm all three paths match what
      `SystemAgentEnvironment.resolveToolchain` returns today
- [x] 5.2 Serialize the plist dictionary from `EngineAgent.plist`, unchanged except for
      label, port and log path, using the `plist` crate, and diff the output against
      the installed `nl.linku.workbench.engine.plist`
- [x] 5.3 Bind-test port 4174 from Rust before writing anything, matching the refusal
      that `isPortInUse` implements, and confirm it refuses while something holds the
      port
- [x] 5.4 Write the plist as `nl.linku.workbench.spike-engine`, `bootstrap` it, and
      confirm with `launchctl print` that the job is loaded and the engine answers on
      4174
- [x] 5.5 Confirm the real agent is untouched: `launchctl print` for
      `nl.linku.workbench.engine` still reports it loaded, and the engine still answers
      on 4173
- [x] 5.6 `bootout` the spike job, delete its plist, and confirm `launchctl print`
      reports it gone
- [x] 5.7 Write the probe 4 result, including how many lines of Rust the five mechanics
      took against the 373 lines of Swift they replace

## 6. Checkpoint

- [x] 6.1 Stop and count the days spent. If probes are still failing at day 3, write
      the verdict now and skip sections 7 and 8 entirely
- [x] 6.2 Report the four probe results to the user and confirm whether to continue to
      the screens

## 7. The two screens

- [x] 7.1 Import the types the two screens need directly from `engine/src/types.ts` and
      confirm `tsc --noEmit` passes with no redeclared model, which is the claim under
      test
- [x] 7.2 Build the API client against `127.0.0.1:4173` with the token from probe 2,
      GET endpoints only, and confirm a 401 renders an error state rather than an empty
      list
- [x] 7.3 Build the sidebar and app header from `Sidebar.swift` and `AppHeader.swift`
- [x] 7.4 Build the Today screen from `TodayScreen.swift`, `TodayLogic.swift` and
      `TaskRow.swift`, against live data
- [x] 7.5 Build the Pull requests screen from `PRsScreen.swift`, `PRsLogic.swift` and
      `WorkItemLabels.swift`, against live data
- [x] 7.6 Add the polling interval and the badge count feed, and confirm the tray badge
      from probe 3 changes when the engine's counts change
- [x] 7.7 Prove fidelity with `agent-browser` rather than by eye: sample row heights,
      sidebar width and the four spacing steps, and compare against the same
      measurements taken from `Theme.Space`

## 8. Measure

- [x] 8.1 Count lines: `wc -l` over `spike/tauri-client/src` and `src-tauri/src`,
      against the Swift files each part replaces
- [x] 8.2 Build a release bundle and record its size with `du -sh`, against the Swift
      `.app`
- [x] 8.3 Record resident memory with `ps` for both apps showing the same two screens
- [ ] 8.4 Time cold start for both, from launch to first painted list, three runs each
- [x] 8.5 Record the days actually spent per section, against the 3 to 5 day box

## 9. Verdict and cleanup

- [x] 9.1 Write the verdict into `design.md` under a **Verdict** heading: yes, no, or
      not yet with a named blocker, with every number from section 8 and all four probe
      results
- [x] 9.2 State explicitly in the verdict what the two screens did not exercise,
      above all the diff renderers in `PrDiffView.swift` and `DiffView.swift`
- [x] 9.3 Confirm the machine is back to its starting state: no spike LaunchAgent, no
      spike plist, no spike log file, the real engine still answering on 4173
- [x] 9.4 Confirm `git status` still shows no changes under `app/` or `engine/`, and
      that the Swift app still builds and runs
- [x] 9.5 On a no or not-yet verdict, delete `spike/tauri-client/` and note in the
      verdict that the numbers outlive the code
