# Tasks

Tests first in each group, then the code that answers them. Section 8 is the part no test covers: a real pull request, a real branch, a real push.

## 1. Engine: where a fix's outcome lives

- [x] 1.1 Add `pr_comment_fixes` to `SCHEMA` in `engine/src/db.ts`: `id`, `pr_id` referencing `prs(id)`, `comment_id`, `instruction`, `state` checked against `('running','landed','nothing','failed')`, `detail`, `created_at`, `finished_at`, plus an index on `pr_id`. One row per comment, so no unique constraint on `pr_id`.
- [x] 1.2 Append migration 10, the same table under `CREATE TABLE IF NOT EXISTS`, with the comment migration 9 carries: `SCHEMA` already made it on a fresh file, and a database stamped back replays this over a table that is there.
- [x] 1.3 Add failing tests for `engine/src/prCommentFixStore.ts`: starting a fix stores it as `running`; finishing writes the state, the detail and `finished_at`; a second fix on the same comment replaces the first, because a thread shows one outcome; listing returns one row per comment for that pull request, ordered by id; reconciling flips every `running` row to `failed` with a reason.
- [x] 1.4 Write `engine/src/prCommentFixStore.ts` against those tests, following `prReviewStore.ts` for the row mapping and the prepared statements.
- [x] 1.5 Add a failing test to the `reconcileGithubPrs` tests: a pull request with a stored fix is reconciled away without a foreign key error, and the fix row goes with it. This is the fourth foreign key into `prs(id)` and commit 0128ec3 is what missing one costs.
- [x] 1.6 Delete fix rows in `reconcileGithubPrs` in `engine/src/prs.ts`, next to `deleteFindings`.

## 2. Engine: the fix

- [x] 2.1 Add failing tests for the prompt builder in `engine/src/prCommentFix.ts`: it names the file and the line, carries the comment body and the user's instruction verbatim, states the pull request's subject, and tells the agent to change the working tree and not to commit or push.
- [x] 2.2 Write the prompt builder. Keep it exported and pure, so the wording is testable without running anything.
- [x] 2.3 Add failing tests for `runCommentFix` with the git and Claude calls stubbed: it refuses a pull request the user did not author before any worktree is opened; a run that changes nothing stores `nothing` and never pushes; a successful run commits then pushes then stores `landed`; a rejected push stores `failed` with the branch-moved-on reason; any failure removes the worktree; it never calls `reviewDiff` and never calls `updatePrStatus`.
- [x] 2.4 Write `runCommentFix`, reusing `openDetachedWorktree`, `runClaude` with the same tool list and timeout `revisePrChat` uses, `commitAll`, `pushDetachedHead` and `removeWorktree`.

## 3. Engine: the routes

- [x] 3.1 Add failing tests for `POST /prs/:id/review-comments/:commentId/fix`: 404 on an unknown pull request; 400 on a missing or blank instruction; 403 on a pull request the user did not author, with nothing stored; 409 when the pull request's job is already held, naming what holds it; 202 otherwise, with the row stored as `running` before the response.
- [x] 3.2 Add failing tests for `GET /prs/:id/comment-fixes`: the stored rows for that pull request only, and an empty list rather than a 404 when there are none.
- [x] 3.3 Write both routes in `engine/src/api/routes/prs.ts`, following `POST /prs/:id/review` for the shape: `acquireJob(db, 'pr-chat', 'pr', prId)`, answer, then the detached async block with `finishJob` in a `finally`.
- [x] 3.4 Remove `POST /prs/:id/review-comments/:commentId/reply` and its tests in `engine/tests/api/prDetail.test.ts`. Leave `postReviewCommentReply` and its own tests alone: `postLineComment` shares that endpoint and posting a finding still needs it.

## 4. Engine: close the hole in the chat

- [x] 4.1 Add a failing test for `sendPrMessage`: a non-merge message on a pull request the user did not author is refused, and no worktree is opened. Today only the merge path checks `authoredByMe`, so the agent panel will force-push over a colleague's branch.
- [x] 4.2 Move the authorship check in `engine/src/prChat.ts` so it covers the revise path too, and say in the refusal what the user can do instead.

## 5. Engine: after a restart

- [x] 5.1 Add a failing test: a database with a `running` fix row, opened and reconciled, reports that fix as failed rather than running.
- [x] 5.2 Call the store's reconcile where `reconcileInterruptedJobs` is called in `engine/src/index.ts`.

## 6. App: the thread

- [x] 6.1 Add failing tests to `client/src/PrDetailScreen.test.tsx` for `ReviewThreadView`: on an authored pull request the composer is there and its action starts a fix; on a pull request the user did not author there is no composer and the thread says replying happens on GitHub; a blank instruction does not start anything; a thread with a `running` fix says so and does not offer a second; `landed`, `nothing` and `failed` each read differently, and `failed` shows its reason.
- [x] 6.2 Add the fix mutation and the comment-fixes query to `client/src/queries.ts`, and delete `usePostReviewReply`.
- [x] 6.3 Rewrite `ReviewThreadView`'s composer against the tests: the fix action, the authorship gate, and the four outcome states. The comments themselves stay as they are.
- [x] 6.4 Poll the comment-fixes query while a fix on the open pull request is running, and stop when nothing is running. Same reason the review is polled: nothing else tells the screen it finished.

## 7. App: the notification

- [x] 7.1 Add failing tests to `client/src/notificationLogic.test.ts` for the announce rule: a `landed` fix is announced once, naming its pull request; a `failed` fix is announced; a `nothing` fix is not; an already-announced fix is not announced again.
- [x] 7.2 Write the rule next to `reviewsToAnnounce`, and call `notify` from `Shell.tsx` where the review's notification is sent.

## 9. Engine: the queue

- [x] 9.1 Amend migration 10 and `SCHEMA` so `state` also allows `queued`. Not a rebuild migration after it: SQLite cannot alter a CHECK constraint without rebuilding, this change is not committed, and the only database holding the table is this machine's, where it is empty. Drop that table so `SCHEMA` recreates it, and restart the engine.
- [x] 9.2 Update the store tests: starting stores `queued` rather than `running`; a second fix on the same comment appends rather than replacing, and both are listed in order; reconciling fails a `queued` row as well as a `running` one.
- [x] 9.3 Rewrite `startCommentFix` to insert `queued` and to stop deleting the comment's earlier rows. Add `claimNextQueuedFix(db, prId)`, which takes the oldest `queued` row for that pull request and marks it `running` in one transaction, and `markCommentFixRunning` if that reads better.
- [x] 9.4 Add failing tests for the drain in `engine/src/prCommentFix.ts`: it works through the queued attempts of one pull request in the order they were asked for; it takes and releases the pull request's job lock per attempt; it retries rather than failing when the lock is held; it stops when the queue is empty; a second call while it is draining does not start a rival drain.
- [x] 9.5 Write `drainCommentFixes`, with the in-process guard keyed by database the way `poller.ts` keys its in-flight guard.

## 10. Engine: the route stops refusing

- [x] 10.1 Update the route tests: a busy pull request no longer answers 409, it queues and answers 202 with the row stored as `queued`; three requests on one pull request all answer 202; the 400, 404 and 403 cases are unchanged.
- [x] 10.2 Take `acquireJob` out of the route. It stores the row, answers 202 and kicks the drain. Keep `runningJob` only if the 409 for something else still needs it, otherwise drop it and put `isJobRunning` back the way it was.

## 11. App: several attempts per thread

- [x] 11.1 Update the thread tests: a comment with two attempts shows both, in order, each with its own instruction and outcome; a `queued` attempt says it is waiting rather than running; the composer stays available while an attempt is queued or running; the running-fix test that asserted no second is offered goes.
- [x] 11.2 Pass every attempt for a comment to `ReviewThreadView` rather than one, and render them as a list. Add the `queued` label and colour.
- [x] 11.3 Keep the notification quiet about `queued`, and confirm `fixesToAnnounce` still only announces `landed` and `failed`.

## 8. Verify for real

- [ ] 8.1 On a pull request you wrote, with a real review comment on it, write an instruction and start a fix. The composer reports it running, and the app stays usable while it runs. Move to another screen and back.
- [ ] 8.2 Wait for it to finish and confirm a notification arrives naming that pull request.
- [ ] 8.3 Confirm on GitHub that the branch has a new commit, that it changes what the comment asked about, and that no reply was posted to the thread.
- [ ] 8.4 Confirm the pull request's status and which lists it appears in are what they were before the fix.
- [ ] 8.5 Open a review comment on a pull request someone else wrote. There is no composer, and the thread says to reply on GitHub. This is the loss this change accepts, so look at it and decide it reads sensibly.
- [ ] 8.6 Start a fix, and while it runs start a review of the same pull request. It is refused with a reason rather than queued or ignored.
- [ ] 8.7 Give a deliberately impossible instruction and confirm the thread says nothing was changed, that nothing was pushed, and that a second, clearer instruction can be started afterwards.
- [ ] 8.8 Restart the engine while a fix is running. The thread reports it as failed rather than running forever, and a new fix can be started.
- [ ] 8.9 Push a commit to the branch by hand while a fix is running, and confirm the fix reports that it could not publish instead of overwriting it.
- [ ] 8.10 Confirm `.worktrees` under the project's repository holds nothing left over, including after the failed runs above.
- [ ] 8.11 Run a poll with a stored fix on a pull request that has since been merged, and confirm `POST /poll` succeeds. A foreign key error here is 1.6 not working, and it takes the whole poll cycle with it.
- [ ] 8.12 In the agent panel, send a non-merge message on a pull request you did not write, and confirm it is refused and that the branch is untouched.
- [ ] 8.13 Ask for a fix on three comments of one pull request without waiting. All three are accepted, one says it is running and the other two say they are waiting.
- [ ] 8.14 Watch them run in the order you asked for them, one at a time, and confirm each thread ends up with its own outcome.
- [ ] 8.15 Ask for a fix while a review of that pull request is running. It waits rather than failing, and starts once the review has finished.
- [ ] 8.16 Ask twice on one comment with different instructions, and confirm the thread keeps both attempts rather than replacing the first.
- [ ] 8.17 Restart the engine with attempts queued behind a running one, and confirm the queued ones are reported as not started rather than left waiting forever, and that nothing starts by itself at the next login.
