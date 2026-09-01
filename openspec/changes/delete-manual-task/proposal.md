## Why

A task typed into Workbench can never be removed. There is no delete anywhere: no route, no function, nothing in the interface. The only way out of a task is to tick it done, which is wrong for one that was a mistake or is no longer wanted.

It also leaves a real dead end already disclosed on PR #4: attaching a quick-added task to a project makes that project permanently undeletable, because `todos.project_id` references `projects` and there is no way to remove the task standing in the way.

## What Changes

- A manual task can be deleted, from the task row's context menu, after confirming.
- Deleting a task removes its agent thread with it, so the delete cannot fail on a foreign key.
- Mirrored Jira issues are **not** deletable. The next poll would recreate them within five minutes, so the option is not offered rather than offered and quietly undone.
- Deleting a task that was promoted into a ticket leaves the ticket alone. The ticket is separate work with its own screen and its own thread.
- A project that was undeletable only because of a quick-added task becomes deletable once that task is gone.

## Capabilities

### New Capabilities

- `task-deletion`: a manual task can be removed permanently, and the removal is confined to that task.

### Modified Capabilities

None. The two existing capability specs, `jira-issue-status` and `engine-lifecycle`, are untouched.

## Impact

**Engine**
- `engine/src/todos.ts`: a delete that removes the task's `todo_messages` rows first, in one transaction, and refuses a task that is not manual.
- `engine/src/api/routes/todos.ts`: `DELETE /todos/:id`.

**App**
- `app/Workbench/Networking/APIClient.swift`: the delete call.
- `app/Workbench/ViewModels/TodayViewModel.swift`: delete and reload.
- `app/Workbench/Views/TaskRow.swift`: a Delete item in the existing context menu, offered only for a manual task.
- `app/Workbench/Views/TodayScreen.swift`, `app/Workbench/Views/ProjectDetailScreen.swift`: thread the action through, since both render `TaskRow`.
- `app/Workbench/Views/ContentView.swift`: the confirmation.

**Not affected**
- Tickets, pull requests, projects, and the poller.
- How mirrored Jira issues arrive or are reconciled.

**Risk**
- `todo_messages.todo_id` references `todos(id)` and foreign keys are enforced at runtime. A delete that ignores the thread fails on any task that has been discussed with the agent. This is the same defect that stopped the poller earlier and it must be handled, not discovered.
- Deletion is irreversible: there is no trash and the app has no undo. The confirmation is the only protection.
