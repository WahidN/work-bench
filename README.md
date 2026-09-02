# Workbench

One place for the work that needs your attention: Jira and Sentry issues, the pull
requests they turn into, and a daily todo list. A local engine does the work, a
native macOS app is the interface, and Claude runs the triage, sparring and fix
sessions in between.

Everything runs on one Mac. No accounts, no cloud, no multi-user features.

## How it fits together

Two long-lived pieces that talk over localhost only.

**Engine** (`engine/`), Node and TypeScript. Polls Jira, Sentry and GitHub every
5 minutes, runs headless Claude sessions, manages git worktrees, and calls `gh`
for pull requests and merges. State lives in SQLite at `~/.workbench/workbench.db`,
credentials live in the macOS Keychain. Serves an HTTP API on `127.0.0.1:4173`
behind a bearer token.

**Client** (`client/`), a Tauri window over React and TypeScript, for macOS 14 and
up. A window with a sidebar (Today, Projects, Pull requests, Jira), a shared agent
chat panel, and a menu bar icon that carries a badge count and fires
notifications. It replaced a SwiftUI app that lived in `app/`; that directory is
in git history, and `client/README.md` explains why the code still names its
files.

The split is deliberate. The engine holds all the logic, so a second client could
be added later without touching the pipeline.

## What it does

1. The engine polls your assigned Jira issues, Sentry issues and GitHub issues.
2. A Jira issue lands on Today as a plain todo. A new Sentry or GitHub issue gets
   a Claude triage analysis and shows up as an issue ready to discuss.
3. You open the agent panel, spar with Claude about the fix, then hit Create PR.
   The engine makes a worktree and branch, lets Claude implement, opens the PR
   with `gh`, and self-reviews the diff. It passes at an average of 4/5 with
   correctness at 4 or higher, over at most 3 rounds.
4. You read the diff in the panel and send revision messages. Each one runs a new
   session on the same branch, pushes, and re-runs the self-review.
5. You click Merge. Nothing merges on its own.

## Requirements

- macOS 14 or later
- Node 22.5 or later, plus pnpm
- Rust, for the Tauri build (`rustup`)
- Xcode command line tools, for the two Swift scripts in `client/tools` that export
  SF Symbols and render the app icon
- The GitHub CLI, authenticated (`gh auth status`)
- The Claude CLI on your PATH as `claude`

## Setup

### Engine

```bash
cd engine
pnpm install
pnpm start
```

The first run generates an API token in the Keychain and creates
`~/.workbench/workbench.db`. Before it can fetch anything you need credentials in
the Keychain and at least one project. Both steps, including the exact `security`
and `curl` commands, are in [`engine/README.md`](engine/README.md).

Any source you skip is skipped gracefully, so Jira-only or Sentry-only setups
work fine.

### Client

```bash
cd client
pnpm install
pnpm tauri dev
```

`pnpm tauri build` produces `Workbench.app`. It is ad-hoc signed, so it runs
locally and is not distributable; see
[`openspec/changes/tauri-client-rebuild/parity.md`](openspec/changes/tauri-client-rebuild/parity.md).

`pnpm dev` serves the frontend alone on `:1420` for a browser, which is how layout
is verified: a Tauri window exposes no CDP endpoint and cannot be driven.

## API

Everything is under `http://127.0.0.1:4173` and needs
`Authorization: Bearer <token>`:

```bash
TOKEN=$(security find-generic-password -s workbench -a api-token -w)
```

| Area | Routes |
| --- | --- |
| Today | `GET /today` |
| Todos | `GET /todos`, `POST /todos`, `PATCH /todos/:id`, `POST /todos/:id/promote`, `PATCH /todos/:id/pin` |
| Issues | `GET /tickets`, `GET /tickets/:id`, `POST /tickets/:id/messages`, `POST /tickets/:id/create-pr`, `PATCH /tickets/:id/pin` |
| Pull requests | `GET /prs`, `GET /prs/:id`, `GET /prs/:id/diff`, `POST /prs/:id/messages`, `POST /prs/:id/merge`, `PATCH /prs/:id/pin` |
| Projects | `GET /projects`, `GET /projects/:id`, `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id`, `GET /projects/:id/messages`, `POST /projects/:id/messages` |

## Development

```bash
cd engine && pnpm test && pnpm typecheck
cd client && pnpm test && pnpm build
cd client/src-tauri && cargo test --lib
```

Layout changes are not judged by eye. `client/src/fidelityCheck.ts` measures live
geometry against the numbers the design carries and writes the result into
`#fidelity`, read with `agent-browser get text "#fidelity"`. See
[`client/README.md`](client/README.md).

## Security notes

The engine runs `claude -p` with Bash enabled and can run `gh pr merge`, so it
binds to loopback only and never listens on the LAN. Every request needs the
Keychain-stored bearer token.

It never merges or pushes to a default branch except through an explicit
`POST /prs/:id/merge`, or a chat message that exactly matches a merge phrase
("merge it", "merge this", "go ahead and merge"). Anything else is treated as a
revision instruction.

## Repo layout

```
engine/   Node + TypeScript server, SQLite, source adapters, fix pipeline
client/   Tauri + React macOS app, with the Rust side in client/src-tauri
```

## Status

Working: the engine and its full pipeline, and the client, at measured parity with
the SwiftUI app it replaced. Every screen, the agent chat panel, the command
palette and its shortcuts, Settings with the engine's login agent, notifications
and the menu bar badge.

Not built yet: the Raycast quick-add extension.

The client is ad-hoc signed, so it is not distributable. What that needs, and what
the rewrite cost in memory and code size, is in
[`openspec/changes/tauri-client-rebuild/parity.md`](openspec/changes/tauri-client-rebuild/parity.md).
