## Why

An agent started from Workbench is invisible the moment the user looks away from the one
screen that started it.

A comment fix runs as a headless `claude -p` in a detached worktree. Its only trace in the
app is the `FixAttempt` status line in `client/src/PrDetailScreen.tsx`, which sits inside a
collapsible file section on the Files tab of one pull request. Collapse that file, switch to
Conversation, or go back to the list, and nothing in Workbench says an agent is working.
Observed on the real setup: `claude -p` ran for six minutes on `MunicipalityPicker.tsx:38`
while `pr_comment_fixes` row 6 stood at `running`, and the pull request list showed nothing.

The pull request list also cannot say whether Workbench has reviewed a pull request. Every
row offers the same Review action, identical on one reviewed a minute ago and one never
reviewed. The status column shows `prReviewStateLabel(pr)`, which is GitHub's own decision
(approved, changes requested, review required), not whether the agent has read the diff.

Neither gap is a broken pipeline. Both are missing surfaces over facts the engine already
holds.

## What Changes

- A running agents list, reachable from the sidebar, naming what each agent is doing, which
  pull request or ticket it is on, and how long it has been going. A row opens that pull
  request.
- **BREAKING** nothing. No existing route changes shape; the list reads new fields only.
- `jobs` gets an `activity` column, written honestly at each call site. Today every
  pull-request lock is taken as type `pr-chat`, including two that run no agent at all: the
  diff route and the head-sha check in `GET /prs/:id/review`. The second runs every 30
  seconds per pull request from the notification loop, so a list built on `status = 'running'`
  alone would show a phantom agent on a timer. A lock held without an agent leaves `activity`
  null and never appears in the list.
- Queued comment fixes appear too, as waiting rather than running. A fix behind another fix
  on the same branch is the case the user most needs told about, because it explains why
  nothing is happening yet.
- `prs` gets `reviewed_at`, written when a review finishes. Also when it finds nothing:
  `replaceReviewFindings` stores no row for a clean review, so today a review that found
  nothing to say and a review that never ran are the same empty list.
- The pull request row says whether Workbench has reviewed it, and when.

## Capabilities

### New Capabilities

- `agent-activity`: every agent Workbench started is visible while it runs, apart from the
  screen that started it.
- `pr-review-status`: the pull request list says whether Workbench has reviewed a pull
  request.

### Modified Capabilities

None. `openspec/specs/` does not exist yet, so no capability spec is promoted.

## Impact

**Engine**
- `engine/src/db.ts`: migration 11. `jobs.activity TEXT` and `prs.reviewed_at TEXT`, both
  nullable, and the same two in `SCHEMA`. The runner learns to take a function, because
  `SCHEMA` creates a missing table complete and a later `ALTER` on it would duplicate.
- `engine/src/jobs.ts`: `acquireJob` takes the activity, `listRunningAgents` reads the rows.
- `engine/src/api/routes/prs.ts`: five `acquireJob` call sites pass what they really do, two
  of them nothing. The review route writes `reviewed_at` and `reviewed_sha` in its `finally`.
- `engine/src/api/routes/tickets.ts`, `engine/src/api/routes/todos.ts`,
  `engine/src/fixPipeline.ts`, `engine/src/prCommentFix.ts`: the same one extra argument.
- `engine/src/prs.ts`: the column through `rowToPr`.
- `engine/src/types.ts`: `JobActivity`, `RunningAgent`, one field on `Pr`.
- New route `GET /agents`.

**Client**
- `client/src/queries.ts`: `useRunningAgents`, polled while the app is open.
- `client/src/Sidebar.tsx`: the count, and the entry that opens the list.
- New `client/src/AgentsScreen.tsx` (or panel, see design.md).
- `client/src/PRsScreen.tsx` and `client/src/logic.ts`: the reviewed marker on the row.

**Not covered**
- Project chat. `engine/src/projectChat.ts` runs an agent and takes no job lock at all, so it
  has no row to list. Giving it one means giving project chat an exclusivity it does not have
  today, which is a behaviour change this change does not want to smuggle in. It stays
  invisible, and that is worth its own change.
- Whether a stored review is still current. `GET /prs/:id/review` answers that by opening a
  worktree under the job lock. Doing it per row would open one worktree per pull request on
  every list read and fight the agents this same change is trying to show. The list says when
  the review ran, not whether it still applies.
