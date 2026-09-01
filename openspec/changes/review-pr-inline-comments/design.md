## Context

See proposal.md for motivation. What shapes the approach:

- `src/review.ts` already reviews a diff, but returns `ReviewScore`: five numbers plus `findings: string[]` with no file or line anchors. `fixPipeline.ts` and `prChat.ts` both read the score and decide pass or fail from it.
- `GET /prs/:id/diff` already opens a detached worktree, diffs against the default branch and removes the worktree. The review reuses that shape exactly.
- `openDetachedWorktree` runs `git fetch origin <branch>`, so a pull request from a fork, whose branch is not on origin, already fails there today.
- `postReviewCommentReply` posts to `repos/{slug}/pulls/{n}/comments` with `in_reply_to`. The same endpoint without `in_reply_to`, plus `commit_id`, `path`, `line` and `side`, creates a new comment anchored to a line.
- `getDiff` returns a unified diff. Its `@@ -a,b +c,d @@` headers, with the `+` and context lines that follow, are enough to know every line a comment can be anchored to.

## Goals / Non-Goals

**Goals:**

- Reviewing is read-only by construction, not by convention.
- A published comment lands on the line it is about, or is not published at all.
- The user sees every remark before the author does.

**Non-Goals:**

- Reviewing a pull request from a fork. It fails today on the existing diff path for the same reason, and fixing that is its own change.
- Storing reviews. Nothing survives a restart, so there is no schema change.
- Any change to `ReviewScore` or the pipeline and chat that read it.
- Replying to review threads. That already exists and is untouched.

## Decisions

### A separate module, not an extension of `reviewDiff`

`src/prReview.ts`, alongside `prChat.ts` and `prReplyDraft.ts`.

The existing review answers "is this work good enough to merge", and its output is a verdict. This one answers "what should I say about this code, and where", and its output is anchored remarks. Same word, different questions.

*Alternative considered:* widen `ReviewScore` with an optional path and line per finding. Rejected: it would make every existing caller carry fields it has no use for, and the pass or fail rule in `reviewPasses` would still be computed and still ignored here. Two functions with distinct outputs are simpler than one with a mode.

### The commit to anchor against comes from the worktree, not from GitHub

`commit_id` is `git rev-parse HEAD` in the same detached worktree the diff was taken from.

The line numbers in a finding are only meaningful against the diff they were derived from. Taking the sha from that same checkout makes the anchor and the diff agree by construction. Fetching `headRefOid` from GitHub separately would introduce a second source of truth that can disagree with the diff already in hand, and the failure would be a comment on the wrong line rather than an error.

This also means `VIEW_FIELDS` does not need the head sha, so `fetchPrDetailView` is untouched.

*Consequence:* if someone pushes to the branch between the review and the publish, the comments anchor to the commit that was reviewed. GitHub marks them outdated, which is truthful: they were written about that code.

*Alternative considered:* re-fetch and re-diff at publish time. Rejected: the user would publish remarks they never read, about code they never saw.

### Anchors are validated against the diff, and only the right-hand side

A pure function parses the diff into the set of `(path, line)` pairs a comment can attach to: for each hunk, the lines on the new side, meaning added `+` lines and unchanged context lines. A finding is publishable only if its pair is in that set.

Only `side: RIGHT` is supported. A remark about deleted code would need `side: LEFT` and a different line basis, and the model would have to choose correctly between them. The narrow rule is worth more than the rare case: "comment under the code" is about code that is there.

*Alternative considered:* post and let GitHub reject bad anchors. Rejected: GitHub's 422 does not distinguish a line outside the diff from other faults, and a partially posted review is not something the user can undo in one action.

### Read-only is enforced by the tools, not by the prompt

The review runs with `allowedTools: ['Read', 'Grep', 'Glob']`, the same set `draftReviewReply` uses. No `Write`, no `Edit`, no `Bash`.

A prompt saying "do not change anything" is a request. A tool list is a boundary. This is what makes "reviewing changes nothing" a property of the system rather than of the model's cooperation.

### The draft is a sheet

The review can start from a list row or from the detail header, so its result has to be presentable over either. A sheet is the one presentation that works from both without the list needing to navigate somewhere first.

It holds a list of findings, each with its file and line, an editable remark, and a discard control, plus a list of anything discarded for not being anchorable so the user can see the review was not silently trimmed.

*Alternative considered:* a panel on the detail screen only, with the row button navigating there first. Rejected: it makes the row button a navigation control that also starts a slow job, which is two things at once.

*Flagged for the user:* this is a design-level call, not one that was explicitly decided. It is easy to change to a panel later; the API and the engine do not depend on it.

### Publishing posts one comment at a time and reports each

Each finding is a separate call. The response says which succeeded and which failed, and the sheet keeps anything that did not post.

The endpoint has no batch form, so a single call is not on offer. Given that, reporting per finding is what lets the user retry the two that failed instead of re-posting the six that worked.

### Two routes

- `POST /prs/:id/review` runs the review and returns the anchorable findings and the discarded ones. Writes nothing.
- `POST /prs/:id/review/publish` takes the findings the user confirmed and posts them.

The user's edits are sent back at publish time, so the engine holds no draft state between the two calls. That is what keeps "what is published is what the user last saw" true without a store.

## Risks / Trade-offs

**The model invents a line number that is not in the diff** → The anchor validation discards it and says so. This is expected often enough that the discarded list is part of the interface, not an error path.

**The model anchors a real finding to the wrong line** → Not detectable by the system: the line is in the diff, so it validates. The user reads every remark with its file and line before publishing, which is the actual mitigation and part of why publishing is a separate action.

**A fork pull request cannot be reviewed** → `openDetachedWorktree` fails on `git fetch origin <branch>`. Inherited from the existing diff path. The failure must name the cause rather than surface as a bare 500, because the Needs review tab is mostly other people's pull requests and some will be forks.

**The review is slow** → It runs the agent over a whole diff, so minutes, not seconds. The button reports that a review is running and refuses a second one. No timeout beyond the existing agent call timeout.

**Too many remarks on one pull request** → Per-finding discard is the release valve. The prompt asks for findings worth a colleague's time rather than an exhaustive list.

**Publishing partially fails** → Reported per finding, and what failed stays in the sheet. The trade-off accepted here is that a retry could double-post a comment that actually succeeded but reported a failure; the endpoint has no idempotency key, and the user can see and delete a duplicate on GitHub.

**Comments are posted under the user's own GitHub account** → They are indistinguishable from remarks the user wrote. That is the point, and it is also why nothing is posted without an explicit action on text the user has read.

## Open Questions

- The exact wording of the prompt, in particular how strongly to bias towards few, high-value remarks. Answerable from the first real run against a live pull request without changing the specs, the routes or the task breakdown.
