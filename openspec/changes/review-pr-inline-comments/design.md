## Context

See proposal.md for motivation. What shapes the approach:

- `src/review.ts` already reviews a diff, but returns `ReviewScore`: five numbers plus `findings: string[]` with no file or line anchors. `fixPipeline.ts` and `prChat.ts` both read the score and decide pass or fail from it.
- `GET /prs/:id/diff` already opens a detached worktree, diffs against the default branch and removes the worktree. The review reuses that shape exactly.
- `openDetachedWorktree` runs `git fetch origin <branch>`, so a pull request from a fork, whose branch is not on origin, already fails there today.
- `postReviewCommentReply` posts to `repos/{slug}/pulls/{n}/comments` with `in_reply_to`. The same endpoint without `in_reply_to`, plus `commit_id`, `path`, `line` and `side`, creates a new comment anchored to a line.
- `getDiff` returns a unified diff. Its `@@ -a,b +c,d @@` headers, with the `+` and context lines that follow, are enough to know every line a comment can be anchored to.
- `jobs.ts` already runs work in the background: `acquireJob` and `finishJob` over a `jobs` table with running, done and failed, and `reconcileInterruptedJobs`, which marks anything still running at startup as `interrupted` with "engine restarted mid-job".
- The app already notifies: `AppDelegate.notify(title:body:)` over `UNUserNotificationCenter`, driven from a 15-second polling loop in `ContentView` that diffs `todayViewModel.needsInput` and notifies on newly appeared items.

## Goals / Non-Goals

**Goals:**

- Reviewing is read-only by construction, not by convention.
- A published comment lands on the line it is about, or is not published at all.
- The user sees every remark before the author does.
- A review outlives the request that started it: the user starts it, walks away, and finds it waiting.

**Non-Goals:**

- Reviewing a pull request from a fork. It fails today on the existing diff path for the same reason, and fixing that is its own change.
- Any change to `ReviewScore` or the pipeline and chat that read it.
- Replying to review threads. That already exists and is untouched.
- Editing a remark after it has been posted. Once it is on GitHub it is GitHub's, and the existing reply flow is where a follow-up belongs.

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

### The review is stored, which means a migration

**This reverses an earlier decision.** The first cut kept nothing: a review was run, shown in a sheet, and posted or thrown away, so there was no schema change.

That cannot survive the interaction the user actually wants. The review runs in the background, finishes while they are on another screen, announces itself, and is read later on the pull request's own page. Between finishing and being read there is nowhere for the findings to live except the database, and "survives the engine restarting" rules out memory even as a shortcut.

So: a new table, migration 9, one row per finding, holding the pull request it belongs to, the path, the line, the body, the commit sha the review was written against, and whether it has been posted. Discarding a finding removes its row.

*Alternative considered:* keep the findings in the app and persist them there. Rejected: the review runs in the engine, and the app is not running when the engine is. It would also put the record of what was said about a colleague's code in a place nothing else in this system keeps state.

### The findings live on the pull request's page

**This reverses the "draft is a sheet" decision**, which was flagged as a design-level call the user could overturn. They overturned it after using it.

A sheet is a thing you deal with now. These findings are not: they arrive when the user is elsewhere, and the point of storing them is that they can be dealt with whenever. A section of the pull request's own page is where something that belongs to that pull request and waits for attention should sit, next to the diff it is about.

The row button in the list therefore starts a review and nothing else. It does not open anything, because there is nothing to open yet.

### The review runs as a job and the route returns at once

`POST /prs/:id/review` records the job, starts the work and returns. It does not await the review, because the agent takes minutes and an HTTP call held open that long is a request that fails for reasons unrelated to the work.

The existing `jobs` table is the record of what is running, which is also what makes "do not start a second review of this pull request" the same check it already is for the diff route and the chat.

`reconcileInterruptedJobs` already marks anything still running at startup as `interrupted`. That is what stops a review killed by a restart from looking like it is still going, and it is why the engine restarting is a case the spec can make a promise about.

### The notification gets its own signal, not `needsInput`

`needsInput` is the obvious hook: it already drives the badge and already produces "newly appeared" notifications on a 15-second poll.

It is the wrong one. `getTodayView` filters review-requested pull requests out of `needsInput` on purpose, with the reasoning recorded in the code: a colleague's pull request arriving because a review was requested is not worth interrupting the user with. Hanging the review notification off that list would drag those pull requests back into the badge and quietly undo that decision.

The two are different events anyway. That decision was about work arriving unbidden. This is about work the user themselves started, finishing. So the review notification comes from its own signal: pull requests with unposted findings the user has not been told about yet.

*Alternative considered:* widen `needsInput` and re-filter at the notification site. Rejected: it makes one list mean two things and leaves the badge wrong.

### Posting trusts the commit the review was written against

Each finding carries the sha its line numbers were read from. Posting sends that sha and does not re-open a worktree.

Re-validating per post would mean a `git fetch` and a checkout on every single click, which turns a one-second action into a several-second one and does it once per comment. GitHub already validates the anchor and answers 422 when it will not take it, and GitHub is the authority on that question, not a local re-derivation of it.

*Consequence:* a comment can be posted against a commit that is no longer the head. GitHub marks it outdated, which is honest: it was written about that code.

*Alternative considered:* re-diff before each post. Rejected on cost, and it would not be more correct, only slower to reach the same answer.

### An outdated review is marked, not deleted

When the pull request's head has moved past the sha a finding was written against, the finding is shown as written against an earlier commit and stays postable.

Deleting it would throw away work the user asked for on the grounds of a guess about whether it still applies. Saying nothing would let them post a remark about code that changed without knowing. Marking it puts the judgement where it belongs.

### The routes

- `POST /prs/:id/review` starts a review in the background and returns immediately.
- `GET /prs/:id/review` returns the stored findings for a pull request, with whether they are outdated.
- `POST /prs/:id/review/findings/:findingId` posts that one finding, with the body the user last saw.
- `DELETE /prs/:id/review/findings/:findingId` discards that one.

The body travels with the post rather than being saved on every keystroke, so an edit the user makes and then abandons never becomes the stored text.

## Risks / Trade-offs

**The model invents a line number that is not in the diff** → The anchor validation discards it and says so. This is expected often enough that the discarded list is part of the interface, not an error path.

**The model anchors a real finding to the wrong line** → Not detectable by the system: the line is in the diff, so it validates. The user reads every remark with its file and line before posting it, which is the actual mitigation and part of why each post is its own action.

**A fork pull request cannot be reviewed** → `openDetachedWorktree` fails on `git fetch origin <branch>`. Inherited from the existing diff path. The failure must name the cause rather than surface as a bare 500, because the Needs review tab is mostly other people's pull requests and some will be forks. Now that the review is a background job, this failure has to reach the user through the job rather than through the response to the button.

**The review is slow** → It runs the agent over a whole diff, so minutes, not seconds. This is why it is a background job at all. The button reports that a review is running and refuses a second one.

**Too many remarks on one pull request** → Per-finding discard is the release valve. The prompt asks for findings worth a colleague's time rather than an exhaustive list.

**A post reports failure but actually succeeded** → The finding stays unposted and the user can post it again, which duplicates the comment. The endpoint has no idempotency key. Accepted: a visible duplicate the user can delete on GitHub is better than a remark silently lost.

**Stored findings accumulate** → Nothing expires them. A pull request reviewed and never dealt with keeps its rows indefinitely. Accepted for now: the volume is one row per remark per review, and the user posting or discarding is what clears them.

**Comments are posted under the user's own GitHub account** → They are indistinguishable from remarks the user wrote. That is the point, and it is also why nothing is posted without an explicit action on text the user has read.

## Open Questions

- The exact wording of the prompt, in particular how strongly to bias towards few, high-value remarks. Answerable from the first real run against a live pull request without changing the specs, the routes or the task breakdown.
