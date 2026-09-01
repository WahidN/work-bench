# Tasks

Read `specs/pr-code-review/spec.md` for the behaviour contract and `design.md` for the decisions, especially why the anchor commit comes from the worktree rather than from GitHub, and why read-only is enforced by the tool list rather than by the prompt.

Standing constraints for every task in this change:

- Engine tests: `pnpm test` and `pnpm typecheck` from `engine/`. **Check the typecheck output explicitly**; the `rtk` wrapper truncates it and a clean-looking test run has hidden type errors before.
- App tests: from `app/`, `xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests -parallel-testing-enabled NO`, redirected to a file, verdict grepped. Never backgrounded, never polled. `-parallel-testing-enabled NO` is mandatory, and the run sometimes exceeds 120 seconds.
- A lone unfamiliar failure in `engine/tests/api/*` is worth one re-run before believing it: that suite has a known intermittent cross-file flake. A serialized Swift failure is always real.
- Run `xcodegen generate` from `app/` after adding any `.swift` file.
- Dutch commit messages, Conventional Commits, one line. No Claude trailer.
- TDD: the failing test comes first, and it must be observed failing before the implementation is written.
- **Never let a test reach the real GitHub.** `engine/tests/sources/githubPrDetail.test.ts` already mocks `execa`; every new test drives that mock. A test that shells out to `gh` is a defect in the test.
- **Do not touch `engine/src/review.ts`.** `fixPipeline.ts` and `prChat.ts` read its score and must keep working. If a task seems to need a change there, stop and say so.
- **Do not hang the notification off `needsInput`.** `getTodayView` filters review-requested pull requests out of it deliberately. See design.md.

## 1. Engine: which lines a comment can attach to

Pure diff parsing, no process and no network, because this is the rule that decides whether a remark reaches a colleague or is thrown away.

- [x] 1.1 Write failing tests in `engine/tests/diffAnchors.test.ts` for a function that turns a unified diff into the set of `(path, line)` pairs a comment can anchor to: an added line is anchorable; a context line is anchorable; a removed line is not, since only the right-hand side is supported; a line beyond the end of a hunk is not; a file not in the diff has no anchorable lines at all; a diff with several hunks in one file counts lines correctly across the gap between them, which is the case a naive running counter gets wrong; a diff touching several files keeps them apart; a rename or a binary file with no hunks contributes nothing rather than throwing.
- [x] 1.2 Implement the parser in `engine/src/diffAnchors.ts`, reading the `+` start line from each `@@ -a,b +c,d @@` header and walking the hunk body, counting added and context lines and skipping removed ones.
- [x] 1.3 Write failing tests for the validation rule itself: a finding whose pair is anchorable is kept; one whose line is not in the diff is discarded with a reason naming the file and line; one whose path is not in the diff is discarded with a reason; the kept and discarded findings are returned separately so both can be shown.
- [x] 1.4 Implement the validation. Confirm the tests pass.
- [x] 1.5 Run the whole engine suite and typecheck. Commit.

## 2. Engine: the review

- [x] 2.1 Write failing tests in `engine/tests/prReview.test.ts` for the prompt builder: it carries the pull request title and the diff; it asks for findings that each name a path, a line and a body; it states that the response is JSON only. Assert it does **not** ask for scores, since nothing consumes them any more.
- [x] 2.2 Write failing tests for the response validator: a well-formed findings array passes; a finding missing `path`, `line` or `body` fails; a non-numeric line fails; an empty findings array is valid and means the review found nothing; a payload shaped like the old `ReviewScore` fails, which is the guard against the two review shapes being confused.
- [x] 2.3 Write a failing test asserting the review is invoked with `allowedTools` of exactly `['Read', 'Grep', 'Glob']`. This is the read-only boundary from design.md and deserves its own test rather than being implied by the others.
- [x] 2.4 Implement `engine/src/prReview.ts`: build the prompt, call `claudeJson` with the validator, and return the findings. Add the finding type to `engine/src/types.ts`.
- [x] 2.5 Run the whole engine suite and typecheck. Commit.

## 3. Engine: posting a comment on a line

- [x] 3.1 Add a failing test to `engine/tests/git.test.ts` for reading the current commit sha of a worktree.
- [x] 3.2 Implement it in `engine/src/git.ts` as `git rev-parse HEAD` against the worktree path.
- [x] 3.3 Add failing tests to `engine/tests/sources/githubPrDetail.test.ts` for posting a comment anchored to a line: it calls the pull request comments endpoint with `commit_id`, `path`, `line`, `side` of `RIGHT` and the body; it sends **no** `in_reply_to`, which is what makes it a new comment rather than a threaded reply; a numeric field is sent as a number rather than a string, since `gh api` needs `-F` and not `-f` for those; a failure from `gh` surfaces rather than being swallowed.
- [x] 3.4 Implement the post alongside `postReviewCommentReply`. Leave that function alone.
- [x] 3.5 Run the whole engine suite and typecheck. Commit.

## 4. Engine: storing a review

Superseded the earlier "nothing is stored" approach. See design.md: the review finishes while the user is elsewhere, so there is nowhere for the findings to live but the database.

- [x] 4.1 Add a failing test to `engine/tests/db.test.ts` asserting a database migrated from before this change has the review findings table, and extend the fresh-database assertions to cover it.

      **Migration 9 will break the existing assertions that expect `user_version === 8`.** Update each. Deliberate legacy stamps at lower versions stay as they are. Those failures are expected and are not a sign the migration is wrong. Confirm the drift test still passes: a migrated database and a fresh one must end with identical column sets.
- [x] 4.2 Add the table to `SCHEMA` and migration 9: one row per finding, with the pull request, path, line, body, the commit sha the review was written against, whether it has been posted, and when it was created. Foreign key to `prs`, deleted with it, the way `todo_messages` already hangs off its task.
- [x] 4.3 Write failing tests in `engine/tests/prReviewStore.test.ts`: storing a review's findings replaces whatever that pull request had before, so a second review does not stack on the first; reading them back returns them in a stable order; marking one posted leaves the others alone; discarding one removes it; discarding the last one leaves an empty list rather than an error; findings for one pull request are untouched by another's.
- [x] 4.4 Implement the store in `engine/src/prReviewStore.ts`. Confirm the tests pass.
- [x] 4.5 Run the whole engine suite and typecheck. Commit.

## 5. Engine: the routes

`POST /prs/:id/review` and `POST /prs/:id/review/publish` already exist from the superseded model. The first changes shape, the second is deleted along with its tests.

- [x] 5.1 Rewrite the failing tests for `POST /prs/:id/review` in `engine/tests/api/prs.test.ts`: it returns immediately rather than awaiting the review, so the response does not carry findings; it refuses a second review of the same pull request while one is running; 404 for an unknown pull request; 401 without a bearer token. Delete the tests for the batch publish route.
- [x] 5.2 Rewrite the route to start the work and return. Keep the `acquireJob` lock, the detached worktree, the diff, the head sha, the anchor validation and the `finally` that removes the worktree; what changes is that all of it happens after the response, and the anchorable findings are written to the store instead of returned. A failure must reach `finishJob` so it is visible rather than lost with the request.
- [x] 5.3 Write failing tests for `GET /prs/:id/review`: it returns the stored findings; it marks them outdated when the pull request's head has moved past the sha they were written against, and does not when it has not; an empty list for a pull request with no review; 401 without a bearer token.
- [x] 5.4 Implement it.
- [x] 5.5 Write failing tests for `POST /prs/:id/review/findings/:findingId`: it posts that one finding and marks it posted; it posts the body sent with the request, not the stored one, so an edit is what lands; a failure from GitHub is reported and the finding is **not** marked posted; posting an already posted finding is refused; 404 for an unknown finding; 401 without a bearer token; a project with no GitHub repo fails with a reason rather than a bare 500.
- [x] 5.6 Write failing tests for `DELETE /prs/:id/review/findings/:findingId`: it removes that finding; 404 for an unknown one; 401 without a bearer token.
- [x] 5.7 Implement both. Neither opens a worktree: the stored sha is what the comment anchors to. See design.md.
- [x] 5.8 Run the whole engine suite and typecheck. Commit.

## 6. App: the findings on the pull request

Supersedes the sheet. `app/Workbench/Views/PrReviewSheet.swift` is deleted, and `PrReviewViewModel` is reworked from holding findings in memory and publishing them all at once to reading stored findings and posting them one at a time.

- [x] 6.1 Rewrite the failing tests in `app/WorkbenchTests/Networking/APIClientPRsTests.swift` for the new calls: start uses `POST /prs/<id>/review`; read uses `GET /prs/<id>/review`; post one uses `POST /prs/<id>/review/findings/<findingId>` with the body; discard one uses `DELETE` on the same path. Remove the batch publish test.
- [x] 6.2 Update `APIClient` and the finding model to match, including the posted and outdated flags.
- [x] 6.3 Rewrite `app/WorkbenchTests/Views/PrReviewLogicTests.swift` for the new rules: a finding that has been posted is not offered for posting again; an outdated review is labelled; a review with nothing left reads as done rather than as an error; the discarded findings are still reported with their reasons.
- [x] 6.4 Update `PrReviewLogic` accordingly.
- [x] 6.5 Rewrite `app/WorkbenchTests/ViewModels/PrReviewViewModelTests.swift`: starting a review does not block and does not return findings; loading a pull request's review returns what is stored; posting one finding marks only that one posted and leaves the rest; a failed post keeps the finding unposted and puts the error on it; discarding one removes only that one; an edited body is what gets sent.
- [x] 6.6 Rework `PrReviewViewModel`. Confirm the tests pass.
- [x] 6.7 Delete `PrReviewSheet.swift` and the sheet presentation from `PRsScreen.swift` and `PrDetailScreen.swift`. The row button now starts a review and opens nothing.
- [x] 6.8 Build the review section on `PrDetailScreen.swift`: each finding with its file and line, its remark editable, its own Post and Discard controls, and its own error line when a post fails. Show the outdated marking when the head has moved. List the discarded findings with their reasons. Load it with the rest of the detail.
- [x] 6.9 Run `xcodegen generate`, build, and run the whole app suite. Commit.

## 7. App: the notification

- [ ] 7.1 Write failing tests for the rule deciding when to notify: a pull request whose review has finished with postable findings is announced once; it is not announced again on the next poll; a review that produced nothing to post is not announced; a review still running is not announced; a pull request whose findings have all been posted or discarded is not announced.
- [ ] 7.2 Implement that rule as pure logic, and drive it from the polling loop that already exists in `ContentView`. **Do not route it through `needsInput`**: `getTodayView` filters review-requested pull requests out of that list on purpose, and hanging this off it would drag them back into the badge. See design.md.
- [ ] 7.3 Send the notification through the existing `AppDelegate.notify(title:body:)`, naming the pull request.
- [ ] 7.4 Run `xcodegen generate`, build, and run the whole app suite. Commit.

## 8. Verify for real

Only a human can do these, and 8.3 and 8.5 are the ones this change exists for.

- [ ] 8.1 Start a review from a row in the Pull requests list on a pull request the user did not write. The list stays usable and nothing opens. Move to another screen and confirm the app is not blocked.
- [ ] 8.2 Wait for the review to finish and confirm a notification arrives naming that pull request.
- [ ] 8.3 Open the pull request and confirm the findings are listed, each naming a real file and line in that pull request. Post one, and confirm on GitHub that it sits on the line it named, that there is no summary comment, no heading and no score, and that the Reviews section is still empty because no review was submitted.
- [ ] 8.4 Confirm the posted one now reads as posted and is not offered again, and that the others are still there unposted.
- [ ] 8.5 Confirm the pull request is unchanged as work: no new commit, no push, its branch is where it was, and it is still in the Needs review tab, which is the accepted consequence of posting plain comments.
- [ ] 8.6 Edit a remark before posting it and confirm the edited text is what appears on GitHub. Discard a different one and confirm it disappears and never reaches GitHub.
- [ ] 8.7 Restart the engine after a review has finished and confirm the findings are still there.
- [ ] 8.8 Restart the engine **while** a review is running, and confirm that review does not stay stuck reporting itself as running, and that a new review can be started.
- [ ] 8.9 Push a commit to the reviewed branch and confirm the findings are marked as written against an earlier commit, and are still postable.
- [ ] 8.10 Confirm a discarded finding is reported with its reason. If a whole review comes back with everything discarded, that points at the line numbering rather than at the pull request, so report it rather than treating it as normal.
- [ ] 8.11 Start a review on a pull request from a fork. Confirm the failure is visible and names the fetch rather than vanishing with the request. This is the known limitation from design.md, and the background job makes it easier to lose.
- [ ] 8.12 Start a review with the engine stopped. An alert says so.
- [ ] 8.13 Confirm the worktree was cleaned up: `.worktrees` under the project's repository holds nothing left over after a review, including after a failed one.
