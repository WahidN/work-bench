## Context

See `proposal.md` for why this is happening, and `tauri-client-spike/findings.md` for the
537 lines of measurement this inherits. What the spike already settled and this change
does not revisit: Tauri v2 with React, TypeScript and Vite; engine requests routed through
Rust because the engine sends no CORS headers; the keychain read shelling out to
`/usr/bin/security`; the tray badge drawn in canvas and handed over as RGBA; SF Symbols
exported to alpha masks; and the Nocturne tokens as CSS custom properties.

What is new is scope. The spike ported 2 screens of 8, read-only, with no tests. This
ports the rest, turns the mutations on, and has to reach parity.

**One assumption from the spike's design is now known to be wrong**, and it matters
because it was the basis for a dependency choice. That design said `PrDetailScreen` and
the diff renderers were the largest risk and picked React partly for `shiki` and
`react-diff-view`. Having read them: `DiffView.swift` is 46 lines of prefix-based
colouring and `PrFileSectionView` is 116 lines of two gutters and a text column. **Neither
highlights syntax.** So no diff or highlighting library is needed, and adding one would
make the port less faithful, not more.

The real work in that area is `PrDetailLogic.diffLines`, a unified-patch walker carrying
old and new line counters across hunk headers. It is pure, roughly 40 lines, and carries
rules that are easy to get subtly wrong: git's `\ No newline at end of file` marker emits
no line and moves neither counter, and a `LEFT`-side review thread must never be matched
against a new-file line number or a reviewer's comment lands on unrelated code.

## Goals / Non-Goals

**Goals:**
- Parity with the SwiftUI app, screen by screen, including hover states, context menus and
  error surfaces rather than only the parts that show up in a screenshot.
- Every subtle rule ported with the Swift comment that explains it, not paraphrased.
- Real test coverage of the ported logic, against the 39 Swift test files covering it now.
- The SwiftUI app stays untouched and usable throughout.

**Non-Goals:**
- Improving on the app. This is a port. A better idea about a screen belongs in its own
  change, after parity, or it will be impossible to tell a port bug from a redesign.
- Cross-platform. SF Symbols cannot ship off Apple platforms, so a Linux or Windows
  client is a separate project with its own icon set.
- Replacing the engine, or touching it at all.
- Deleting `app/`. That is a decision for after parity is demonstrated, not part of this.

## Decisions

**TanStack Query for server state, replacing the 10 ViewModels.** The ViewModels are
thin, roughly 1000 lines of `load()`, a list, and an `errorMessage`, but what they also do
is refetch after a mutation, and there are about 20 mutations across 8 screens. Hand-rolling
invalidation across that surface is exactly where cache bugs live. The alternative was a
small hand-written store, which is fewer dependencies and more of the code that
`ProjectDetailViewModel` already has comments about getting wrong (two PUTs in flight for
the same edit, a stale write landing after a fresh one). Query keys mirror the engine's
paths so invalidation reads like the API.

**No diff or syntax-highlighting dependency**, for the reason in Context. The patch parser
is ported by hand and unit-tested against the same cases as the Swift.

**Mutations get no optimistic updates in this change.** The Swift app does not have them;
it awaits the call and refetches. Adding optimism would be an improvement, which is a
non-goal, and it would make a port bug indistinguishable from a race the app never had.

**Merge stays a deliberate, explicit click, and nothing merges automatically.** The
engine's README is explicit that nothing merges on its own, and this client must not be
the thing that changes that. No poll, timer, retry or keyboard shortcut reaches
`POST /prs/:id/merge`.

**The Rust engine command drops its allowlist but keeps the method boundary.** One
command per HTTP verb rather than a single pass-through, so a bug in the frontend cannot
turn a read into a write by supplying a method string. The path allowlist goes, because
with 8 screens it becomes a list of every route the engine has and stops being a
safeguard.

**Keychain writes get their own command, separate from the read.** The settings sheet
stores Jira and Sentry credentials. `engine/src/keychain.ts` already has `setSecret` and
`deleteSecret` shelling out to `security`, and the same approach applies, but read and
write stay separate functions so a read path can never be talked into writing.

**Tests split three ways by what they can actually prove.** Vitest for the pure logic,
which is most of it and where the Swift tests concentrate too. React Testing Library for
components with behaviour worth asserting, which is fewer than it sounds. Rust `#[test]`
for the keychain, plist and toolchain rules, following the `AgentEnvironment` seam the
Swift already uses so tests never install anything on the machine.

**The probe pages stay until they stop paying.** `#tokens`, `#tray` and the fidelity
checks are how this port gets verified at all, given the shipped window can be neither
driven nor photographed. They are the harness, not leftovers. They come out when parity
is signed off.

**Work order is risk-first, not screen-order.** The engine client and query layer come
first because everything needs them, then the diff work because it was the one unmeasured
risk, then the screens, then the native surface, then tests, then packaging. The
alternative, easiest-first, would produce a demo that looks finished with the hard parts
untouched.

## Risks / Trade-offs

- **Parity has no natural finish line** → Each screen's task is written against its Swift
  file, and the fidelity harness measures the layout numbers rather than trusting a
  screenshot. Hover, context menu and error behaviour are named per screen so they cannot
  quietly fall off.
- **A half-built client can now mutate the real database** → Mutations are wired per
  screen and only after that screen renders correctly, merge is last, and the SwiftUI app
  stays available so a broken state is never the only way in.
- **Two clients polling one engine** → Accepted. The engine holds no per-client state, and
  15-minute source polling means the extra traffic is against SQLite, not Jira or GitHub.
- **TanStack Query is a new dependency and a new idiom in this repo** → Confined to a
  hooks module so the screens see plain data and callbacks, which is also what makes them
  testable without it.
- **The unified-patch parser is subtle and its bugs are silent** → It is pure and unit
  tested first, against the marker, hunk-header and thread-anchoring cases specifically,
  before any of it is rendered.
- **`cargo clean` after the move cost a full rebuild** → Already paid. Worth knowing that
  Tauri's codegen embeds absolute paths, so moving `client/` again invalidates 6.4 GB of
  cache.
