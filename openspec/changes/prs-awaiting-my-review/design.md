## Context

See proposal.md - Why for the motivation and `specs/pr-review-queue/spec.md` for the contract.

What constrains the approach:

- `fetchMyOpenPrs` in `engine/src/sources/githubPrs.ts` runs two `gh search prs` calls, `--author=@me` and `--assignee=@me`, merges them by URL into one map, and drops anything whose repository is not a configured project. The two flags it sets, `authoredByMe` and `assignedToMe`, are the only thing distinguishing the two searches afterwards.
- `upsertGithubPr` already overwrites `authored_by_me` and `assigned_to_me` in its `DO UPDATE` clause on every poll, so a per-poll fact is an established pattern in this table rather than something new.
- `prs.project_id` is `NOT NULL REFERENCES projects(id)` and `UNIQUE(project_id, number)`. A pull request cannot be stored without a project, which is what keeps repositories outside Workbench out.
- The live database is at `user_version` 7, so this is migration 8.
- `reconcileGithubPrs(db, projectIds, seen)` deletes stored pull requests that the poll did not see, and the poller already skips that step when a search was truncated. There is exactly one `seen` set for all searches.
- The app's `PrFilter` has three cases and `PRsLogic.keep` decides each one. `.needsReview` is the only case that reads a derived label instead of a stored fact.

## Goals / Non-Goals

**Goals:**

- Discovery, not just filtering. The pull request has to be fetched before any tab can show it.
- A withdrawn or completed review request stops showing without special handling.
- The two existing tabs keep their exact current contents.

**Non-Goals:**

- Pull requests in repositories with no configured project. That needs a nullable `project_id`, a project-less row on every screen that reads `pr.projectId`, and its own reconciliation rule.
- Notifying the user when a new review request arrives. **This was first written asserting that the Today badge's `needsInput` is a separate pipeline. That was wrong**: `getTodayView` built it from every open pull request with no ownership test, so newly stored review requests fed the dock badge and `ContentView`'s newly-appeared notifications. `getTodayView` now excludes a pull request whose only reason for being stored is a review request, which keeps this a non-goal in fact rather than in intent.
- Reviewing, approving or merging a colleague's pull request from Workbench. The chat and the reply drafts already exist and are untouched; whether they behave sensibly on someone else's pull request is a question for a later change.
- Renaming the tab. See the trade-off below.

## Decisions

### A third search, not a second look at what is already fetched

`fetchMyOpenPrs` gains a `--review-requested=@me` call alongside the two it already makes, and a `reviewRequestedByMe` flag on `GithubPr`.

The alternative was to keep the two searches and ask GitHub for reviewers per pull request, with `gh pr view --json reviewRequests`. That cannot work: the pull request is not in the result set to begin with, so there is nothing to ask about. The problem is discovery, and only a search fixes it.

The `search()` helper's parameter type widens from a two-value union to three, and `take()` gains the third key. The merge by URL already handles a pull request appearing in more than one search, which covers the case where the user is both author and reviewer.

### A stored column, not a value derived at read time

Migration 8 adds `review_requested_by_me INTEGER NOT NULL DEFAULT 0` to `prs`, declared and named the same way as `authored_by_me` and `assigned_to_me`, so all three flags read identically in the column list and in the JSON.

The alternative was to derive the review queue from `review_state`, which is what the tab does today. That is precisely the bug: `review_state` describes the pull request's overall review decision, not whether this user was asked for anything. A pull request nobody has reviewed yet reads `review_required` whether the user is a reviewer or not, which is why the tab currently shows the user's own work.

### Overwriting on every poll is what clears a finished review

The flag is written in both halves of the upsert, so each poll restates it from what GitHub currently says. This is the same reason the Jira status columns are overwritten rather than set only on insert.

Two outcomes follow, and both are wanted:

- A pull request that is still in Workbench for another reason, because the user authored it or is assigned, keeps its row and simply loses the flag.
- A pull request that was only ever there for the review request drops out of every search, so it is absent from `seen` and `reconcileGithubPrs` removes it. Leaving the review queue and leaving Workbench are the same event for such a pull request, which is correct: there is nothing left to say about it.

### The new field on `UpsertGithubPrInput` is required, not optional

`reviewRequestedByMe` is declared without `?`, the same as `authoredByMe` and `assignedToMe`.

An optional field defaulting to false would be exactly the footgun the previous decision warns about: a caller that forgets it silently clears a standing review request on the next poll. Required means the compiler names every call site instead. There are five in the tests, two in `prs.test.ts` and three in `poller.test.ts`, plus the one real caller in the poller, so the cost of being explicit is small and one-off.

### The truncation guard covers all three searches

The existing `truncated` flag ORs the two searches. It gains the third. The poller already skips reconciliation entirely when the flag is set, so a capped review-requested search cannot make it delete stored pull requests. Nothing else changes there.

### Only `keep` changes in the app

`PRsLogic.keep` for `.needsReview` becomes `pr.reviewRequestedByMe == true && !pr.isDraft`. `statusLabel` is left alone, and so are the other two filter cases.

The draft half is not decoration. The predicate being replaced ran through `statusLabel`, which answers "Draft" before it looks at the review state, so a draft never entered the queue. Dropping the guard would have let a colleague queue unfinished work by requesting reviewers early.

The new field on `PullRequest` is optional, because Swift's synthesized `Decodable` ignores property defaults and a non-optional field would break decoding of any payload written before this change.

The empty state text currently reads "Pull requests you open or get assigned show up automatically", which is now an incomplete promise and has to mention review requests.

## Risks / Trade-offs

- **The tab label and the row badge will mean different things.** `statusLabel` returns the string "Needs review" for a pull request whose review decision is still open, so a row in the "Needs review" tab can show the badge "Approved" when a colleague approved it while the user's own request still stands. → Accepted for now, and the honest reading is that the tab means "needs my review". Renaming it to "To review" would remove the collision and is a one-line change if it grates in use.
- **A pull request the user did not author has never actually been stored.** Every one of the 7 current rows has `authored_by_me = 1`. `fetchPrDetail` returns `headRefName` specifically so the agent panel can build a worktree for a pull request this engine did not create, so the path was designed for, but it is unproven. → Manual verification opens `acv-website#45` and looks at its detail view and diff before this is called done.
- **One extra `gh pr view` per newly visible pull request per cycle.** → Bounded by the same 100 result cap the other searches use, and the poller already makes one such call per stored pull request.
- **A review request on a repository with no project stays invisible with no explanation.** `linku-bergop4/bergop4-portal-app#101` is a real current example. → Out of scope by decision, and the fix is for the user to add that repository as a project. Worth revisiting if it happens often.

## Migration Plan

Migration 8 is one `ALTER TABLE prs ADD COLUMN`. Existing rows get 0, so every stored pull request reads as not awaiting review until the first poll after the change, which then fills the column in from GitHub. The tab is briefly empty in that window, which is accurate rather than wrong.

Rollback: reverting the code leaves the column in place and unread, which is harmless. No data is lost either way, since the column only mirrors what GitHub can be asked again.
