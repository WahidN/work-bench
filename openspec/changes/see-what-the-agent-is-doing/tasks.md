# Tasks

Tests first in each group, then the code that answers them. Section 7 is the part no test
covers: a real review, a real fix, and looking at the list while both run.

## 1. Engine: what a job is doing

- [x] 1.1 Add `activity TEXT` to `jobs` in `SCHEMA` in `engine/src/db.ts`. Nullable, no `CHECK`: null means the lock is held by something that runs no agent, and a constraint here would have to be rebuilt every time a new kind of agent is added.
- [x] 1.2 Add `reviewed_at TEXT` to `prs` in `SCHEMA`.
- [x] 1.3 Append migration 11 with the same two columns, carrying the comment migration 10 carries: `SCHEMA` already makes them on a fresh file, and a database stamped back replays this.
- [x] 1.4 Add `JobActivity` and `RunningAgent` to `engine/src/types.ts`, and `reviewedAt` to `Pr`.
- [x] 1.5 Add failing tests for `engine/src/jobs.ts`: `acquireJob` stores the activity it is given; a null activity is stored as null; `listRunningAgents` returns running jobs with an activity and omits running jobs without one; it omits done, failed and interrupted rows; it orders oldest first, so the longest-running agent reads at the top.
- [x] 1.6 Give `acquireJob` an activity parameter and write `listRunningAgents` against those tests.
- [x] 1.7 Update all ten `acquireJob` call sites. Null at `prs.ts:148` (the diff route) and `prs.ts:233` (the head-sha check in `GET /prs/:id/review`), which run no agent. `'review'` at `prs.ts:181`, `'chat'` at `prs.ts:300`, `'merge'` at `prs.ts:315`, `'comment-fix'` in `prCommentFix.ts`, `'implement'` in `fixPipeline.ts`, and the ticket activities in `tickets.ts` and `todos.ts`.

## 2. Engine: the queued fixes in the list

- [x] 2.1 Add a failing test: a pull request with a queued fix and no running job reports that fix as waiting; a pull request with a running fix reports it once, not twice, even though the fix also holds a job.
- [x] 2.2 Read queued fixes from `pr_comment_fixes` alongside the jobs, keyed so a running fix is not listed by both its job row and its fix row.

## 3. Engine: the route

- [x] 3.1 Add failing tests for `GET /agents`: an empty list when nothing runs; a running review named with its pull request title; a lock held without an activity absent; a queued fix present as waiting; each entry carrying its target so the app can open it.
- [x] 3.2 Write the route in a new `engine/src/api/routes/agents.ts` and register it where the other routers are registered.

## 4. Engine: when a review ran

- [x] 4.1 Add failing tests for the review route: a review that finishes writes `reviewed_at`; a review that finds nothing still writes it; a review that throws does not.
- [x] 4.2 Write the column in the review route's `finally`, only when there was no failure.
- [x] 4.3 Add a failing test for `rowToPr` in `engine/src/prs.ts`: the field comes back, null on a pull request never reviewed.
- [x] 4.4 Carry the field through `rowToPr`.
- [x] 4.5 Add a failing test: a landed fix drops the review mark, and a fix that changed nothing keeps it. Answered where Workbench pushes rather than in the poller: `gh search prs` carries no head sha, and reading one per pull request means a worktree per row on every poll. The spec records the limit.
- [x] 4.6 Clear the column after every `pushDetachedHead` on a pull request branch, in `prCommentFix.ts` and `prChat.ts`.

## 5. Client: the running agents list

- [x] 5.1 Add failing tests for the list's own logic in a new `client/src/agentsLogic.ts`: an entry's label per activity; the waiting entries after the running ones; the elapsed text; an empty list reading as nothing running.
- [x] 5.2 Write `agentsLogic.ts` against them.
- [x] 5.3 Add `useRunningAgents` to `client/src/queries.ts`, polled on a beat while the app is open, following `useCommentFixes` for the shape.
- [x] 5.4 Add failing tests for the sidebar: the count appears while something runs, and the entry is absent when nothing does.
- [x] 5.5 Add the count and the entry to `client/src/Sidebar.tsx`.
- [x] 5.6 Write `client/src/AgentsScreen.tsx` with a test: each entry names its activity and target, and opening one for a pull request opens that pull request.

## 6. Client: the reviewed marker

- [x] 6.1 Add failing tests to `client/src/logic.test.ts` for `prRows`: a reviewed pull request carries its reviewed text, an unreviewed one carries none, and GitHub's approved state does not make a row read as reviewed.
- [x] 6.2 Add the field to `PrRow` and fill it in `prRows`.
- [x] 6.3 Show it on the row in `client/src/PRsScreen.tsx`, next to the status label rather than inside it, because they answer different questions.

## 7. By hand

- [x] 7.1 Start a review on one pull request and a comment fix on another. Both appear in the list, named for what they are doing.
- [x] 7.2 Ask for a second fix on a pull request already fixing. It appears as waiting, then turns to running when the first finishes.
- [x] 7.3 Leave the pull request page while a fix runs. The sidebar still says an agent is running.
- [x] 7.4 Sit on the pull request list for two minutes with nothing running. No phantom agent appears from the 30-second review poll.
- [x] 7.5 Review a pull request the agent has nothing to say about. It reads as reviewed.
- [x] 7.6 Restart the engine while a fix runs. Nothing is listed as running.

## 8. Before the pull request

- [x] 8.1 `pnpm lint`, `pnpm typecheck`, `pnpm build` and the test suites in both `engine` and `client`, output reported.
- [x] 8.2 Verify the sidebar count and the reviewed marker in the browser with agent-browser, with a screenshot.

## 9. Not in the plan, needed by it

- [x] 9.1 Teach the migration runner to take a function, not only SQL. `openDb` runs `SCHEMA` before replaying, so a table missing from an older file is created complete and a later `ALTER` on it hits a column that is already there. `jobs` is in `SCHEMA` rather than in any migration, so migration 11 is the first to hit this. Added `addColumn`, which checks `table_info` first. The existing test "keeps SCHEMA and MIGRATIONS in sync" is what proves the two still agree.
- [x] 9.2 Add the activity argument at the ten `acquireJob` call sites in the tests too, and bump the eight `user_version` assertions from 10 to 11.
- [x] 9.3 Fill `Agents` into the two `Record<SidebarSection, string>` maps in `commandPaletteLogic.ts` and the `headerKicker` switch, which the widened union made incomplete.

## 10. Review

Findings from `/code-review high` on the finished diff, all fixed.

- [x] 10.1 `agentsSummary` counted a queued fix as running, so the sidebar said "2 agents running" while the list beside it said "Waiting its turn" about one of them. Running and waiting are counted apart now.
- [x] 10.2 `runFixPipeline` took its pull request lock with activity `implement` while the ticket job in `tickets.ts` already held one, so one pipeline read as two agents, the second on a row with no title because `recordPr` sets none. The pull request lock now passes `null`.
- [x] 10.3 `reviewed_sha` was written and read by nothing. Removed from the schema, the migration, `Pr` and both stores.
- [x] 10.4 The agents list keyed rows on target and timestamp, which two fixes queued in the same millisecond share. `RunningAgent` now carries a `key` that is unique across jobs and fixes.
- [x] 10.5 The sidebar row vanished when the last agent finished, leaving the user on the Agents screen with nothing selected in the nav. The row stays while that section is open and reads "No agents running".

Raised and not acted on: `app/` is untracked with `.build`, `xcuserdata` and `default.profraw` in it, and `.gitignore` does not cover it, so a `git add .` would pull the removed SwiftUI project back in. Left alone because it is not this change's to touch.
