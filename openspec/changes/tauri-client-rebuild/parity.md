# Parity report

Tasks 10.3, 10.4 and 10.5. What the Tauri client does and does not do compared to the
SwiftUI app, what it measures, and the question that is the user's to answer.

## Screen by screen

Measured with the fidelity harness, which compares live geometry against numbers cited from
the SwiftUI sources at a tolerance of one LayoutUnit (1/64 px). Read with
`agent-browser get text "#fidelity"`.

| Surface | Checks | Result |
| --- | --- | --- |
| Design tokens | 35 | PASS |
| Today, sidebar, header | 26 | PASS |
| Pull requests list | 13 | PASS |
| Pull request detail | 20 | PASS |
| Projects | 9 | PASS |
| Project detail | 10 | PASS |
| Jira | 8 | PASS |
| Agent panel | 6 | PASS |

Every check cites the SwiftUI line it came from. The two gutters at 44 and the 320 rail are
the ones that caught real mistakes during the port.

Fonts: Inter Medium and Inter Regular both load, at weights 500 and 400, which is what
`Theme.heading` and `Theme.body` resolve to.

## Behaviour verified against the live engine

Each of these was driven in a browser against the real engine on port 4173, and the result
read back from the engine rather than from the screen.

- Today: quick add, toggle done, cycle priority, delete, and the pinned row's checkbox
  unpinning rather than completing.
- Pull requests: pin and unpin from the list and from Today's rail, and the background
  review, which reported `running: true` and disabled the row.
- Pull request detail: the review section with four real findings, the file sections with
  both gutters, the conversation tab, and collapsing a file.
- Projects: the cards, the detail page, and the notes saving three ways, on the debounce,
  on a tab switch and on the way out.
- Project form: validation, cancel writing nothing, and a no-op save leaving the project
  byte-identical.
- Jira: 19 project groups, 178 issues split by status, and pin and unpin.
- Agent panel: a real transcript, and a message sent to a project chat that came back with
  the agent's reply, with the composer disabled for the whole wait.
- Palette and shortcuts: Cmd-K, Cmd-3, arrow keys, Enter, Escape, and Cmd-3 firing nothing
  while the caret is in a text field.
- Settings: the engine section, and the Jira section showing the real connection.

## The packaged app

`Workbench.app`, release build, from `pnpm tauri build`:

```
PROBE startup setup_reached at=244ms
PROBE keychain PASS token_length=64 at=274ms
PROBE engine_get PASS /today bytes=1650 at=306ms
PROBE engine_get PASS /prs bytes=7708 at=307ms
PROBE tray PASS 36x36 template=true bytes=5184
PROBE tray PASS 36x36 template=false bytes=5184
```

The two tray lines are the pair working: template for the idle icon at zero, then
non-template once a real count arrived, which is `MenuBarIconRenderer`'s rule that a
template image would erase the red badge.

## Measurements, and how the estimate held up

Code lines, blanks and comment-only lines excluded, the same rule the spike used.

| | Swift | Port |
| --- | --- | --- |
| App code | 6,641 | 9,032 (8,004 frontend, 1,028 Rust) |
| Tests | 4,823 | 2,232 |
| Tooling | 249 | 241 |

**The port is 36% more app code, not less.** The spike already said the "less code"
argument was unsupported, and at full scale it is worse than it looked there. Where it
goes:

- Inline styles. A SwiftUI modifier chain is denser than the equivalent style object, and
  every one of them pays object syntax. This is most of the difference.
- Things SwiftUI supplies and a webview does not: the context menu (91 lines), the error
  alert standing in for `.alert` (78), the keyboard shortcut table and its typing rule,
  head truncation for a path.
- Where it did save: no hand-written `Codable` structs, and `FlowRow`'s custom `Layout`
  became one `flex-wrap`.

Tests are half, and the coverage report explains it: 100 of the Swift's tests exist to
check hand-written model decoding and the URLSession calls around it, and the port has
neither. Nothing else is thinner.

| | Swift | Port |
| --- | --- | --- |
| Bundle, unsigned release | 7.0 MB | 14 MB |
| Memory, main process | 100 to 105 MB | 105 MB |
| Memory, WebKit helpers | none | 117 MB across three |
| Memory, total | 100 to 105 MB | 222 MB |

The bundle grew from the spike's 12 MB with the dialog, notification and clipboard plugins.
Memory is the spike's finding confirmed at full scale: the main process is the same size as
the Swift app's, and the entire doubling is the three WebKit helpers. Reporting only the
main process, which is what a casual `ps` shows, would flatter the port by half.

Start-up: 306ms to Today's data in the packaged app. There is still no comparable Swift
number, for the reason the spike gave: getting one means instrumenting `app/`.

## Bundle identity

- Name `Workbench`, version `1.0.0`, minimum macOS 14.0, matching `project.yml`.
- Window 1440 by 900. `WorkbenchApp.swift` declares no size at all and lets SwiftUI size
  the window to its content, which a webview cannot do; 1440 is the first round width at
  which the 228 sidebar and the content's own 1180 cap both fit, so nothing is clipped and
  nothing is stretched past what the design allows.
- Minimum 949 by 600. The floor is countable rather than picked: 228 sidebar, 360 agent
  panel, 360 for the content beside them, and the sidebar's 1px rule. Below that the panel
  and the content are fighting over the same space.
- Identifier `com.linku.workbench.client`, deliberately **not** the Swift app's
  `com.linku.workbench`. Two apps sharing an identifier cannot be told apart by
  LaunchServices, notification permissions or keychain ACLs, and both are installed while
  this question is open. Taking the plain identifier is part of retiring `app/`, not part
  of shipping alongside it.
- The icon is rendered from the app's own mark, the badge in `Sidebar.swift`'s `brandRow`,
  by `tools/render-app-icon.swift`. The Swift app has no icon asset at all, so there was
  nothing to copy; the alternative was shipping Tauri's default logo, which would claim in
  the Dock to be a Tauri sample.

## Signing and notarisation

Not done, and not doable here.

- The build is **ad-hoc signed**: `codesign -dv` reports `Signature=adhoc`,
  `TeamIdentifier=not set`. That is enough to run locally and not enough to distribute.
- Real signing needs a Developer ID Application certificate in the keychain, and
  notarisation needs an App Store Connect API key or an app-specific password. Neither is
  available to this session, and the keychain is off limits.
- `.dmg` bundling is disabled in `tauri.conf.json` for a separate reason: Tauri's dmg
  target drives Finder through AppleScript to position the window, and assistive access is
  not granted on this machine. `targets` is `["app"]`, so the build produces the bundle and
  stops.

What the user needs to do, once, to distribute it: `export APPLE_SIGNING_IDENTITY="Developer
ID Application: ..."` plus `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`, then add `dmg`
back to `targets` and run `pnpm tauri build`. Tauri signs and notarises from those
variables.

## Not ported

- **Refresh**, the header button. It renders and measures and does nothing. The engine's
  `POST /poll` is the call behind it and the query layer's invalidation is the other half,
  so it is small; it is simply not in this change's task list.
- **The Jira connect flow past the connected state.** Four of five branches are written and
  none is exercised, because reaching them means disconnecting a real Jira.
- **Notifications appearing on screen.** The rules have 13 tests; that macOS draws the
  banner is not something a webview test can see.
- **The Go menu, the tray click, the folder picker, the clipboard.** Each is a few lines
  over a plugin, each is unreachable in Chrome, and the window can be neither driven nor
  photographed on this machine. The startup probes are the only channel, and they show the
  tray working.

## The question for the user

**Should `app/` be retired?**

What the port has: every screen at measured parity, every rule copied with the comment that
explains it, the mutations verified against the real engine, the launchd agent with its
refusals tested behind a seam, and one language across the client and the engine.

What it costs: 36% more app code, twice the memory, twice the bundle, an icon derived rather
than designed, and SF Symbols exported to PNG, which Apple licenses for use on Apple
platforms and which therefore does not travel to Linux or Windows. The cross-platform
argument for Tauri does not survive that, so the honest reason to keep going is the one
language, not the reach.

Three things would need doing before `app/` could go:

1. Signing and notarisation, which needs credentials only the user has.
2. The Refresh button, which is small.
3. The identifier moving to `com.linku.workbench`, which can only happen once the Swift app
   is gone.

Recommendation: keep both installed for a week of real use. The port is verified but it has
not been *lived in*, and the difference between those two is exactly what a week finds. The
memory doubling is the one number that might matter in practice, and a week of having it
open alongside everything else is the only way to know whether it does.
