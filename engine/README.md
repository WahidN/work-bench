# workbench-engine

Local server that consolidates issue-agent (Jira/Sentry/GitHub triage + fix pipeline)
and work-tracker (Jira-todo sync) into one SQLite-backed HTTP API. Polls your
assigned issues, lets you spar with Claude on a ticket before creating a PR,
implements fixes in git worktrees, self-reviews the diff, and can revise or
merge a PR by chat.

## Setup

1. `pnpm install`
2. Add whichever credentials you use to the macOS Keychain (skip any source you don't need, the engine skips it gracefully):

   ```bash
   # Jira
   security add-generic-password -U -s workbench -a jira-base-url -w "https://yourorg.atlassian.net"
   security add-generic-password -U -s workbench -a jira-email -w "you@example.com"
   security add-generic-password -U -s workbench -a jira-api-token -w "<token from id.atlassian.com>"

   # Sentry
   security add-generic-password -U -s workbench -a sentry-auth-token -w "<token from sentry.io>"
   security add-generic-password -U -s workbench -a sentry-org -w "<your-sentry-org-slug>"
   ```

3. Make sure `gh auth status` works (GitHub source and PR creation/merge use the `gh` CLI directly, no separate token needed).
4. Start the engine:

   ```bash
   pnpm start
   ```

   First run generates a local API token in Keychain (`security find-generic-password -s workbench -a api-token -w`) and creates `~/.workbench/workbench.db`.

5. Add at least one project so the poller has something to fetch:

   ```bash
   TOKEN=$(security find-generic-password -s workbench -a api-token -w)
   curl -s -X POST http://localhost:4173/projects \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{
       "name": "my-project",
       "repoPath": "/Users/you/Documents/Projecten/my-project",
       "defaultBranch": "main",
       "githubRepo": "yourorg/my-project",
       "jiraProjectKey": "PROJ",
       "sentryProjectSlug": "my-project-frontend"
     }'
   ```

   Leave any of `githubRepo`/`jiraProjectKey`/`sentryProjectSlug` as `null` if that source doesn't apply to this project.

## Usage

The engine binds to `127.0.0.1:4173` only. Every request needs `Authorization: Bearer <token>` with the token from step 4 above.

```bash
TOKEN=$(security find-generic-password -s workbench -a api-token -w)
AUTH="Authorization: Bearer $TOKEN"

curl -s http://localhost:4173/today -H "$AUTH"                                   # today's list
curl -s -X POST http://localhost:4173/tickets/<id>/messages -H "$AUTH" \
  -H "Content-Type: application/json" -d '{"text":"go ahead"}'                   # spar on a ticket
curl -s -X POST http://localhost:4173/tickets/<id>/create-pr -H "$AUTH"          # implement + open PR
curl -s -X POST http://localhost:4173/prs/<id>/messages -H "$AUTH" \
  -H "Content-Type: application/json" -d '{"text":"also handle the null case"}'  # revise a PR
curl -s -X POST http://localhost:4173/prs/<id>/merge -H "$AUTH"                  # merge
```

There's no menu bar app or login item yet (that's the SwiftUI desktop app, a separate plan) — for now `pnpm start` runs in the foreground. Stop it with Ctrl+C, or `SIGTERM` if backgrounded; it shuts down cleanly (stops the poller, closes the HTTP server) either way.

## Development

```bash
pnpm test        # 127 tests
pnpm typecheck
```

The engine never merges or pushes to a default branch except through an explicit `POST /prs/:id/merge` call or a chat message that's an exact match for a merge phrase ("merge it", "merge this", "go ahead and merge") — everything else is treated as a revision instruction.
