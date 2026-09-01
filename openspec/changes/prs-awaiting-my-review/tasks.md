# Tasks

Read `specs/pr-review-queue/spec.md` for the behaviour contract and `design.md` for the decisions, especially why the flag is overwritten on every poll and why the new input field is required rather than optional.

Standing constraints for every task in this change:

- Engine tests: `pnpm test` and `pnpm typecheck` from `engine/`. **Check the typecheck output explicitly**; the `rtk` wrapper truncates it and a clean-looking test run has hidden type errors before.
- App tests: from `app/`, `xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests -parallel-testing-enabled NO`, redirected to a file, verdict grepped. Never backgrounded, never polled. `-parallel-testing-enabled NO` is mandatory, and the run sometimes exceeds 120 seconds.
- A lone unfamiliar failure in `engine/tests/api/*` is worth one re-run before believing it: that suite has a known intermittent cross-file flake. A serialized Swift failure is always real.
- Run `xcodegen generate` from `app/` after adding any `.swift` file.
- Dutch commit messages, Conventional Commits, one line. No Claude trailer.
- TDD: the failing test comes first, and it must be observed failing before the implementation is written.
- **Never let a test reach the real GitHub.** `engine/tests/sources/githubPrs.test.ts` already does `vi.mock('execa')`; every new test drives that mock. A test that shells out to `gh` is a defect in the test.

## 1. Engine: fetch the third search

- [x] 1.1 Add failing tests to `engine/tests/sources/githubPrs.test.ts`: a pull request returned only by the review-requested search is flagged `reviewRequestedByMe` with `authoredByMe` and `assignedToMe` both false; one returned by all three carries all three flags and is not duplicated; the repository filter drops a review-requested hit whose repo maps to no project; a capped review-requested search sets `truncated` even when the other two are short.

      **Adding a third `execa` call breaks two existing tests in this file**, the ones that chain exactly two `mockResolvedValueOnce` calls: `flags a PR that only the assignee search returned` at line 25 and `flags truncated when a search hits the result cap` at line 61. The third call gets `undefined` and throws. Give each a third `.mockResolvedValueOnce({ stdout: '[]' } as any)`. Two failures here are expected and are not a sign the search is wrong.

      Note also that `unions the author and assignee searches and flags both` uses plain `mockResolvedValue`, so it now serves all three searches. It still passes; its name is just narrower than what it covers.
- [x] 1.2 Add the `--review-requested=@me` call to `fetchMyOpenPrs` in `engine/src/sources/githubPrs.ts`, widen the `search()` filter union to three values, add `reviewRequestedByMe` to `GithubPr`, add the third `take()` key, and OR the third result into `truncated`.
- [x] 1.3 Run the full engine suite and typecheck. Commit.

## 2. Engine: store the flag

- [x] 2.1 Add a failing test to `engine/tests/db.test.ts` asserting a database migrated from before this change has `review_requested` on `prs`, and extend the fresh-database column assertions to include it.

      **Migration 8 also breaks six existing assertions in that file that expect `user_version === 7`, at lines 68, 88, 113, 185, 194 and 332.** Update all six to 8. The three deliberate legacy stamps stay as they are: `user_version = 6` at line 60 and `user_version = 4` at lines 327 and 405. Six failures here are expected.
- [x] 2.2 Add `review_requested INTEGER NOT NULL DEFAULT 0` to the `prs` block in `SCHEMA`, and migration 8 as one `ALTER TABLE prs ADD COLUMN`, declared the same way `authored_by_me` and `assigned_to_me` already are. Confirm the drift test still passes: a migrated database and a fresh one must end with identical column sets.
- [x] 2.3 Add failing tests to `engine/tests/prs.test.ts`: `upsertGithubPr` writes the flag; a later upsert with the flag false **clears** it, which is what makes a withdrawn or completed review request stop showing; `rowToPr` reads it back; a pull request recorded by `recordPr` from a ticket has it false.
- [x] 2.4 Carry `reviewRequestedByMe` through `UpsertGithubPrInput`, both the insert and the `DO UPDATE` halves of the upsert, and `rowToPr` in `engine/src/prs.ts`. Add the field to `Pr` in `engine/src/types.ts`.

      The field is **required**, so the compiler will name the five existing test call sites, two in `prs.test.ts` and three in `poller.test.ts` at lines 199, 219 and 239. Pass `reviewRequestedByMe: false` at each; none of them is about a review request.
- [x] 2.5 Pass the flag through `upsertGithubPr` in `engine/src/poller.ts`.
- [x] 2.6 Run the full engine suite and typecheck. Commit.

## 3. App: the tab

- [x] 3.1 Add `reviewRequestedByMe` to `PullRequest` and a decoding test in `app/WorkbenchTests/Models/ModelDecodingTests.swift` covering a payload that has the field and one that does not. It must be optional: Swift's synthesized `Decodable` ignores property defaults, so a non-optional field would break every payload written before this change.
- [x] 3.2 Write failing tests in `app/WorkbenchTests/Views/PRsLogicTests.swift` for the new meaning of the tab: a pull request awaiting the user's review is kept by `.needsReview`; the user's own pull request with no review yet is **not** kept, which is the behaviour being deliberately dropped; a review-only pull request is absent from `.assignedToMe` and `.mine`; the other two filters keep their existing contents unchanged.
- [x] 3.3 Change the `.needsReview` case of `PRsLogic.keep` to read `pr.reviewRequestedByMe`. Leave `statusLabel` and the other two filter cases alone.
- [x] 3.4 Update `PRsLogic.emptyStateText`, which currently promises only "Pull requests you open or get assigned show up automatically", so it also mentions review requests. Assert the new text in a test rather than leaving it uncovered.
- [x] 3.5 Run the full app suite. Commit.

## 4. Verify against real data

Only a human can do these, and 4.2 is the one this change exists for.

- [x] 4.1 Restart the engine, let one poll finish, and confirm `SELECT number, review_requested_by_me FROM prs WHERE project_id = 1` shows `45` present with `review_requested_by_me = 1`. Use better-sqlite3, not the `sqlite3` CLI: the CLI reads a stale view of this WAL database and reported the pre-migration `user_version` and column set. A missing row means the search or the repository filter is wrong; a row with 0 means the upsert is not writing the column.
- [x] 4.2 Open Pull requests, Needs review. `acv-website#45 [ACV-38] Herbouw meldingsbalk` is listed, and the user's own seven pull requests are not.
- [x] 4.3 Confirm those seven are still all present under "Mine", and that "Assigned to me" is unchanged. Confirm #45 appears in neither.
- [ ] 4.4 Open #45 and confirm its detail view and its diff load. A fork PR or an empty stored branch makes `openDetachedWorktree` fail on `git fetch origin <branch>`, so a 500 here is the known risk rather than a surprise. This is the unproven path from design.md: no pull request the user did not author has ever been stored.
- [x] 4.5 Submit or dismiss the review on #45 in GitHub, click Refresh, and confirm it leaves the Needs review tab. Because it is in Workbench only for the review request, expect the row to disappear entirely rather than move. Verified: #45 was approved, GitHub stopped returning it for --review-requested, and the row is gone from prs entirely. Checked in the database, not on screen.
- [ ] 4.6 Confirm the empty state reads sensibly when nothing awaits review, by checking the tab after 4.5 if it is then empty.
