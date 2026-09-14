## Context

See proposal.md for why. What shapes the approach:

- `revisePrChat` in `engine/src/prChat.ts` already does the mechanical part of a fix: open a detached worktree on the branch, run Claude with write tools, commit, push with `--force-with-lease`. It then re-reviews the diff and writes a new PR status, and it runs inside the HTTP request with a 30 minute timeout.
- `POST /prs/:id/review` is the opposite shape, and the one this change follows: acquire the per-pull-request job, answer 202 at once, run the work in a detached async block, finish the job in a `finally`.
- Review remarks live in `pr_review_findings` and are read back by `GET /prs/:id/review`, which reports `running` from the jobs table because an empty list cannot tell a running review from a finished one with nothing to say.
- `prs(id)` currently has three foreign keys into it. Missing one of them in `reconcileGithubPrs` broke every poll cycle for a day (commit 0128ec3).
- `ReviewThreadView` in `client/src/PrDetailScreen.tsx` keys a thread by its first comment's id, which is what the reply route was given.

## Goals / Non-Goals

**Goals:**

- Asking for a fix never refused for being busy, and only one fix at a time touching a pull request's branch.
- A thread that tells the truth about each of its attempts across navigation and restarts.
- A fix that cannot touch a branch on a pull request the user did not write, whichever route it comes in by.

**Non-Goals:**

- A general job queue. A drain per pull request over the lock that already exists is enough, and nothing here is persisted as a queue beyond the rows themselves.
- Retrying a failed fix by itself. The user rewrites the instruction and asks again, which is why a comment keeps every attempt.
- Showing the diff the fix produced. The pull request on GitHub is where that is read.

## Decisions

### A fix path of its own, not `sendPrMessage`

A new `engine/src/prCommentFix.ts` reuses `openDetachedWorktree`, `runClaude`, `commitAll`, `pushDetachedHead` and `removeWorktree` directly.

`sendPrMessage` was the tempting reuse, since it already revises a branch from an instruction. It also decides between merging and revising, stores the text as a chat message, re-reviews the whole diff and rewrites the pull request's status. A fix answering one remark wants none of that, and a fix instruction in the chat transcript reads as something the user said to the agent panel. Calling it would mean passing flags to turn off three of its four behaviours.

### The route pair follows the review, not the chat

`POST /prs/:id/review-comments/:commentId/fix` answers 202 and leaves the work to the drain. `GET /prs/:id/comment-fixes` returns the stored attempts for that pull request.

The state deliberately does not ride along in `GET /prs/:id/detail`. That route calls GitHub and is cached behind `invalidateDetail`, so polling it for a local state change would spend a GitHub request per poll and need a cache invalidation on every state transition. A local-only route is cheap enough to poll while a fix runs.

### One row per attempt, in a table of its own

Migration 10 adds `pr_comment_fixes`: the pull request, the comment id the thread is keyed by, the comment's own text with its path and line, the instruction, a state of `queued`, `running`, `landed`, `nothing` or `failed`, a detail line for the failure or the reason nothing changed, and timestamps.

The comment travels on the row rather than through the request, because the drain runs later than the request that queued it. Re-reading it from GitHub at that point would be a second source of truth for a remark that may have been edited since, and a network call that can fail between the user asking and the agent starting. The table also goes in `SCHEMA`, with the migration repeating it under `IF NOT EXISTS`, exactly as migration 9 did for `pr_review_findings`.

Rows accumulate. A comment can be asked twice, and the second answer must not erase the first: which instruction produced which outcome is the only way to tell a vague instruction from a hard problem. So the store appends, and a thread renders the attempts it finds in order.

A review is one opinion per pull request and gets replaced wholesale, which is why `prReviewStore.ts` is the model to follow rather than the table to reuse. Storing these on the findings table was rejected for a second reason as well: those are remarks the agent wrote, these answer comments that came from GitHub.

`queued` joins the state check by amending migration 10 rather than by adding a rebuild migration after it. SQLite cannot alter a CHECK constraint without rebuilding the table, and the append-only rule exists to protect databases that already ran the migration. This change is not committed, and the only database that has the table is this machine's, where it is empty. The cost is one manual step here: drop the table so `SCHEMA` recreates it at the next engine start.

### Running and waiting are stored states, not derived ones

The row carries `queued` and `running`, and startup reconciliation flips both to `failed` with a reason, alongside `reconcileInterruptedJobs`.

Deriving them from the jobs table the way `GET /prs/:id/review` does was the alternative. It cannot work here: the job is per pull request, so it can say that something is running on this pull request but not which of its threads, nor which attempts are still waiting behind it, and the spec asks each thread to show its own.

### The queue takes the lock, the request does not

The route stores a `queued` row and answers 202. A drain per pull request takes `acquireJob(db, 'pr-chat', 'pr', prId)`, the same lock the review and the diff take, for each attempt in turn, and releases it between attempts so a review is not starved. A drain that cannot take the lock waits and retries rather than failing what is queued: a review takes minutes, and losing a queued fix to it would be a worse answer than a wait the thread reports.

One drain runs per pull request, guarded in process and keyed by database, the way `poller.ts` keys its in-flight guard, so a second request joins the existing drain instead of starting a rival one.

True parallelism was the alternative, and it does not survive contact with `openDetachedWorktree`: its path comes from the branch, so two fixes on one pull request share a directory and the first to finish force-removes it under the second. Giving each attempt its own worktree fixes that and leaves the real problem, which is the branch: both agents commit and push, so one silently loses the other under `--force-with-lease`, or is rejected by it and has to rebase onto work it never saw. Review comments on one file are the normal case, so those conflicts would be normal too. Queueing trades wall-clock time for never losing a fix.

A `queued` row left behind by a stopped engine is failed at startup rather than drained, alongside the `running` ones. launchd starts this engine at login, and an unattended login firing agents at a branch is worse than a thread saying the fix never started.

### The engine commits, the agent does not

The prompt carries the pull request's subject, the comment body, its file and line, and the user's instruction, and tells the agent to change the working tree only. Committing and pushing stay in the engine, as `buildRevisePrompt` already arranges.

The agent decides what to change, not what is published. Letting it commit would put the commit message, the branch and the push under the same 30 minute Claude run that the engine is already going to check the result of.

### No re-review, no status change

The fix does not call `reviewDiff` and does not call `updatePrStatus`.

`revisePrChat` does both, which is right for "revise the whole thing" and wrong here: a remark about one line is not evidence about the whole pull request, and a fix that quietly moved a pull request to `needs_attention` would move it between the user's lists for a reason they never see.

### The gate sits in three places

The composer is not rendered when `pr.authoredByMe` is false. The fix route refuses a pull request the user did not author with 403. And `sendPrMessage` gets the same authorship check on its revise path that its merge path already has.

The client gate alone is a UI convention, not a rule: the route is reachable without it. The third one is the pre-existing hole this change would otherwise sit next to, one condition in a file already being edited, and it is the difference between "the fix button cannot rewrite a colleague's branch" and "one of the two ways in cannot".

### A rejected push is its own outcome

The push is caught separately from the rest of the run and stored as `failed` with the reason that the branch moved on, because `--force-with-lease` rejecting is not a bug and reads nothing like one to the user.

### Landed and failed notify, nothing does not

The announce rule is a pure function over the rows plus an already-announced set, next to `reviewsToAnnounce` in `client/src/notificationLogic.ts`, and `Shell.tsx` calls `notify` for what it returns.

A fix that changed nothing is a prompt to rewrite the instruction, which the user does on the thread they are already looking at. The review's rule makes the same distinction: nothing to post is not worth interrupting for.

### The reply goes, its GitHub helper stays

`POST /prs/:id/review-comments/:commentId/reply`, `usePostReviewReply` and the route's tests in `engine/tests/api/prDetail.test.ts` are removed. `postReviewCommentReply` in `engine/src/sources/githubPrDetail.ts` stays, with its own tests.

`postLineComment` shares that endpoint and was written against it, and posting a review finding still depends on it. Deleting the helper to prove the feature is gone would take the finding flow with it.

## Risks / Trade-offs

- **Anything that opens the pull request's worktree without the job lock deletes the agent's working directory.** `GET /prs/:id/review` did exactly that, and Shell's notification loop calls it for every pull request every 30 seconds, so a fix on a pull request with stored findings lost its worktree within half a minute and died on `git add -A` after the agent had worked for seven minutes. → That route now takes the same lock and skips the staleness check when it cannot have it, which its own comment already permits. Any future reader of a worktree has to do the same.
- **A fourth foreign key into `prs(id)`.** `reconcileGithubPrs` deletes a stored pull request's children before the row, and missing the new table repeats commit 0128ec3 exactly: one refused delete rolls back the whole poll transaction and `POST /poll` answers `FOREIGN KEY constraint failed` with no clue which table. → Delete fix rows in `reconcileGithubPrs` in the same change, with a test that stores a fix and reconciles the pull request away.
- **`--force-with-lease` still loses a race.** A push that lands between the lease being read and the fix pushing is overwritten. → The authorship gate keeps the loss on the user's own branch, where the reflog is theirs. Not solved beyond that.
- **A fix takes minutes and the engine can be stopped mid-run.** → Startup reconciliation flips `running` rows to `failed`. The worktree is removed in a `finally`, and a worktree left by a killed process is `git worktree prune`'s problem, as it already is for the review.
- **Claude can time out at 30 minutes.** → It surfaces as `failed` with the timeout as the reason, the same as any other run failure. No partial commit, because the commit happens after the run returns.
- **The thread key is the first comment's id.** A thread whose first comment is deleted on GitHub loses its stored fix. → Accepted. The outcome is a note about work that already landed on the branch, not the work itself.

## Migration Plan

Migration 10 only adds a table, so an older engine ignores it and a newer one finds it empty. No rollback step: dropping the table loses fix outcomes and nothing else.

The removed reply route is the one breaking step. The app and the engine ship together here, so a client that still calls it would be a client from before this change, which no longer exists once the app is rebuilt.
