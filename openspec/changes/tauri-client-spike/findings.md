# Findings

Running record for the spike. The verdict in `design.md` is built from this.

Versions in play: Tauri 2.11.5, rustc 1.98.0, React 19.2, Vite 7.3.6, pnpm 11.9.0,
node 24.20.0, macOS 25.6.0 on arm64.

## Section 1: setup

**Cost of the toolchain: 477 MB, not the several GB predicted.** `~/.rustup` is 466 MB
and `~/.cargo` is 11 MB, installed with `--profile minimal` plus rustfmt and clippy.
The proposal's several-GB figure was right about `target/` and wrong about the
toolchain: one debug build of the scaffold produced a **2.0 GB** `src-tauri/target`.
So the disk cost is real but it is almost entirely build output, which means it is
reclaimable with `cargo clean` and does not persist if the spike is deleted.

**Installed with `--no-modify-path` on purpose.** rustup's default edits a shell
profile to put `~/.cargo/bin` on PATH. `EngineAgent.plist` depends on the exact split
between `.zprofile` and `.zshrc`, and that knowledge cost real debugging time, so
letting an installer write into either file was not worth the risk. Every cargo call
in this spike carries an explicit `PATH="$HOME/.cargo/bin:$PATH"`. If the verdict is
yes, adding the line by hand is the follow-up.

**Cold Rust compile: 39.27s** for the scaffold's 347 crates on this machine. Fast
enough not to be a factor in the decision.

**pnpm 11 needed a fix the Tauri scaffold does not ship.** `create-tauri-app` leaves
esbuild's postinstall unapproved, and pnpm 11 escalates that to a fatal
dependency-status error, so `pnpm build` failed with `ERR_PNPM_IGNORED_BUILDS` before
vite ever ran. The setting has also moved twice: not a `pnpm` field in
`package.json` (pnpm ignores it and says so), and not `onlyBuiltDependencies` either.
pnpm rewrote the file itself to reveal the current key, and the fix is a
`pnpm-workspace.yaml` with `allowBuilds: {esbuild: true}`. Cost about 10 minutes.
Worth noting only because it is the kind of friction that does not appear in any
Tauri guide.

**Task 1.3 needed no root `.gitignore` change, so none was made.** The scaffold ships
its own nested ignores, `spike/tauri-client/.gitignore` for `node_modules` and `dist`
and `src-tauri/.gitignore` for `/target/`, and git honours them. Verified rather than
assumed: after a full debug build, `git status --untracked-files=all -- spike` lists
44 files and **zero** of them are under `target/` or `node_modules/`. Adding duplicate
root entries would have been redundant, and they would have outlived a deleted spike.

**Task 1.4 holds.** `git status` shows changes only under `spike/`,
`openspec/changes/tauri-client-spike/` and the pre-existing untracked `.claude/`.
Nothing under `app/` or `engine/`.

**The token port is exact, with one measured caveat.** All 35 checks pass: 19 colours
by computed `backgroundColor`, 6 space steps by measured width, 3 radii, 7 font sizes,
plus both Inter faces confirmed loaded at weights 500 and 400 rather than falling back
to the system font. The check lives in the page (`src/tokenCheck.ts`, read with
`agent-browser get text "#token-check"`) rather than in a throwaway snippet, because
this session's sandbox refuses `agent-browser eval` and because a check that ships
with the page can be re-run at any time.

The caveat is worth recording: **CSS cannot hold SwiftUI's fractional points exactly.**
`Theme.Space` uses 2.8, 5.6, 8.4, 11.2, 16.8 and 22.4, and Chrome lays out on a 1/64 px
LayoutUnit grid, so 11.2 renders as 716/64 = 11.1875. Every space token lands on that
grid, and the largest error across the ramp is s4's 0.0125 px. Invisible in practice,
but it means a pixel-diff against the Swift app will never be exactly zero, and anyone
running one should know that before treating it as a bug.

## Probe 1: the verification loop

**PASS, with the boundary exactly where the design predicted.**

What works, against the Vite dev server in Chrome:

- `set viewport 1280 900`, `open`, `reload` all fine.
- `snapshot -i` returns the accessibility tree with `@eN` refs.
- `screenshot` produces a real image of the rendered page.
- `get box "#swatch-accent"` returns `x: 348.765625, y: 383.515625, width: 76,
  height: 52`, so sub-pixel geometry is readable, which is what makes a spacing claim
  provable instead of asserted.
- `get text "#token-check"` reads computed-style results back out of the page.

What does not work: **the Tauri window itself is not drivable.** The app was running
(PID 17957, `target/debug/tauri-client`, its webview holding a connection to port
1420) and there is no CDP endpoint anywhere. `agent-browser connect 9222`:

```
✗ All CDP discovery methods failed for 127.0.0.1:9222 ... Connection refused (os error 61)
```

Ports 9222 and 9229 both answered nothing, and the app process opens no listening
socket at all. This is structural, not a missing flag: a Tauri window on macOS is
WKWebView, which exposes the Safari Web Inspector protocol and not CDP, and
`agent-browser` speaks CDP.

So the honest claim is narrower than "Tauri is verifiable": the **frontend** is fully
drivable in Chrome, and the **shipped window** is not. That still covers nearly all UI
work, and it is a large gain over SwiftUI, where screen recording and assistive access
are not granted on this machine and nothing is drivable at all. But anything that only
manifests inside WKWebView, and the tray and native glue in particular, still needs a
human to look at it.

**A knock-on limit found at task 1.2.** The same wall means "confirm `pnpm tauri dev`
opens a window showing the default page" cannot be fully verified here. What is
verified: the Rust side compiles, the app process runs, and its webview holds a
connection to the dev server. What is not: that pixels appeared. Screen capture is
blocked on this machine, so the window contents are unconfirmed and that gap belongs
in the verdict rather than being papered over.

**Consequence for the rest of the spike.** Because the window can be neither driven
nor photographed, the app reports probe results through Rust `println!`, which does
reach the terminal running `tauri dev`. That is the only channel that proves something
happened inside the real app process rather than in a test harness, and every
`PROBE ...` line quoted below came out of it.

## Probe 2: the Keychain token read

**PASS, and it is better in Tauri than in Swift.**

End to end from inside the running app, read out of the `tauri dev` terminal:

```
PROBE keychain PASS token_length=64
PROBE engine_get PASS /today bytes=1425
PROBE engine_get PASS /prs bytes=6270
```

64 characters is right, since `getOrCreateApiToken` generates 32 random bytes as hex.
Both engine calls returned real data, and `engine_get` turns any non-2xx into an error,
so those two lines are proof of 200 rather than 401.

**The rebuild question, which was the real risk, comes back clean.** Five forced
rebuilds, each producing a new unsigned binary, each reading the live login keychain
with stdin closed so nothing could silently answer a prompt:

```
rebuild 1 exit=0 elapsed=3s test result: ok. 1 passed
rebuild 2 exit=0 elapsed=1s test result: ok. 1 passed
rebuild 3 exit=0 elapsed=1s test result: ok. 1 passed
rebuild 4 exit=0 elapsed=1s test result: ok. 1 passed
rebuild 5 exit=0 elapsed=1s test result: ok. 1 passed
```

Every read finished in under 0.1s with no prompt and no hang. That is the opposite of
what `KeychainClient.swift` documents for the native path, where reading through
`SecItemCopyMatching` from a locally built binary asks for authorization on every
rebuild and once hung a test run. The reason is the one the design predicted: a
keychain item's ACL follows the calling binary, and shelling out means the caller macOS
sees is `/usr/bin/security`, which is stable and already trusted, not a
freshly-signed-nothing debug binary. So this is a small win for Tauri rather than a
cost. It is worth noting the same trick would work in Swift, so it is really a win for
shelling out, which Tauri makes the obvious choice and Swift makes the odd one.

**No writes.** `grep` for `add-generic-password`, `delete-generic-password`,
`SecItemAdd`, `SecItemDelete` and `SecItemUpdate` across both `src/` and
`src-tauri/src/` returns nothing.

**A finding that changes the architecture, and was not in the plan: the engine sends no
CORS headers, so the webview cannot call it directly.** A Tauri window runs on a custom
protocol, which makes `http://127.0.0.1:4173` cross-origin, and
`engine/src/api/server.ts` mounts `express.json`, the bearer check and the routes and
nothing else. Measured rather than assumed, with no token needed, because CORS
middleware would answer a 401 too:

```
$ curl -D - -H "Origin: tauri://localhost" http://127.0.0.1:4173/today
HTTP/1.1 401 Unauthorized
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
```

No `Access-Control-Allow-Origin` anywhere. So a Tauri client has to route engine
requests through Rust, either through `tauri-plugin-http` or a command, unless the
engine gains CORS, which this spike forbids. That sounds like a cost and is mostly a
benefit: doing it in Rust means the bearer token never enters the webview at all, which
is strictly better than handing it to JS. `engine_get` is the whole of it, and it
allowlists `/today` and `/prs` so the prototype cannot reach
`POST /prs/:id/merge` even by accident.

**One deviation from the design's non-goals.** `design.md` says the prototype ships no
tests. It now ships exactly one, `keychain::tests::reads_the_engine_token_without_prompting`,
because running the read across five fresh binaries is the only way to answer the prompt
question and doing that through the GUI five times would prove less. It is a probe
harness, not test coverage for the prototype, but it is a deviation and worth naming.

## Probe 3: the tray badge

**PASS on the mechanism and on the drawing. One sub-task is blocked, and one predicted
loss turned out not to be real.**

The mechanism works end to end in the real app:

```
PROBE tray PASS 36x36 template=true bytes=5184
```

Canvas draws the icon, hands 5184 raw RGBA bytes to a Rust command, and Tauri's tray
accepts them. The Rust side is 60 lines including the length check and the error
handling.

**The predicted loss that is not real: template adaptation survives.** `design.md`
expected the template behaviour "may not survive". It does. Tauri v2 exposes
`TrayIcon::set_icon_as_template`, so the port mirrors `MenuBarIconRenderer` exactly,
template only when the count is zero, and the `template=true` in the line above is that
flag being accepted. Whether the tinting then looks right in a light and a dark menu bar
is task 4.4, and that is the one thing here that cannot be checked on this machine, so
it stays open. The API is present and the flag is set; a human still has to look at it.

**The SF Symbol did not need approximating.** `design.md` assumed the base glyph would
have to become a hand-made asset because a webview canvas cannot reach SF Symbols. It
can be exported instead: `tools/export-symbol.swift` renders the real
`checkmark.circle` to PNG at 1x and 2x, and that PNG is what the canvas draws. The cost
is that the glyph stops following the system, so a macOS release that restyles the
symbol needs the script re-run. That is a real but small trade, and much smaller than
drawing a lookalike.

**Instead of screenshots, a pixel diff against the production renderer.** The menu bar
cannot be photographed here, so task 4.3's "screenshot each and compare" was replaced
with something stronger: `tools/render-swift-icons/main.swift` compiles the actual
`app/Workbench/MenuBarIconRenderer.swift` and calls it, so the reference images come
from the production code rather than from a transcription of it. The comparison then
runs in the page (`src/trayDiff.ts`, read with `agent-browser get text "#tray-diff"`):

```
TRAY DIFF vs Swift MenuBarIconRenderer at 18x18
count  0: differing=0/324  outsideBadge=0 maxDelta=7   meanDelta=0.41 alphaMismatch=0
count  1: differing=28/324 outsideBadge=0 maxDelta=255 meanDelta=1.84 alphaMismatch=11
count  9: differing=36/324 outsideBadge=0 maxDelta=255 meanDelta=2.78 alphaMismatch=11
count 12: differing=50/324 outsideBadge=0 maxDelta=255 meanDelta=4.01 alphaMismatch=13
```

The idle icon, which is what sits in the menu bar almost all of the time, is an exact
match: zero differing pixels, and a max channel delta of 7 that is PNG round-trip noise
under the 8-level tolerance. For the badged icons, `outsideBadge=0` is the important
column: every single difference is inside the 10x10 badge corner, so the glyph is not
misplaced and the geometry is not wrong. What differs is how a 7px bold glyph and a
10px disc edge get antialiased, canvas against CoreText. Mean channel delta stays under
2% of full range.

Two wrong assumptions were caught by that diff, and neither would have been caught by
reading the code:

- **The exported glyph was wrong at first.** `export-symbol.swift` originally applied
  `SymbolConfiguration(pointSize: 18, weight: .regular)`, which changes the glyph's
  metrics, while `MenuBarIconRenderer` uses no configuration at all and lets
  `draw(in:)` scale the symbol to fill 18x18. That showed up as 92 of 324 pixels
  differing at badge count 0, where nothing but the glyph exists. Removing the
  configuration took it to 0.
- **The badge red is not the documented one.** The first attempt used #FF3B30, the
  widely quoted light-appearance systemRed. Measuring what `NSColor.systemRed` actually
  resolves to in the process that renders the icon gives **rgb(255, 66, 69), #FF4245**,
  which is neither the documented light value nor the dark one (#FF453A). Correcting it
  took count 1 from 86 differing pixels to 28.

**A fidelity loss that is real and has no cheap fix: `systemRed` is dynamic.** It
resolves per appearance, so the Swift badge follows light and dark while a canvas or CSS
constant cannot. A real port would have to resolve the colour natively and pass it to
the frontend. Small, but it is the kind of thing that quietly looks wrong later.

**Two places where the port is better than the Swift app.** Worth recording because the
spike is meant to be even-handed:

- The badge text metrics agree to 0.01pt. Canvas `bold 7px -apple-system` measures
  "1", "9" and "9+" at 3.81, 5.02 and 9.95pt; AppKit's
  `NSFont.systemFont(ofSize: 7, weight: .bold)` gives 3.81, 5.01 and 9.94. Both resolve
  to the same San Francisco face, so this is a match rather than a coincidence. It also
  shows "9+" filling 9.94 of the 10pt disc, meaning the badge is at its limit in the
  original design too, not just in the port.
- The Swift renderer produces an 18x18 bitmap and nothing larger, so on a Retina menu
  bar it is upscaled. The canvas port rasterises at 36x36. The Tauri tray icon is
  therefore sharper than the one shipping today.

**Blocked: task 4.4.** Confirming the idle icon adapts in a light and a dark menu bar
needs eyes on the menu bar, and screen capture is not granted here. Left unchecked
rather than assumed.

## Probe 4: the launchd mechanics

**PASS on all five mechanics, and this was the probe expected to be hardest.**

**One adaptation to the plan, forced by the engine.** `engine/src/config.ts` hardcodes
`ENGINE_PORT = 4173` with no environment override, and the spike may not change engine
code, so "the engine answers on 4174" is impossible as written. Instead
`spike/launchd-standin/` is a tiny package whose `start` script binds 4174, launched
through the identical `node → pnpm → start` argument chain, so every mechanic under test
is unchanged. Its `server.js` also traps SIGTERM and exits 0, mirroring the pnpm
behaviour that the blanket `KeepAlive` exists to survive.

**The toolchain resolution carries over exactly.** `/bin/zsh -lic` from Rust, stderr
discarded rather than merged, last non-empty stdout line taken:

```
LAUNCHD toolchain node=/Users/wahidlinku/.vite-plus/js_runtime/node/24.20.0/bin/node
LAUNCHD toolchain pnpm=/opt/homebrew/bin/pnpm
LAUNCHD toolchain claude=/Users/wahidlinku/.local/bin/claude
```

The node path is the important one: it is the real binary inside the vite-plus runtime
directory, not the shim, so the `process.execPath` trick works from Rust exactly as it
does from Swift. That trick is what keeps the job from hanging headless, so it was the
single most likely thing to break.

**The generated plist matches the installed one byte for byte where it should.**
Diffed against the live `~/Library/LaunchAgents/nl.linku.workbench.engine.plist`:

| Key | Real (Swift) | Spike (Rust) |
|---|---|---|
| `EnvironmentVariables.PATH` | node:homebrew:claude:/usr/bin:/bin:/usr/sbin:/sbin | **identical, verified with `diff`** |
| `ProgramArguments` | node, pnpm, start | identical |
| `RunAtLoad` / `KeepAlive` | true / true | true / true |
| `Label` | `nl.linku.workbench.engine` | `.spike-engine`, on purpose |
| `WorkingDirectory` | `engine/` | `spike/launchd-standin`, on purpose |
| log paths | `workbench-engine.log` | spike log, on purpose |

The PATH string is the one most likely to drift, since it is built by deduplicating
three resolved directories in order and appending four fixed ones. `diff` on the two
extracted values reports no difference.

**The refusal fires before anything is written.** With the stand-in already holding
4174 by hand:

```
LAUNCHD install REFUSED port 4174 is already in use
$ ls ~/Library/LaunchAgents/nl.linku.workbench.spike-engine.plist
No such file or directory
```

That ordering is lifted from `EngineAgentInstaller`, and it matters for the reason its
comment gives: `KeepAlive` plus an occupied port is an endless restart loop.

**Bootstrap, run, restart, bootout all work.** After freeing the port:

```
LAUNCHD wrote /Users/wahidlinku/Library/LaunchAgents/nl.linku.workbench.spike-engine.plist
LAUNCHD bootstrap ok
LAUNCHD spike_loaded=true
$ curl 127.0.0.1:4174  ->  {"standin":true,"pid":29192}
```

Then killing the listener to test the thing the feature exists for, and the job came
back as pid 29338. The job's own log tells the whole story, including the SIGTERM that
blanket `KeepAlive` is there to survive:

```
Done in 1.1s using pnpm v11.9.0
$ node server.js
standin listening on 127.0.0.1:4174 pid=29192
standin received SIGTERM
$ node server.js
standin listening on 127.0.0.1:4174 pid=29338
```

**The real agent was never touched**, checked while the spike job was running:
`launchctl print` reports `nl.linku.workbench.engine` as `state = running`, pid 82475,
and the engine still answers 401 on 4173. After `remove`, the spike's plist and log are
gone, `launchctl print` reports `Could not find service`, and 4174 is free.

**A race worth writing down, found by accident.** `remove` printed
`spike_loaded=true plist_exists=false`, and a moment later `launchctl print` reported
the service gone. So `bootout` returns before launchd has finished removing the job from
the domain, and an immediate "is it loaded" check lies.

This is shared mechanism, not a Rust artefact, so it is worth being precise about where
it could bite the Swift app. `EngineAgentInstaller.remove()` is immune: it boots out and
then deletes the plist, and `isInstalled()` keys off the plist file, not the loaded
state. The exposed path is `start()`, which uses `isAgentLoaded()` to choose between
`kickstart` and `bootstrap`; called soon after a `bootout` it could pick `kickstart` for
a job launchd is about to forget, and fail with the "Could not find service" error that
its own comment describes guarding against. I did not reproduce that in the app, so it
is a latent hazard rather than an observed bug.

**Line counts, task 5.7, and an honest caveat (see also section 8, which repeats this
pattern).** Comments and blanks excluded:
**172 lines of Rust** against **217 lines of Swift** across `EngineAgent`,
`SystemAgentEnvironment` and `EngineAgentInstaller` (373 and 222 with comments). The
Rust is not smaller because Rust is more concise. It is smaller because it does less:
no `LocalizedError` enum with user-facing messages, and no `AgentEnvironment` protocol
seam, which is what lets the Swift rules be unit-tested without installing anything on
the test machine. A real port would need both, so expect this to land at parity rather
than as a saving.

## Section 7: the two screens

Both screens run against the live engine and match the SwiftUI geometry exactly.

**Task 7.1, the types claim, holds completely.** `tsc --noEmit` passes with the models
imported straight from the engine:

```ts
import type { Pr, Project, Ticket, Todo } from '../../../engine/src/types.ts'
import type { TodayView } from '../../../engine/src/todos.ts'
```

Zero models redeclared, against 247 lines of hand-written Swift `Codable` structs doing
the same job today. `import type` means TypeScript erases them, so nothing from the
engine, `better-sqlite3` included, reaches the bundle. Two wrinkles worth knowing:
`TodayView` lives in `todos.ts` rather than `types.ts`, so it is two imports and not
one, and `allowImportingTsExtensions` means the `.ts` suffix is required.

This is the clearest single win in the whole spike, and there is already a live example
of the drift it prevents: the engine's `Pr` has had a `title` field for a while, and
`TodayLogic.linkedTitle` still says "a PR carries no title of its own" and digs the
title out of the linked ticket instead.

**Task 7.7, measured fidelity, passes on every check.** Not eyeballed from a
screenshot: `src/fidelityCheck.ts` measures the live DOM and compares against the
numbers in the SwiftUI sources, read with `agent-browser get text "#fidelity"`.

```
FIDELITY PASS 26/26
PR FIDELITY PASS 13/13
```

That covers the sidebar's 228 width and its s6/s4 padding, `WBRowButtonStyle`'s s2/s3
padding and 8 radius, the header's s6/s8 padding and 22px title, the rail's 320 width,
`TaskRow`'s s3/s4 padding with its 17x17 checkbox at radius 5, and the pull request
table's 150/180/110/200 column widths. Tolerance is one LayoutUnit for the reason
recorded in section 1.

One of those 39 checks failed first time round and the failure was informative: the rail
measured 342.39, which is 320 plus s8. SwiftUI applies `.frame(width: 320)` to the rail
and *then* wraps it in padding, so the 320 is the rail and the padding sits outside it.
I had collapsed both onto one element. The fix was to match the SwiftUI tree with two
elements rather than to loosen the check, and this is the kind of thing a screenshot
comparison would have passed without comment.

**SF Symbols were the biggest surprise in this section, in both directions.** The two
screens use 16 of them and a webview has access to none. They export cleanly
(`tools/export-ui-symbols.swift`), and exporting them as *alpha masks* rather than
images is what makes it a real solution: with `mask-image` and
`background: currentColor` the icons stay tintable from CSS exactly as SwiftUI tints
them with `foregroundStyle`. Fidelity is essentially perfect, and the screenshots show
it.

Two costs, one of which matters a lot more than the other:

- The glyphs stop following the system, so a macOS release that restyles any of them
  needs the script re-run. Minor.
- **SF Symbols are licensed by Apple for use on Apple platforms.** That is fine for a
  Mac-only Tauri client and is a real blocker for a Linux or Windows one, which would
  need a different icon set and would therefore not look like this app. This lands
  directly on driver 2 from the proposal: "a non-Mac client later" is not just a port,
  it is a visual redesign of every icon.

**Smaller gaps found by building it.** None are blockers, all are real:

- `ProcessInfo.processInfo.fullUserName` feeds the sidebar footer and a webview cannot
  see it, so a real port needs it exposed from Rust. Hard-coded in the spike.
- The allowlist grew from two GET paths to five. `TodayLogic` resolves every row's
  project name and dot colour from the projects array and builds the rail from tickets,
  and `/todos` is a different set from `/today`'s (`listTodayTodos` returns only manual
  and pinned rows, while the sidebar's Jira count counts mirrored issues, so that row
  read 0 until `/todos` was added; it reads 694, which the engine confirms is right).
  Still GET-only, so nothing can mutate and `POST /prs/:id/merge` stays unreachable.
- The engine's counts are real: 13 needsInput, 13 pull requests, 4 projects, 695 open
  todos. The screens are not rendering a fixture.

**Task 7.6 works end to end in the real app**, idle icon then the data-driven one:

```
PROBE tray PASS 36x36 template=true bytes=5184
PROBE tray PASS 36x36 template=false bytes=5184
```

`template=false` is the badge count of 13 arriving from `/today` and switching the tray
off template mode, which is exactly the `MenuBarIconRenderer` rule.

**A build-system gotcha.** Adding the `launchd_probe` binary broke `tauri dev`
outright: it shells out to a bare `cargo run`, which then refuses with "could not
determine which binary to run". Fixed with `default-run = "tauri-client"` in
`Cargo.toml`. Ten minutes, and the sort of thing no guide mentions.

## Section 8: measurements

**Lines, and the result is the opposite of what a rewrite is usually sold on.** Comments
and blanks excluded, for the same two screens plus the shared shell, sidebar, header,
row components and theme:

| | Code lines |
|---|---|
| Spike: TS, TSX and CSS | **1632** |
| Swift: the 11 equivalent files | **1470** |

The port is **11% larger while doing less**. It has no hover states, no context menus,
no alerts, no mutations and no ViewModels, all of which the Swift version carries. A
complete port would be meaningfully larger than the SwiftUI it replaces.

Two honest caveats in opposite directions. The number partly reflects my choice of
inline React style objects, and Tailwind or CSS modules would compress it. But it also
excludes 896 lines of probe and evidence code (`Swatches`, `tokenCheck`, `TrayProbe`,
`trayBadge`, `trayDiff`, `fidelityCheck`) which have no Swift counterpart and are not
counted above, plus 584 lines of Rust and 249 of Swift tooling.

So the "one language everywhere" argument for the rewrite is real, and the "less code"
argument is not. Nothing here supports the second one.

**Bundle size: 12 MB against 7.0 MB**, both release builds, unsigned. Tauri is 1.7x
larger, and that is with `reqwest` built without TLS. Neither number is a problem.

**Memory: roughly 2x, and consistently.** Two runs each, both apps showing Today
against the same engine:

| | main process | WebKit helpers | total |
|---|---|---|---|
| Swift, run 1 / 2 | 100 MB / 105 MB | none | **100 MB / 105 MB** |
| Tauri, run 1 / 2 | 96 MB / 100 MB | 3 helpers, 106 MB / 104 MB | **203 MB / 205 MB** |

The interesting part is where it comes from. The Tauri *main* process is slightly
smaller than the Swift app. The entire doubling is the three WebKit helper processes,
and reporting only the main process, which is what a casual `ps` would show, would have
flattered Tauri by half.

**Start-up: partial, and task 8.4 is the one measurement that could not be done
properly.** Instrumented on the Tauri side, release build:

```
PROBE startup setup_reached at=254ms
PROBE keychain PASS token_length=64 at=288ms
PROBE engine_get PASS /today bytes=1425 at=354ms
PROBE engine_get PASS /prs bytes=6270 at=434ms
```

So the app has Today's data 354ms after process start, which is fast. What that does
**not** include is webview paint, because the window cannot be observed here, and there
is **no comparable Swift number at all**: getting one means instrumenting `app/`, which
this change forbids. An external proxy was tried and abandoned as unsound rather than
reported as a number: polling `lsof` for an established socket on 4173 never caught
either app, because the connections last milliseconds. So "cold start, three runs each"
is not delivered. What stands is that the Tauri app reaches data in well under half a
second, and that the Swift baseline is unknown.

**Task 8.5, days spent.** The plan budgeted 3 to 5 days and asked for a per-section
count. The honest answer is that sections 1 through 8 were done in a single session, on
the order of hours rather than days, so a per-section day count would be invented
precision.

Worth being clear about why, because "it was faster than estimated" is only useful with
the reason attached. All the expensive knowledge already existed in the Swift code to
copy: the plist contents, the toolchain resolution trick, the KeepAlive reasoning, every
token value, every layout constant, every business rule with its comment explaining why
it is that way. The spike transcribed a solved problem. A real port would carry that
same advantage for the parts that are already built, and none of it for the parts that
are not, above all the diff renderers.

## Human observation, release build

The user ran the release `.app` against the live engine and reported that it looks good.

That closes the gap left at task 1.2 and repeated in probe 1: the window does render, and
its appearance is acceptable next to the Swift app. Until this point the spike could only
show that the process ran and its webview connected to the dev server, never that pixels
arrived. Combined with the 39 of 39 measured layout checks, the visual result is now
confirmed by both measurement and eye.

Recorded narrowly on purpose. This confirms the window and its appearance. It is **not**
evidence for task 4.4, which asks specifically whether the badge-free tray icon still
adapts between a light and a dark menu bar, and which needs the appearance actually
switched while watching the icon. That task stays open.

## Task 4.4 closed by decision, not by observation

Recorded plainly because the checkbox is now ticked and the literal check was never run.

The task asked for the idle tray icon to be seen in both a light and a dark menu bar.
Two things made that impractical rather than merely undone:

- The icon only adapts at badge count 0, because `MenuBarIconRenderer` sets `isTemplate`
  only when the count is zero and the port copies that rule. The live engine reports 13,
  so the icon in the menu bar is the non-template one, which is *supposed* to ignore the
  appearance.
- Reaching count 0 needs the `#tray` page, and that page is unreachable in the release
  app: the debug nav is hidden on the app screen so it cannot shift the fidelity
  measurements.

What is actually proven is the Tauri-specific half: `set_icon_as_template` exists, is
accepted, and the flag reaches the tray (`PROBE tray PASS 36x36 template=true`). What
stays unobserved is whether macOS then tints a template tray image the way Apple
documents. The Swift app already depends on that same behaviour through the same flag, so
the residual risk is Apple's behaviour changing for both clients at once, not a Tauri
limitation.

The user chose to accept that rather than have the app modified to expose a count-0
button, on the grounds that the test would be exercising Apple rather than Tauri. Noting
the alternative that was declined: a few lines restoring the nav strip inside the app, or
a keypress that pushes a 0 badge, would make it directly observable if anyone wants it
later.
