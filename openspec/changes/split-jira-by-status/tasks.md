# Tasks

Read `specs/jira-issue-status/spec.md` for the behaviour contract and `design.md` for the decisions behind it.

Standing constraints for every task in this change:

- Engine tests: `pnpm test` and `pnpm typecheck` from `engine/`.
- App tests: from `app/`, `xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests -parallel-testing-enabled NO`, redirected to a file, verdict grepped. Never backgrounded, never polled. `-parallel-testing-enabled NO` is mandatory.
- A lone unfamiliar failure in `engine/tests/api/*` is worth one re-run before believing it: that suite has a known intermittent cross-file flake. A serialized Swift failure is always real.
- Run `xcodegen generate` from `app/` after adding any `.swift` file.
- Dutch commit messages, Conventional Commits, one line. No Claude trailer.
- TDD: the failing test comes first, and it must be observed failing before the implementation is written.

## 1. Engine: store the status

- [x] 1.1 Add a failing test to `engine/tests/db.test.ts` asserting a database migrated from before this change has `status` and `status_category` on `todos`, and extend the existing fresh-database column assertions to include both columns.

      **Migration 7 also breaks five existing assertions in that file that expect `user_version === 6`, at lines 41, 66, 138, 147 and 285. Update all five to 7.** Two further tests, at lines 280 and 336, deliberately stamp `user_version = 4` to simulate a legacy database; those stay as they are, but the version they end on is one of the five above. Five failures here are expected and are not a sign the migration is wrong.
- [x] 1.2 Add `status TEXT` and `status_category TEXT` to the `todos` block in `SCHEMA`, and migration 7 as two `ALTER TABLE todos ADD COLUMN` statements. Both nullable, no default. Confirm the drift test still passes: a migrated database and a fresh one must end with identical column sets.
- [x] 1.3 Add failing tests to `engine/tests/sources/jira.test.ts` asserting the search request asks for the `status` field, and that `mapJiraIssue` carries the status name and category out of a raw issue, including the case where Jira omits `status` entirely.
- [x] 1.4 Add `status` to the requested `fields` in `engine/src/sources/jira.ts`, and carry `statusName` and `statusCategory` through `SourceIssue` in `engine/src/types.ts` and out of `mapJiraIssue`. Read the category from the status's `statusCategory.key` and normalise it to one of to do, in progress, done.

      **Unverified:** no payload containing `status` has actually been inspected. The earlier diagnostics requested only `summary,description,project`, so the shape of `fields.status` is taken from Atlassian's documented model rather than from this instance's responses. Print one real `fields.status` object before relying on it, and adjust if `key` is absent or spelled differently.
- [x] 1.5 Add failing tests to `engine/tests/todos.test.ts` asserting `upsertJiraTodo` writes both columns, that a later upsert overwrites them when the status changed in Jira, that `rowToTodo` reads them back, and that a manual todo has null for both.
- [x] 1.6 Write both columns in `upsertJiraTodo` and read them in `rowToTodo` in `engine/src/todos.ts`. Add the two fields to the `Todo` type in `types.ts`.
- [x] 1.7 Run the full engine suite and typecheck. Commit.

## 2. App: the grouping rule

- [x] 2.1 Add the two optional fields to `Todo` in `app/Workbench/Models/Todo.swift`, and a decoding test in `app/WorkbenchTests/Models/ModelDecodingTests.swift` covering a payload with a status and one without. Confirm Swift's synthesized `Decodable` handles the missing keys, since it ignores property defaults and a non-optional field would break every existing payload.
- [x] 2.2 Write failing tests in `app/WorkbenchTests/Views/JiraLogicTests.swift` for a new grouping function, covering every scenario in the spec: several statuses ordered by category; two statuses in one category ordered by descending count; a tie broken alphabetically; a single status; no issues; all statuses unknown; a mix of known and unknown with unknown last. Assert the group label carries the status name and the count.
- [x] 2.3 Implement the grouping function in `app/Workbench/Views/JiraLogic.swift`, returning groups of the existing `JiraRow` values. Do not change `JiraRow` or `JiraLogic.rows`; the row assembly and its tests stay as they are.
- [x] 2.4 Run the full app suite. Commit.

## 3. App: the screen

- [x] 3.1 Render grouped sections in `app/Workbench/Views/JiraScreen.swift` instead of the flat `ForEach`, with a header per group showing the status name and count. Keep every row action, and keep the existing empty state for a project with no issues.
- [x] 3.2 Build and run the full app suite. Commit.

## 4. Verify against real data

Only a human can do these, and they are the point of the change.

- [x] 4.1 Restart the engine, let one poll finish, and confirm `SELECT COUNT(*) FROM todos WHERE source='jira' AND status IS NULL` reaches zero. A non-zero count after a successful poll means the upsert is not writing the columns.
- [ ] 4.2 Open the Jira screen on `MR`, the largest project at 178 issues. Confirm it reads as labelled status groups, with active work above finished work, and that the counts sum to the project's total.
- [ ] 4.3 Confirm a project whose issues are all closed shows one Done group, not an empty screen.
- [ ] 4.4 Move an issue to a different status in Jira, click Refresh, and confirm it moves group.
- [ ] 4.5 Confirm the unknown group is gone once a poll has run, and report if it is not.
