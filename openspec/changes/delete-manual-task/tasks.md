# Tasks

Read `specs/task-deletion/spec.md` for the contract and `design.md` for the decisions.

Standing constraints for every task:

- Engine tests: `pnpm test` and `pnpm typecheck` from `engine/`. **Check the typecheck output explicitly**; the `rtk` wrapper truncates it and a clean-looking test run has hidden type errors before.
- App tests: from `app/`, `xcodebuild test -scheme Workbench -destination 'platform=macOS' -only-testing:WorkbenchTests -parallel-testing-enabled NO`, redirected to a file, verdict grepped. Never backgrounded, never polled. `-parallel-testing-enabled NO` is mandatory, and the run sometimes exceeds 120 seconds.
- A lone unfamiliar failure in `engine/tests/api/*` is worth one re-run: that suite has a known intermittent cross-file flake. A serialized Swift failure is always real.
- Run `xcodegen generate` from `app/` after adding any `.swift` file.
- Dutch commit messages, Conventional Commits, one line. No Claude trailer.
- TDD: the failing test first, observed failing, before the implementation.
- No schema change. If a task seems to need one, stop and say so.

## 1. Engine: delete a manual task

- [x] 1.1 Write failing tests in `engine/tests/todos.test.ts`: deleting a manual task removes it; **deleting a manual task that has agent messages succeeds and removes those messages**, which is the foreign key case that broke the poller once already; other tasks survive untouched; deleting a mirrored Jira task throws and leaves it in place; deleting an id that does not exist reports not found rather than silently doing nothing; a task that had been promoted is deleted while its ticket survives with its own messages.
- [x] 1.2 Implement `deleteTodo` in `engine/src/todos.ts`: refuse a task whose source is not manual, then remove its `todo_messages` rows and the task itself in one `db.transaction`. The order is forced by the foreign key and the transaction is what prevents a half-delete.
- [x] 1.3 Run the whole engine suite and typecheck. Commit.

## 2. Engine: the route

- [x] 2.1 Write failing tests in `engine/tests/api/todos.test.ts`: `DELETE /todos/:id` returns 204 for a manual task, matching the existing `DELETE /projects/:id`; 400 for a mirrored Jira task, with a reason; 404 for an unknown id; 401 without a bearer token.
- [x] 2.2 Register `DELETE /todos/:id` in `engine/src/api/routes/todos.ts`, turning the non-manual refusal into a 400 and a missing task into a 404.
- [x] 2.3 Run the whole engine suite and typecheck. Commit.

## 3. App: the call and the view model

- [x] 3.1 Write a failing test in `app/WorkbenchTests/Networking/APIClientTodosTests.swift` asserting the call uses `DELETE` against `/todos/<id>`.
- [x] 3.2 Add `deleteTodo(id:)` to `APIClient`.
- [x] 3.3 Write failing tests in `app/WorkbenchTests/ViewModels/TodayViewModelTests.swift`: a successful delete reloads the task list rather than removing the row locally, because the sidebar count, the project card and the facts card all derive from that list and a local mutation leaves them stale; a failed delete surfaces the error and leaves the list alone.
- [x] 3.4 Add the delete to `TodayViewModel`, reloading on success. Confirm the tests pass.
- [x] 3.5 Run the whole app suite. Commit.

## 4. App: the affordance

No tests: view wiring, and the rule about which rows qualify is already expressed by `TaskRow`'s existing `todo` property, which unwraps only `.todo` and therefore only manual rows on Today.

- [x] 4.1 Add a Delete item to `TaskRow`'s existing context menu, shown only for a manual task, and **absent rather than disabled** for a mirrored issue. Add the callback as a new stored property, matching how `onChat` and `onPromote` are already threaded.
- [x] 4.2 Thread the callback through `TodayScreen` and `ProjectDetailScreen`, both of which render `TaskRow`.
- [x] 4.3 Present the confirmation from `ContentView`, naming the task in the message, and delete only on confirm. Do not put the alert inside `TaskRow`: it is rendered once per task and each row would carry its own alert state.
- [x] 4.4 Run `xcodegen generate`, build, and run the whole app suite. Commit.

## 5. Verify for real

- [ ] 5.1 Add a task on Today, hover the row, click the trash button, confirm. It disappears and does not return after a Refresh.
- [ ] 5.2 Add a task, chat to the agent about it, then delete it. It goes without an error. This is the foreign key case.
- [ ] 5.8 Delete a task from a project's Tasks tab while the engine is stopped. An alert says it could not be deleted and the row stays. Before the review fixes this failed in silence.
- [ ] 5.9 Trigger a Refresh error, leave its alert unread, then click a trash button. The confirmation still appears. Before the review fixes the pending Refresh alert swallowed it.
- [ ] 5.3 Hover a mirrored Jira issue on Today or in a project's Tasks tab, and right-click it. There is no delete button and no delete menu item. The actions that do apply to it are still there.
- [ ] 5.4 Delete a task and check the sidebar count for its project, the project card and the facts card all drop by one.
- [ ] 5.5 Attach a task to a project, try to delete the project and see it refused, delete the task, then delete the project successfully. This is the dead end the change exists to open.
- [ ] 5.6 Start a delete and decline the confirmation. The task is still there.
- [ ] 5.7 Hover a manual task you have pinned and confirm it offers delete too. Before section 6 a pinned task offered none.

## 6. App: a button on the row instead of the context menu

Supersedes 4.1. The context menu item shipped and was not discoverable enough in use. See the superseded decision in design.md.

- [x] 6.1 Write failing tests in `app/WorkbenchTests/Views/TodayLogicTests.swift` for `TodayLogic.deletableTodo(in:)`: a manual task as `.todo` returns it; a manual task as `.pinnedTodo` returns it too, which the inline rule got wrong; a mirrored Jira issue returns nil as `.todo` and as `.pinnedTodo`; a pinned ticket and a pinned pull request both return nil.
- [x] 6.2 Implement `TodayLogic.deletableTodo(in:)`.
- [x] 6.3 Replace the context menu Delete item in `TaskRow` with a trash button shown only while the row is hovered, gated on `deletableTodo`, with an accessibility label. Keep `onDelete` and the confirmation in `ContentView` exactly as they are: only the control changes, not what it does.
- [x] 6.4 Run `xcodegen generate`, build, and run the whole app suite. Commit.
