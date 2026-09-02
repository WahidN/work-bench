## Context

See `proposal.md` for the motivation and the cost numbers behind it.

What shapes this design is that the engine's contract is already fixed and public to
any client: REST over `127.0.0.1:4173`, a bearer token stored in the login Keychain
under service `workbench`, account `api-token`, and no streaming anywhere. So the
prototype needs no cooperation from the engine at all, which is what keeps the spike
to days rather than weeks.

Four pieces of the app carry all the uncertainty, and three of them are small:

| Piece | Swift today | Why it is uncertain in Tauri |
|---|---|---|
| Verification loop | not possible | `agent-browser` drives Chrome over CDP |
| Keychain read | `KeychainClient.swift`, 88 LOC, `SecItemCopyMatching` | authorization prompts per binary |
| Tray badge | `MenuBarIconRenderer.swift`, 35 LOC, `NSBezierPath` | Tauri's tray takes raw bytes, no SF Symbols |
| launchd install | `EngineAgent` + `SystemAgentEnvironment` + `EngineAgentInstaller`, 373 LOC | toolchain resolution, plist writing, `launchctl` |

The last one looks the largest but is mostly knowledge, not code. `EngineAgent.plist`
already encodes several expensive lessons: `zsh -lic` needs both flags because
`.zprofile` supplies pnpm and `.zshrc` supplies node, `node -e process.execPath` is
what escapes the version manager shim that hangs headless, `KeepAlive` has to be a
blanket `true` because pnpm traps SIGTERM and exits 0, and `PATH` needs Claude's
directory or every agent call fails with `spawn claude ENOENT`. None of that changes
with the language writing the file.

## Goals / Non-Goals

**Goals:**
- Answer one question with numbers instead of taste: is a full Tauri rebuild worth 5
  to 6 weeks.
- Pass or fail each of the four probes independently, so a partial result is still a
  usable result.
- Confirm or kill the specific claim that `engine/src/types.ts` can be consumed
  directly by the client.
- Leave the SwiftUI app working and untouched for the whole spike.

**Non-Goals:**
- Feature parity, or any screen beyond Today and Pull requests.
- Tests. The prototype ships none. A probe's evidence is a screenshot, a measurement
  or a `launchctl print`, not a test suite.
- Packaging, code signing, notarization or a `.dmg`. Those are known-cost work and
  measuring them proves nothing.
- Idiomatic Rust. The probes may be ugly. Judging the spike's Rust on style would
  answer a question nobody asked.
- Any write to the live system: no mutating engine calls, no Keychain writes, no
  touching the installed LaunchAgent.

## Decisions

**Tauri v2, not v1.** v1's tray API is limited and v1 is on its way out. The tray,
notification, dialog and clipboard plugins the real port would need all exist as v2
plugins, so a v1 spike would measure the wrong thing.

**React, TypeScript and Vite for the frontend.** Alternatives were Svelte and Solid,
both of which would produce a smaller and faster prototype. React wins on one specific
ground: `PrDetailScreen.swift` and the two diff renderers are the largest and riskiest
part of a real port, and the strongest third-party leverage there (`shiki`,
`react-diff-view`) is React-shaped. The spike does not build the diff screen, so this
choice is about whether the spike's findings transfer to the decision, not about the
prototype itself.

**Probes before screens, in risk order.** The screens are the part already known to be
low risk, so building them first would burn the timebox on the safe half and produce a
pretty prototype with the question still open. Probes go first. If day 3 arrives with
probes still failing, that is the answer, and the screens are never built.

**The Keychain probe shells out to `/usr/bin/security`, not the `keyring` crate.**
`engine/src/keychain.ts` already does exactly this with `execa`, and it works today
under launchd. `KeychainClient.swift` records the opposite experience: reading through
`SecItemCopyMatching` from a locally built binary makes macOS ask for authorization on
every rebuild, which once hung a test run. The ACL follows the calling binary, and a
Tauri dev binary is rebuilt constantly and unsigned, so the native API is the worse
bet. Shelling out means `/usr/bin/security` is the caller, which is stable and already
trusted on this machine. If this holds, it is a small win for Tauri rather than a cost,
and the probe should say so.

**The tray badge is drawn in the webview with canvas, then handed to Rust as RGBA.**
Alternatives were `tiny-skia` or the `image` crate in Rust, both of which also need a
font loaded to draw the "9+" text. Canvas keeps the Rust surface to one command that
accepts bytes, and a badge count is a UI concern anyway. Two fidelity losses are
expected and must be recorded rather than worked around: the base glyph cannot be the
SF Symbol `checkmark.circle` and has to become a bundled asset, and the template image
behaviour that currently lets the idle icon adapt to light and dark menu bars may not
survive.

**The launchd probe proves mechanics, not the feature.** It reuses the exact plist
content from `EngineAgent.plist` verbatim rather than rederiving it, and answers only
five narrow questions: can Rust run `zsh -lic` and get the same three paths back, can
it serialize that dictionary to a plist file, can it bind-test the port, can it
`bootstrap` and `bootout` the job, and does the job actually stay up. Anything wider
would be reimplementing a solved feature to see if it is still solved.

**The probe uses label `nl.linku.workbench.spike-engine` and port 4174.** Sharing
`nl.linku.workbench.engine` or port 4173 with the installed agent would mean a spike
mistake takes down the real engine, and `KeepAlive` plus an occupied port produces an
endless restart loop. Different label, different port, different log file.

**The prototype is read-only against the live engine.** It calls the GET endpoints
behind Today and Pull requests and nothing else. No create PR, no merge, no todo
mutation. A half-built client with a bug should not be able to merge a pull request.

**The verification loop is probe one, and its honest form is Chrome, not the app
window.** `agent-browser` speaks CDP, and a shipped Tauri window is WKWebView, so the
loop drives the Vite dev server in Chrome rather than the packaged app. That is still
where nearly all UI work happens, and it is still infinitely more than SwiftUI allows
here, but the probe must state the limit plainly instead of claiming the app itself is
drivable.

**Every verdict number gets a stated method.** Lines via `wc -l` over the prototype's
`src/` and `src-tauri/`, resident memory via `ps` against both apps showing the same
two screens, cold start timed from launch to first painted list, bundle size via `du`
on the built `.app`. A verdict of "it felt fast" would not survive a week.

## Risks / Trade-offs

- **The Rust learning curve eats the timebox** → Probes are ordered by risk and each
  one is independently reportable, so running out of days yields a partial answer
  rather than nothing. The 3 to 5 day box is a stop, not a target.
- **`security` prompts anyway, or prompts once per launch** → This is a finding, not a
  blocker. Record the exact prompt behaviour and move on. It only becomes a blocker if
  it prompts on every poll cycle, which the engine's own experience says it will not.
- **The badge loses light and dark menu bar adaptation** → Accept and record. Shipping
  two bundled base icons and picking on `NSApp.effectiveAppearance` equivalent is a
  known fallback, but the spike should not spend a day on it.
- **`rustup` plus a multi-gigabyte `target/` directory is a real cost even if the
  verdict is no** → Accepted deliberately. It is the price of not guessing about 5
  weeks.
- **A promising spike drifts into a half-migration** → The proposal's deletion clause,
  plus the ban on touching `app/` and `engine/`, keeps the two clients from becoming
  entangled. If the verdict is yes, the follow-up change starts clean with its own
  specs.
- **Two screens may be too small a sample to judge a 32-file UI** → Partly true, and
  the mitigation is the choice of screens rather than the count: Today and Pull
  requests between them exercise the sidebar, the shared row and label components,
  polling and the badge count. What they do not exercise is the diff renderers, and the
  verdict must say so out loud rather than extrapolating over them.

## Exit Plan

The spike ends in one of three written verdicts, recorded in this file under a
**Verdict** heading before the change is archived:

1. **Yes.** A follow-up change proposes the full rebuild and owns the real capability
   specs. `spike/tauri-client/` stays only until that change starts, then is replaced
   rather than grown.
2. **No.** `spike/tauri-client/` is deleted. The verdict and its numbers stay in this
   file, which is the whole point of writing them down: the question does not need
   reopening in six months.
3. **Not yet.** A named blocker with the condition that would change the answer.

Rollback needs nothing beyond deleting the directory. Nothing outside it was written,
and the spike's own LaunchAgent is booted out and its plist removed as the last task.

## Verdict

**Not yet, with one named condition.** Every number behind this is in `findings.md`.

All four probes passed, so there is **no technical blocker** to a Tauri rebuild, and
several things came back better than this design predicted. That rules out a "no". What
it does not produce is a "yes", because the spike moved the cost side against the
rewrite while weakening two of the three reasons for wanting it.

### What the spike proved in favour

- **The verification loop works**, which was driver 1 and the strongest reason to ask
  the question. Full `agent-browser` control of the frontend in Chrome: refs,
  screenshots, sub-pixel geometry, computed styles.
- **Fidelity is not a compromise.** 39 of 39 measured layout checks pass against the
  SwiftUI constants, all 35 token checks pass, and the idle tray icon is pixel-identical
  to the production `MenuBarIconRenderer` output (0 of 324 pixels differing).
- **Sharing types with the engine works completely**, replacing 247 lines of
  hand-written Swift `Codable` with two `import type` lines, and there is already a live
  drift bug it would have prevented (`Pr.title`).
- **Two native pieces come out better than Swift**: the keychain read stops prompting on
  rebuild, and the tray icon is rasterised at 2x instead of the Swift app's 1x.
- **The predicted losses mostly were not real.** Template tinting survives via
  `set_icon_as_template`, and SF Symbols export cleanly as alpha masks rather than
  needing hand-drawn substitutes.

### What the spike proved against

- **The rewrite is more code, not less.** 1632 code lines against Swift's 1470 for the
  same two screens, and the port has no hover states, context menus, alerts or
  mutations. The "one language everywhere" argument survives; the "less code" argument
  does not.
- **Memory roughly doubles**, 203 MB against 100 MB, entirely from three WebKit helper
  processes.
- **Driver 2 is largely undermined.** SF Symbols are licensed for Apple platforms, so a
  Linux or Windows client cannot ship these icons. That makes a non-Mac client a visual
  redesign of all 16 icons rather than a port, which is a different and larger project
  than the one the proposal costed.
- **Packaging has real friction here.** `tauri build` produces the `.app` fine, but the
  `.dmg` step drives Finder through `osascript`, which this machine does not permit.
- **A 2.0 GB `target/` and a second toolchain** on a machine already running Node, pnpm
  and Xcode.

### The condition

Driver 1 is now doing almost all the work of justifying five to six weeks. Before
spending them, find out whether that same loop can be had for the cost of two checkboxes:

> **Grant Screen Recording and Accessibility permission to a driver on this machine and
> retest whether the SwiftUI app can be driven and measured.** Those permissions being
> ungranted, not SwiftUI itself, is what makes the Swift app unverifiable today.

If a usable loop exists for the Swift app, driver 1 largely evaporates, and with driver 2
weakened by the icon licensing, only "not writing Swift" remains, which does not buy five
weeks. If no usable loop exists, the question is live again, and the next step is a second
spike on `PrDetailScreen` and the two diff renderers, for the reason below.

### What this spike did not measure

Deliberately recorded, because extrapolating over it would be the main way to misread
this verdict. Today and Pull requests exercise the sidebar, the header, the shared row
and label components, polling, the token path and the badge feed. They do **not** touch:

- **`PrDiffView.swift` and `DiffView.swift`**, and `PrDetailScreen.swift` at 563 lines,
  the largest single file in the app. The design named these the biggest risk in a full
  port and that is still true and still unmeasured.
- The agent chat panel and any streaming or long-running interaction.
- Every mutation: create PR, merge, revision messages, pin, delete, priority.
- The command palette, settings, notifications, and the four other screens.

Two items came off this list. The shipped window is confirmed: the user ran the release
build and reported it renders and looks right, which the harness could not observe. And
task 4.4, the tray icon's light and dark menu bar adaptation, was closed by decision
rather than observation: the Tauri half is proven (`set_icon_as_template` is accepted and
the flag reaches the tray), and what remains is whether macOS tints a template image as
documented, which the Swift app already relies on identically. See `findings.md`.

The spike was also faster than its own 3-to-5 day budget, and the reason matters: it
transcribed a solved problem. Every plist key, token value, layout constant and business
rule already existed in Swift with a comment explaining why. A real port gets that
advantage only for what is already built, and none of it for the diff renderers.

### Decision taken

The user read this verdict and chose to proceed with the full rebuild anyway. That is
their call and the work is going ahead.

This section is left standing unedited on purpose. The analysis above was not wrong
because the decision went the other way, and a record that quietly rewrites itself to
agree with the outcome is worth nothing later. Two things follow from it that the rebuild
should carry forward rather than discover again:

- The condition was never tested. Nobody has checked whether granting Screen Recording
  and Accessibility permission gives the SwiftUI app a usable verification loop, so
  whether driver 1 was real remains unknown.
- The costs measured here are now accepted costs, not open questions: more code than the
  SwiftUI it replaces, roughly double the memory, and SF Symbols that cannot ship to a
  non-Apple platform. The last one means a future Linux or Windows client is a redesign
  of every icon, and the rebuild does not change that.

Per this design's exit plan, `spike/tauri-client/` is now replaced rather than grown: the
code moves to `client/` under a new change, `tauri-client-rebuild`.
