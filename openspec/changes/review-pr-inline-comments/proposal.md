## Why

The Needs review tab now collects the pull requests colleagues are waiting on the user for, but Workbench offers nothing to do with them. Reviewing still means leaving for GitHub and reading the diff by hand.

The one path that already reviews code is the pull request chat, and it is the wrong instrument: it revises the branch, commits and pushes. Reviewing someone else's work must change nothing. What is missing is a read-only review that produces remarks on specific lines and puts them where the author will see them, which is on the pull request itself.

## What Changes

- A **Review this PR** button, on each row in the Pull requests list and in the pull request detail header.
- A read-only review that opens a detached worktree, reads the diff, and returns findings that each name a file, a line and a remark. It never commits, never pushes and never changes the branch.
- The findings are shown as an editable draft first. Posting to GitHub is a separate, explicit action, following the rule already established for review comment replies: text that lands in a repository other people read is never posted as a side effect.
- Posting writes each finding as a standalone inline comment anchored to its line on GitHub, using the pull request comments endpoint already used for threaded replies.
- **No summary comment, no scores, no branding.** Only remarks under the code they are about.
- A finding whose file and line cannot be matched to the diff is never posted. Line numbers are generated text, and a comment posted against a line that is not in the diff is either rejected by GitHub or, worse, silently anchored somewhere misleading.

Deliberately not included, and both are consequences the user accepted:

- These are plain comments, not a submitted GitHub review, so **the review request stays open and the pull request stays in the Needs review tab.** Finishing the review is still done on GitHub.
- The existing scored review (`ReviewScore`, with correctness, completeness, quality, tests and regression risk) is **not** reused and not extended. It stays exactly as it is for the fix pipeline and the chat, which are the only things that read a score.

## Capabilities

### New Capabilities

- `pr-code-review`: reviewing the code of a pull request on demand, and publishing the resulting remarks as inline comments on the pull request, with the user confirming before anything is published.

### Modified Capabilities

None. `pr-review-queue` describes which pull requests are collected and how they are listed, and none of those requirements change: a reviewed pull request stays in the queue exactly as it does today, because a plain comment does not satisfy GitHub's review request.

## Impact

**Engine**

- A new review module, separate from `src/review.ts`. That file's `reviewDiff`, `buildReviewPrompt` and `isReviewScore` keep their current shape and behaviour, because `fixPipeline.ts` and `prChat.ts` depend on the score.
- New routes on `src/api/routes/prs.ts` to run a review and to post the confirmed comments.
- `src/sources/githubPrDetail.ts` gains one write, for posting a comment anchored to a line. Its read fields are unchanged: the commit an inline comment needs is taken from the same working copy the diff came from, so the anchor and the diff cannot disagree. See design.md.
- Diff parsing, to know which file and line pairs a comment can legally be anchored to.

**App**

- `PRsScreen.swift`: a review button on `PrTableRow`, beside the existing pin and agent buttons.
- `PrDetailScreen.swift`: a review button in the header, beside Merge.
- A draft view for reading, editing and discarding findings before posting, and a view model to run the review and post the result.
- `APIClient`: the two new calls.

**Not touched**

- `prChat.ts` and the agent chat panel. The chat keeps revising; the review never routes through it.
- The database schema. Nothing about a review is stored: a review is run, shown, posted or discarded.
