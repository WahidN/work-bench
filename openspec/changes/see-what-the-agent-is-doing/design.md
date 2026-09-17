## Context

Everything this change shows is already in the database. What is missing is a way to ask for
it that does not lie.

Measured on the running setup before writing this:

- `pr_comment_fixes` holds one `running` row and two `landed` rows. The engine works.
- `jobs` holds 648 rows, almost all of them `pr-chat` on a pull request. That type is not
  what the job does. `grep -n 'acquireJob(' engine/src` returns ten call sites, six of
  them `pr-chat`, and two of those six run no agent: the diff route (`prs.ts:148`) and the
  head-sha comparison in `GET /prs/:id/review` (`prs.ts:233`).
- `acquireJob` excludes on `(target_type, target_id)` only. It never reads `type`. So `type`
  is already descriptive, not functional, and it is wrong.

## Decision 1: a column on `jobs`, not a new table

An `agent_runs` table written by `runClaude` would be exact by construction, because
`runClaude` is the single choke point every agent goes through. It was rejected for this
change: `runClaude` does not know which pull request it is working for, so every one of its
eleven callers would have to pass context down, and project chat and the three ticket chats
would come along whether or not they are wanted yet.

Instead `jobs` gets a nullable `activity` column, and `acquireJob` takes it as an argument.
Null means the lock is held by something that is not an agent. The agents list is
`status = 'running' AND activity IS NOT NULL`.

This inherits `reconcileInterruptedJobs` for free, which already flips every running row on
startup. A list built on a new table would need its own reconcile, and getting that wrong
shows a permanent ghost agent after a crash.

The cost is honesty at each call site, which is not enforced by anything. A new lock taken
without thinking gets a null activity and stays invisible. That is the safe direction of the
two: a missing agent is a smaller lie than a phantom one on a 30-second timer.

`type` is left alone. Changing its `CHECK` constraint means rebuilding the table in SQLite,
and migration 5 in this repo exists because a past rebuild repointed foreign keys at
`prs_old`. Not worth it for a descriptive field.

## Decision 2: `reviewed_at` on `prs`, not derived from findings

Deriving from `pr_review_findings` looks free: `MAX(created_at)` per `pr_id`. It is wrong for
the case that matters most. `replaceReviewFindings` deletes then inserts, so a review that
found nothing to say stores nothing at all. Derived, a clean pull request reads as never
reviewed and the user reviews it again.

So the review route writes `reviewed_at` when it finishes, in the same `finally` that calls
`finishJob`, and only on success. A failed review must not mark the pull request reviewed.

Only the time is kept. A `reviewed_sha` beside it was written and then read by nothing: every
finding already carries the commit it was anchored to, and the freshness check below does not
use it either. A second copy of a sha that nothing compares is not a column.

## Decision 3: the list says when, not whether it still holds

`GET /prs/:id/review` computes `outdated` by opening a detached worktree, reading the head
sha, and removing the worktree, all under the job lock. The route's own comment records what
skipping that lock cost: a fix died on `git add -A` with ENOENT after the agent had worked
for seven minutes.

Doing that per row of the list would open one worktree per pull request per read, take the
lock away from the fixes this change is meant to display, and make the list slower the more
work is running. The row says "Reviewed 2h ago". Freshness stays on the detail page, where
one worktree is already being opened.

What clears the mark is therefore only a push Workbench makes itself, from a landed comment
fix or a chat revision. A push from outside leaves the row reading "Reviewed" over a diff the
agent never saw. Clearing on a moved `github_updated_at` was considered and rejected: that
timestamp moves when anyone comments, so the mark would reset constantly and mean nothing.

## Decision 4: where the list lives

A sidebar entry under the existing sections, showing the count while anything runs and
nothing when nothing does. A row names the activity, the pull request title and how long it
has been going, and opens that pull request.

A slide-over was considered, to match `AgentChatPanel`. Rejected: the panel is a conversation
with one agent, this is a list of many, and reusing the panel invites the expectation that
the rows can be talked to. They cannot. A comment fix is headless and has no thread.

## Risks

- Six `acquireJob` call sites change signature in one commit. A missed one is a compile
  error, not a silent bug, because the argument is required.
- The poll adds one request per beat to an engine that already serves a review poll per pull
  request. `GET /agents` is one query on an indexed column and opens no worktree, unlike the
  review poll it sits next to.
- `reviewed_at` on existing rows is null, so every pull request in the database today reads
  as never reviewed until it is reviewed again. That is honest: the sha those old reviews
  were written against was never stored.
