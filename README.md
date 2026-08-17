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

**App** (`app/`), SwiftUI for macOS 14 and up. A window with a sidebar (Today,
Projects, Pull requests, Jira), a shared agent chat panel, and a menu bar icon
that carries a badge count and fires notifications.

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
- Xcode, plus [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
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

### App

The Xcode project is generated and not checked in. Build it from `app/project.yml`:

```bash
cd app
xcodegen generate
open Workbench.xcodeproj
```

New Swift files are picked up automatically on the next `xcodegen generate`, so
there is never any manual project wiring.

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
cd app && xcodebuild test -scheme Workbench -destination 'platform=macOS'
```

One gotcha with the Swift tests: the free `@Test func` tests here are not grouped
into a suite named after their file, so `-only-testing:WorkbenchTests/<FileName>`
matches nothing and still reports success. Use the whole target
(`-only-testing:WorkbenchTests`) or the per-function form
(`-only-testing:'WorkbenchTests/testFunctionName()'`).

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
app/      SwiftUI macOS app (project.yml drives XcodeGen)
```

## Status

Working: the engine and its full pipeline, and the desktop app through redesign
phase 5. That covers design tokens, the app shell, the shared agent chat panel,
the Today dashboard, the Projects card grid, and a dedicated Jira screen.

Not built yet: the command palette, the final token cleanup, and the Raycast
quick-add extension.
