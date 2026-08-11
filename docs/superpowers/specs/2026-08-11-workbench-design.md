# Workbench design

## Problem

Wahid's dev workflow today is split across three unconnected tools:

- **issue-agent**: a CLI that turns Jira/Sentry/GitHub issues into Linear tickets with an analysis, then (once approved in Linear) implements a fix in a git worktree, opens a PR, and self-reviews it. Never merges, never pushes to a default branch. Terminal-only.
- **work-tracker**: a CLI that syncs open Jira issues and starred Gmail into `~/.work-tracker/reminders.json`, plus a Raycast extension for quick-capturing manual reminders and sending a Slack digest.
- Everything else (reading PR diffs, chatting with an agent to revise a PR, actually merging) happens by hand in GitHub or a terminal.

Workbench replaces all three with one product: a macOS engine + desktop app that surfaces what needs Wahid's attention, lets him spar with Claude on how to fix a ticket, watches the resulting PR through to merge, and gives him one daily todo list — with Raycast as a fast-capture front door into that same list.

## Goals

- One place to see everything that needs input: tickets ready to discuss, PRs ready to review or merge, and plain todos.
- Chat-driven interaction with Claude on both tickets (before a fix exists) and PRs (after one exists), replacing today's one-shot analysis and terminal-only fix loop.
- Explicit, in-app merging — a deliberate change from issue-agent's current "never merge" rule. The app itself is the human gate; nothing merges without you clicking Merge or saying "merge it."
- A native, always-available macOS presence (menu bar badge + notifications) backing a full desktop window — not just a menu bar dropdown.
- Quick-capture of todos from Raycast into the same list the desktop app shows.
- Structure the engine so it *could* later serve another client or move off-machine, without building any multi-user features now.

## Non-goals

- No multi-user accounts, auth, or billing. Single local user, single Mac.
- No Gmail-starred-email or Slack-digest tracking (both dropped from work-tracker's scope; todos come from the pipeline, Jira, and manual entries only).
- No in-app code editor. The PR view renders a read-only syntax-highlighted diff; anything beyond reading/chatting happens in GitHub.
- No autonomous merging. Every merge is a direct, explicit action from Wahid.
- Raycast keeps exactly one command (quick-add). It is not a second full UI for the list.

## Consolidation

issue-agent and work-tracker are retired once Workbench's engine covers their behavior:

- issue-agent's triage/fix pipeline (source adapters, worktree management, headless Claude sessions, self-review loop, `gh` PR creation) moves into the engine largely as-is, with its Linear-writing code replaced by writes to local SQLite.
- work-tracker's Jira-issue-as-reminder behavior moves into the engine's todo aggregation. Its Gmail and Slack pieces are dropped.
- `work-tracker/raycast`'s extension keeps living where it is, trimmed to its `add-reminder` command, repointed from `~/.work-tracker/reminders.json` to Workbench's local API.

## Architecture

Two long-lived pieces on the Mac, talking only over `localhost`:

- **Engine** (Node/TS): a background server, launched at login, with no UI of its own. Owns all logic — polling Jira/Sentry/GitHub, headless Claude sessions for triage/spar/fix/PR-chat, git worktrees, `gh` for PRs and merges. State lives in SQLite; credentials live in macOS Keychain (replacing `.env` files). Exposes an HTTP API on localhost only, guarded by a token generated on first run and stored in Keychain.
- **Desktop app** (SwiftUI): the primary interface — a full window, not a menu bar dropdown — plus a menu bar icon that shows a badge count and opens the window on click. No separate menu bar UI beyond the icon and badge.
- **Raycast extension**: the existing `work-tracker-reminders` extension, trimmed to a single "Add Todo" command that posts to the engine's API.

The engine/UI split is deliberate: the same backend could later gain a second client, or move to a different machine, without touching the pipeline logic. That option is bought by this boundary alone — nothing further is built toward it now.

## Visual design

Confirmed via mockup review: SwiftUI, Linear-inspired dark theme (near-black background, violet accent, minimal borders, dense information), following a three-pane layout (sidebar / list / detail) across three main views:

- **Today**: grouped into "needs your input" (tickets ready to spar, PRs ready or needing attention) and a plain checkable todo list.
- **Tickets**: ticket list on the left, chat with Claude on the right, ending in a "Create PR" button.
- **Pull Requests**: PR list on the left; detail pane on the right with a syntax-highlighted unified diff, a chat thread for "fix this"-style revisions, and a dedicated Merge button.

Plus two supporting screens:

- **Menu bar**: a single icon with an idle state and a badge-count state. No dropdown — clicking the icon, or a native notification it fires, brings the full window forward focused on the relevant item.
- **Projects settings**: list of configured projects on the left; on the right, an edit form (local repo path, default branch, GitHub repo, Jira project key, Sentry project slug) replacing today's hand-edited `config.json`.

## Components

- **Source adapters**: Jira, Sentry, GitHub Issues (reused from issue-agent).
- **Todo aggregation**: unifies two lanes into one Today list — plain items (manual todos, Jira issues assigned to Wahid) and pipeline items (tickets awaiting sparring, PRs awaiting review/action, failed fixes needing attention). A plain Jira item carries a "Start fixing this" action that runs the same one-shot Claude analysis Sentry/GitHub issues get on triage, turns it into a ticket, and opens the sparring chat — so the same issue is never tracked in two places.
- **Ticket chat engine**: one thread per ticket. Each message runs a read-only headless Claude session with the source issue plus prior chat as context. "Create PR" ends the conversation and starts the fix pipeline, passing the chat along as implementation guidance.
- **Fix pipeline**: creates a worktree and branch, headless Claude implements, opens the PR via `gh`, self-reviews to average ≥4/5 with correctness ≥4 (max 3 rounds) — unchanged from issue-agent.
- **PR chat/action engine**: one thread per PR. A revision-style message spins up a new headless Claude session on the same branch, pushes, and re-runs self-review. A Merge button, or a "merge it" message, runs `gh pr merge` directly.
- **Notifications**: native macOS notifications for a ticket ready to spar, a PR update, a failed fix, or the Today list refreshing for the day.

## Data model (SQLite)

- `projects` — name, repo path, default branch, GitHub repo, Jira project key, Sentry project slug.
- `todos` — plain items: manual entries and Jira issues, with source/external-id for dedup, status, promoted-ticket-id (nullable).
- `tickets` — source (sentry/github/jira), source issue id, status (new / sparring / in_review / done / needs_attention), linked PR id.
- `ticket_messages` — ticket id, role (user/assistant), content, timestamp.
- `prs` — ticket id, repo, branch, PR number, status (ready / needs_attention / merged), last self-review score.
- `pr_messages` — pr id, role, content, timestamp.
- `jobs` — type (triage/spar/fix/pr-chat/merge), target id, status (running/done/failed/interrupted) — the concurrency lock described below.

Entries are deduplicated by `(source, source_id)`, matching issue-agent's existing marker-based approach, so a re-poll never creates a second ticket or todo for the same underlying issue.

## Data flow

1. **Background poll** (every 5 minutes): the engine pulls assigned Jira issues, Sentry issues, and GitHub issues.
   - A Jira issue lands directly on Today as a plain todo, with "Start fixing this" available.
   - A new Sentry/GitHub issue gets a Claude triage analysis and appears as a ticket in "ready to spar" state.
2. Wahid opens a ticket, chats with Claude, and clicks **Create PR**. The engine creates a worktree/branch, implements using the chat as guidance, opens the PR, and self-reviews. The ticket moves to `in_review`; the PR appears in the Pull Requests view.
3. Wahid opens the PR, reads the diff, and sends a revision message. A new headless Claude session amends the branch and pushes; self-review reruns; the diff view refreshes.
4. Wahid clicks **Merge** (or sends "merge it"). The engine runs `gh pr merge`. The ticket is marked done and drops off Today.
5. A todo added via Raycast appears on Today within 5 seconds, the app's poll interval against the local API while its window is open — fine for a local, single-user app, no push infrastructure needed.

## Error handling

- **External API failures** (Jira/Sentry/GitHub/Anthropic): retried with backoff, surfaced as a banner rather than crashing the poll loop. A source with repeated auth failures pauses itself and flags the problem in Projects settings instead of retrying indefinitely.
- **Fix pipeline never reaches the review bar** after 3 rounds: the ticket/PR is marked `needs_attention` and surfaces on Today; the draft PR keeps the review findings visible in its chat thread.
- **Concurrent actions on the same ticket/PR** (e.g. a revision message sent while a previous job is still running): rejected with "already working on this" rather than queued. The `jobs` table's lock, persisted in SQLite, means a crash or restart can't leave two Claude sessions racing the same worktree.
- **PR merged or closed outside the app, or a merge conflict appears**: picked up on the next sync and reflected in status; no silent retry against a PR that no longer exists in that state.
- **Engine crash/restart**: SQLite is the durable source of truth. On restart, any job left in `running` state is marked `interrupted` (surfacing as `needs_attention`) rather than silently resumed against a possibly half-finished worktree.
- **Local API access**: both the desktop app and the Raycast extension authenticate with the Keychain-stored token generated on first run, so no other local process can call the engine.

## Testing

- **Engine**: reuse and adapt issue-agent's and work-tracker's existing test suites for the source adapters and pipeline logic. Add tests for the ticket-chat and PR-chat/merge flows, mocking the `claude -p` and `gh` subprocess calls the same way issue-agent already does.
- **API layer**: request/response contract tests per endpoint.
- **Desktop app**: business logic stays server-side by design, so the SwiftUI layer is thin — view-model tests where real logic exists (e.g. Today-list grouping), plus a manual click-through pass before calling a feature done.
- **Raycast extension**: kept to one trivial command, so manual verification is sufficient.
