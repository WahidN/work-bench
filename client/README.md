# Workbench client

The macOS app: a Tauri window over a React frontend, talking to the engine on
`127.0.0.1:4173`. This replaced a SwiftUI app that lived in `app/`.

## Running it

```
pnpm install
pnpm tauri dev          # the app
pnpm dev                # the frontend alone, in a browser, on :1420
```

`pnpm dev` exists because a Tauri window on macOS exposes no CDP endpoint, so it cannot be
driven or photographed. The Vite dev server proxies `/engine` and injects the bearer token
on the node side, which makes every screen reachable in Chrome. What is *not* reachable
there is anything behind Rust: launchd, the keychain, notifications, the clipboard, the
folder picker and the native menu. Those need the app.

```
pnpm test               # vitest
pnpm build              # typecheck and bundle
pnpm tauri build        # Workbench.app
cd src-tauri && cargo test --lib
```

## Verifying a change

Do not judge layout by eye. `fidelityCheck.ts` measures live geometry against numbers
cited from the SwiftUI sources, at a tolerance of one LayoutUnit, and writes the result
into `#fidelity`:

```
agent-browser open http://localhost:1420/#app
agent-browser get text "#fidelity"
```

Three harness pages hang off the hash: `#app` is the real shell, `#tokens` renders all 35
design tokens for `tokenCheck.ts`, and `#tray` pixel-diffs the canvas tray badge.

## Why the comments name Swift files

Most modules here open with something like "Port of `app/Workbench/Views/TodayLogic.swift`",
and many rules carry the comment that explained them there. **That directory no longer
exists.** It was removed once this client reached parity; the files are in git history,
before the commit that deleted them.

The references are kept rather than stripped, because they are the only record of *why* a
rule is the way it is. `taskSections` puts a pinned todo above a pinned ticket, `hunkStarts`
splits on `@` before looking for signs, `KeepAlive` is a blanket `true`: each of those has a
reason, each reason was learned the expensive way, and each is written down next to the code
it explains. A path that needs `git log` to follow is a smaller cost than losing that.

## Layout

| Path | What |
| --- | --- |
| `src/*.tsx` | screens and components |
| `src/logic.ts` | the shared pure rules: sections, rails, filters, refs, labels |
| `src/queries.ts` | every engine call, as TanStack queries and mutations |
| `src/*Logic.ts` | pure rules per feature, each with its own test |
| `src/fidelityCheck.ts`, `tokenCheck.ts`, `trayDiff.ts` | the verification harness |
| `src-tauri/src/launchd.rs` | the engine's login agent, with its refusals and a test seam |
| `src-tauri/src/engine.rs` | the transport, one command per HTTP verb |
| `tools/` | SF Symbol export and the app icon renderer, both Swift scripts |

## Notes

- Types come from the engine (`../engine/src/types.ts`) rather than being redeclared. That
  is deliberate: the SwiftUI app kept 247 lines of hand-written `Codable` structs, and they
  had already drifted.
- The icons are SF Symbols exported to PNG and used as CSS masks, so they tint from `color`.
  Apple licenses SF Symbols for use on Apple platforms, so this does not travel to Linux or
  Windows.
- The bundle is ad-hoc signed. Distributing it needs a Developer ID certificate; see
  `openspec/changes/tauri-client-rebuild/parity.md`.
