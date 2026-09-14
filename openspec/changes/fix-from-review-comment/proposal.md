## Why

A review comment on a pull request says what is wrong with one line of code. The box under it posts a text reply to GitHub, so the only thing the user can do with that remark inside Workbench is talk about it. Answering a reviewer in words is work that belongs on GitHub, where the reviewer is. Acting on the remark is work that belongs in Workbench, where the agent and the checkout are.

The box already sits under the comment that names the file, the line and the problem. That makes it the right place to say what to change, and the wrong place to write prose.

## What Changes

- The composer under a review thread hands its text to the agent as a fix instruction. **BREAKING**: posting a reply to GitHub from that box is removed. Replying to a reviewer moves to GitHub itself.
- The composer is offered only on a pull request the user authored, the same gate Merge already uses, because the fix commits and pushes to the branch. On a pull request someone else wrote, the thread shows its comments and says to reply on GitHub. This is an accepted loss.
- The agent receives the thread, not just the sentence: the comment body, the file and line it hangs on, and the user's own words. A fix instruction that says "do this" is useless without the remark it answers.
- A fix runs in the background. The request returns at once, the app stays usable, and a notification names the pull request when the fix lands. Same pattern as a review, and for the same reason: Claude editing code takes minutes.
- Several fixes can be asked for without waiting for the last one. They queue per pull request and run one at a time, because two agents on one branch share a worktree and force-push over each other, and review comments on one file are the normal case rather than the rare one.
- Each attempt carries its own outcome, and a comment can hold several of them. A running attempt survives leaving the screen, and a restart does not leave one looking as if it were still running.
- A fix commits and pushes to the pull request's branch with `--force-with-lease`. It does not re-review the pull request and does not touch its status. A fix scoped to one remark has no business deciding the whole pull request is now in a different state.
- `sendPrMessage` gets the authorship check the merge path already has. Today only merging is gated, so the agent panel will rewrite a branch on a pull request the user did not write. That hole is not new, but this change puts a fix button next to every review comment, so it is closed here rather than left next to it.

### Not in scope

- Replying to a reviewer from inside Workbench, in any form.
- The review findings the agent produces itself. Posting, editing and discarding those is unchanged.
- The agent panel and its chat. Only the missing authorship check changes there.
- Any fix path that pushes to a branch the user does not own.

## Capabilities

### New Capabilities

- `pr-comment-fix`: the user hands a review comment to the agent from the thread it sits in, the agent changes the branch to answer it, and the result comes back without the user waiting on screen.

### Modified Capabilities

None. `openspec/specs/` is still empty, so there is no existing spec to amend. The reply composer this change replaces was ported from the Swift app and was never specified.

## Impact

**Engine**

- `engine/src/api/routes/prs.ts`: a route that asks for a fix on one review comment, and a route that reports what became of them. The first follows `POST /prs/:id/review` in shape, answering 202 and running the work detached, but it queues rather than taking the pull request's job itself. `POST /prs/:id/review-comments/:commentId/reply` goes.
- A store for the attempts, with a migration. A review is one row per pull request; a fix is one row per attempt, several of which can belong to one comment. `prReviewStore.ts` is the model to follow rather than the table to reuse.
- `engine/src/prChat.ts`: the prompt that carries a comment, and the authorship check in `sendPrMessage`. `buildRevisePrompt` interpolates only the subject and the instruction today.
- `engine/src/sources/githubPrDetail.ts`: `postReviewCommentReply` stays. `postLineComment` shares its endpoint and its tests, and posting findings still needs it.

**App**

- `client/src/PrDetailScreen.tsx`: `ReviewThreadView` gets the fix action, the authorship gate, and each attempt with its own outcome.
- `client/src/queries.ts`: `usePostReviewReply` goes. A mutation to start a fix and a query for its state arrive.
- `client/src/notificationLogic.ts` and `client/src/Shell.tsx`: a finished fix is announced the way a finished review is, once, with the pull request named.

**Not affected**

- The review findings flow, the merge button, the pull request list, and the tabs.
- Which pull requests are stored or polled.

**Risk**

- `--force-with-lease` still loses a race against a push that landed after the lease was read. The gate limits the damage to the user's own branch.
- A fix and a review both open the pull request's worktree, so they share one lock. A queued fix waits for a running review rather than failing, and the thread has to say it is waiting so the delay is not mistaken for a fix doing nothing.
- The agent can commit nothing at all. `revisePrChat` already treats an empty commit as an answer rather than a failure, and the thread has to say so instead of reporting success.
- A fix that fails must leave no worktree behind, including when Claude times out at 30 minutes.
