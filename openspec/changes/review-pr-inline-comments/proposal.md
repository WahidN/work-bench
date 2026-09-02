## Why

The Needs review tab now collects the pull requests colleagues are waiting on the user for, but Workbench offers nothing to do with them. Reviewing still means leaving for GitHub and reading the diff by hand.

The one path that already reviews code is the pull request chat, and it is the wrong instrument: it revises the branch, commits and pushes. Reviewing someone else's work must change nothing. What is missing is a read-only review that produces remarks on specific lines and puts them where the author will see them, which is on the pull request itself.

## What Changes

- A **Review this PR** button, on each row in the Pull requests list and in the pull request detail header.
- A read-only review that opens a detached worktree, reads the diff, and produces findings that each name a file, a line and a remark. It never commits, never pushes and never changes the branch.
- **The review runs in the background.** Starting one does not block the screen it was started from, and the user carries on working while it runs, which matters because it takes minutes.
- **A notification when it finishes**, because a result nobody is waiting in front of has to announce itself.
- The findings are **kept until the user deals with them**, and are read on the pull request's own detail page. They survive navigating away, and they survive the engine restarting.
- Each remark is posted **one at a time**, on its own. Posting is a separate, explicit action per comment, following the rule already established for review comment replies: text that lands in a repository other people read is never posted as a side effect.
- Posting writes a finding as a standalone inline comment anchored to its line on GitHub, using the pull request comments endpoint already used for threaded replies.
- **No summary comment, no scores, no branding.** Only remarks under the code they are about.
- A finding whose file and line cannot be matched to the diff is never posted. Line numbers are generated text, and a comment posted against a line that is not in the diff is either rejected by GitHub or, worse, silently anchored somewhere misleading.
- Findings written before the branch moved on are **marked as written against an earlier commit** rather than deleted or silently kept.

Deliberately not included, and both are consequences the user accepted:

- These are plain comments, not a submitted GitHub review, so **the review request stays open and the pull request stays in the Needs review tab.** Finishing the review is still done on GitHub.
- The existing scored review (`ReviewScore`, with correctness, completeness, quality, tests and regression risk) is **not** reused and not extended. It stays exactly as it is for the fix pipeline and the chat, which are the only things that read a score.

## Capabilities

### New Capabilities

- `pr-code-review`: reviewing the code of a pull request on demand and in the background, keeping the resulting remarks until the user deals with them, and publishing them as inline comments on the pull request one at a time, each on the user's own say-so.

### Modified Capabilities

None. `pr-review-queue` describes which pull requests are collected and how they are listed, and none of those requirements change: a reviewed pull request stays in the queue exactly as it does today, because a plain comment does not satisfy GitHub's review request.

## Impact

**Engine**

- A new review module, separate from `src/review.ts`. That file's `reviewDiff`, `buildReviewPrompt` and `isReviewScore` keep their current shape and behaviour, because `fixPipeline.ts` and `prChat.ts` depend on the score.
- **A new table and migration 9**, holding each finding with the commit it was written against and whether it has been posted. This is what lets a review outlive the request that started it. See design.md for why it cannot be avoided.
- New routes on `src/api/routes/prs.ts`: start a review in the background, read a pull request's stored findings, post one, discard one.
- `src/sources/githubPrDetail.ts` gains one write, for posting a comment anchored to a line. Its read fields are unchanged: the commit an inline comment needs is taken from the same working copy the diff came from, so the anchor and the diff cannot disagree. See design.md.
- Diff parsing, to know which file and line pairs a comment can legally be anchored to.

**App**

- `PRsScreen.swift`: a review button on `PrTableRow`, beside the existing pin and agent buttons.
- `PrDetailScreen.swift`: a review button in the header, and the review itself as a section of the page, each remark with its own post and discard controls.
- A view model over the stored findings, and a notification when a review finishes.
- `APIClient`: the new calls.

**Not touched**

- `prChat.ts` and the agent chat panel. The chat keeps revising; the review never routes through it.
- `getTodayView`'s `needsInput`, which deliberately keeps review-requested pull requests out of the badge and its notifications. The review's own notification does not go through it. See design.md.
