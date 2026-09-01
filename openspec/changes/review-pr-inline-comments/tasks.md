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
- **No schema change.** Nothing about a review is stored. If a task seems to need a migration, stop and say so.
- **Do not touch `engine/src/review.ts`.** `fixPipeline.ts` and `prChat.ts` read its score and must keep working. If a task seems to need a change there, stop and say so.

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

## 4. Engine: the routes

- [ ] 4.1 Write failing tests in `engine/tests/api/prs.test.ts` for `POST /prs/:id/review`: it returns the anchorable findings and the discarded ones separately; it returns 404 for an unknown pull request; 401 without a bearer token; a pull request whose project has no GitHub repo configured fails with a reason rather than a bare 500; the worktree is removed even when the review throws, which is the leak the existing diff route already guards against.
- [ ] 4.2 Implement `POST /prs/:id/review` in `engine/src/api/routes/prs.ts`, following the shape of the existing `GET /prs/:id/diff`: open the detached worktree, read the diff, read the head sha, run the review, validate the anchors, and remove the worktree in a `finally`. Write nothing.
- [ ] 4.3 Write failing tests for `POST /prs/:id/review/publish`: it posts one comment per confirmed finding; it reports success and failure per finding rather than failing the whole call on one bad comment; a finding whose anchor does not validate against the current diff is refused rather than posted; 404 for an unknown pull request; 401 without a bearer token.

      Re-validating at publish time is deliberate: the findings come back from the app, where the user may have edited them, and the engine holds no draft state between the two calls.
- [ ] 4.4 Implement `POST /prs/:id/review/publish`. Confirm the tests pass.
- [ ] 4.5 Run the whole engine suite and typecheck. Commit.

## 5. App: the calls and the state

- [ ] 5.1 Write failing tests in `app/WorkbenchTests/Networking/APIClientPRsTests.swift` asserting the review call uses `POST` against `/prs/<id>/review`, and the publish call `POST` against `/prs/<id>/review/publish` with the findings in the body.
- [ ] 5.2 Add the finding model and both calls to `APIClient`. Decode the finding with optional fields where the engine may omit them, since Swift's synthesized `Decodable` ignores property defaults.
- [ ] 5.3 Write failing tests in `app/WorkbenchTests/Views/PrReviewLogicTests.swift` for the pure rules: a review with findings offers publishing; a review with none does not; a review where every finding was discarded reports that and does not offer publishing; discarding the last remaining finding stops offering publishing; the count shown matches the findings that would actually be posted, not the total the review produced.
- [ ] 5.4 Implement those rules in `app/Workbench/Views/PrReviewLogic.swift`.
- [ ] 5.5 Write failing tests in `app/WorkbenchTests/ViewModels/PrReviewViewModelTests.swift`: running a review sets a running state and clears it on success and on failure; a failed review surfaces the error and offers nothing to publish; an edited remark is what gets sent on publish; a discarded finding is not sent; a partial publish failure keeps the failed findings and reports which ones they are; publishing never runs automatically after a review.
- [ ] 5.6 Implement `PrReviewViewModel`. Confirm the tests pass.
- [ ] 5.7 Run the whole app suite. Commit.

## 6. App: the buttons and the sheet

No tests for the view wiring itself: every rule it follows is tested in section 5. Manual verification covers the rest.

- [ ] 6.1 Add a review button to `PrTableRow` in `app/Workbench/Views/PRsScreen.swift`, beside the existing pin and agent buttons, with an accessibility label.
- [ ] 6.2 Add a review button to the header of `app/Workbench/Views/PrDetailScreen.swift`, beside Merge. Note that Merge is shown only for a pull request the user authored; the review button is shown for every pull request, which is the point of it.
- [ ] 6.3 Build the review sheet: each finding with its file and line, its remark editable, and a discard control; the discarded findings listed separately with their reasons; a Publish control and a Discard control. Publish is offered only when at least one finding remains.
- [ ] 6.4 Present the sheet from both entry points, and show the running state on the button that started the review.
- [ ] 6.5 Run `xcodegen generate`, build, and run the whole app suite. Commit.

## 7. Verify for real

Only a human can do these, and 7.2 and 7.4 are the ones this change exists for.

- [ ] 7.1 Start a review from a row in the Pull requests list on a pull request the user did not write. It reports that it is running, and the sheet opens with findings that each name a real file and line in that pull request.
- [ ] 7.2 Publish the findings and confirm on GitHub that each comment sits on the line it named, that there is no summary comment, no heading and no score, and that the Reviews section is still empty because no review was submitted.
- [ ] 7.3 Edit a remark before publishing and confirm the edited text is what appears on GitHub. Discard a different finding and confirm it does not appear at all.
- [ ] 7.4 Confirm the pull request is unchanged as work: no new commit, no push, its branch is where it was, and it is still in the Needs review tab, which is the accepted consequence of posting plain comments.
- [ ] 7.5 Run a review, then discard the sheet without publishing. Nothing appears on GitHub.
- [ ] 7.6 Confirm a discarded finding is reported. If a whole review comes back with everything discarded, that points at the line numbering rather than at the pull request, so report it rather than treating it as normal.
- [ ] 7.7 Start a review on a pull request from a fork. Confirm it fails with a reason naming the fetch, not a bare 500. This is the known limitation from design.md.
- [ ] 7.8 Start a review with the engine stopped. An alert says so and no sheet opens.
- [ ] 7.9 Confirm the worktree was cleaned up: `.worktrees` under the project's repository holds nothing left over after a review, including after a failed one.
