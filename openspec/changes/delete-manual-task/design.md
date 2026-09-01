## Context

See proposal.md - Why for the motivation and `specs/task-deletion/spec.md` for the contract.

What constrains the approach:

- `todo_messages.todo_id` is the only foreign key pointing at `todos(id)`, and `openDb` sets `foreign_keys = ON`. A delete that ignores the thread fails on any task that has been discussed. This is not hypothetical: the identical oversight in `reconcileJiraTodos` threw `FOREIGN KEY constraint failed` and stopped the poller for every project earlier in this work.
- `todos.promoted_ticket_id` points the other way, from the task to a ticket, so deleting a task cannot cascade into tickets by accident. Nothing needs to be done to protect them, but a test should pin it.
- `TaskRow` is shared by Today and the project detail Tasks tab, and already has a context menu with two conditional items. It also already distinguishes a manual task from a mirrored one: `todo` unwraps only `.todo`, while `jiraTodo` unwraps `.todo` and `.pinnedTodo` and requires `source == .jira`.
- The real database holds 10 manual tasks against 686 mirrored issues, so this affordance applies to a small minority of rows and should not clutter the ones it does not apply to.

## Goals

- The delete cannot fail on the foreign key, and a test proves it on a task that has a thread.
- The affordance appears only where it works, so the interface never offers something the engine will refuse.
- A refusal or a failure leaves the task visible rather than optimistically removing it.

## Non-Goals

- Undo, or a trash. The confirmation is the protection, as decided.
- Hiding or dismissing mirrored issues. That was offered and not chosen; it needs its own column and its own reconciliation rules.
- Bulk delete, or deleting done tasks in one action.
- Deleting tickets, pull requests or projects. Project deletion already exists and already answers 409 when something references it; this change only removes one reason for that 409.

## Decisions

### Delete the thread and the task in one transaction

`deleteTodo` removes the task's `todo_messages` rows and then the task itself, inside a single `db.transaction`.

The order is forced by the foreign key. The transaction is what stops a half-delete: without it, a failure between the two statements leaves a task whose thread has been destroyed, which is worse than either outcome alone. This mirrors what `reconcileJiraTodos` had to be changed to do, and for the same reason.

### The engine refuses a non-manual task, rather than trusting the caller

`deleteTodo` checks `source === 'manual'` and throws otherwise, and the route turns that into a 400.

The interface will not offer the action for a mirrored issue, so this check should never fire in normal use. It exists because the spec requires a direct request to be refused, and because "the UI does not offer it" is not a guarantee about an HTTP API. Cheap, and it makes the rule true rather than merely observed.

### The app hides the affordance rather than disabling it

The delete control is absent for a mirrored issue, not present-and-greyed.

A disabled control invites the question "why can I not delete this", which would need an explanation the row has no room for. Absence matches how `Start fixing this` already behaves for a task that cannot be promoted.

### A button revealed on hover, not a context menu item

**Superseded decision.** This change first shipped delete as an item in `TaskRow`'s existing context menu, with the discoverability risk below accepted. It was not discoverable enough in use, so the control is now a trash button on the row itself, revealed while the row is hovered, and the context menu item is gone.

Hover rather than always visible, chosen by the user: the rows are dense, and an irreversible action with no undo should not sit under the cursor on every row. `TaskRow` already tracks `isHovered` for its border, so the state costs nothing. Right-click was the real discoverability problem; hovering a row is something a user does without being taught.

Always visible was the alternative. It hides nothing at all, but puts a destructive control on every manual task row and one stray click from a delete, which the confirmation would then be the only thing standing in front of.

### The rule about which rows get a delete control is a tested function

`TodayLogic.deletableTodo(in:)` returns the todo a row may delete, or nil.

The rule previously lived inline in the view, untested, which was defensible while it was buried in a context menu. A visible button makes it conspicuous, and the spec requires that a mirrored issue never offers deletion, so the rule is worth proving rather than eyeballing.

It also settles a case the inline version got wrong by omission: a manual task the user had **pinned** renders as `.pinnedTodo`, not `.todo`, so it offered no delete at all. The spec says a task the user created can be deleted, with no exception for pinned, and with a visible button its absence on one row and presence on the next would read as a bug. `deletableTodo` therefore accepts a manual task in either case, and still refuses every mirrored issue and every pinned ticket or pull request.

### The confirmation lives in `ContentView`, not `TaskRow`

`TaskRow` reports the intent upward and `ContentView` presents the confirmation, the same shape every other cross-screen action in this app already uses.

Putting an alert inside `TaskRow` would give every row in a list its own alert state, and `TaskRow` is rendered once per task. The alternative considered, a `confirmationDialog` attached per row, was rejected on that basis.

### Reload rather than remove locally

After a successful delete the app reloads the task lists instead of removing the row from its local array.

The count in the sidebar, the project card and the facts card all derive from the same task list, and this is exactly where the project detail phase's final review found a blocker: a locally mutated array left those counts stale. Reloading is one request and keeps every derived number honest.

## Risks / Trade-offs

- **A delete offered on a row whose task is already gone**, for example after a poll removed it. → The engine answers 404 and the app reports it and reloads, so the screen catches up rather than showing a phantom.
- ~~**The context menu is not discoverable.**~~ Confirmed in use and fixed: the control is now a hover-revealed button on the row. See the superseded decision above.
- **A hover-only control is invisible to a keyboard or VoiceOver user, and on a touch device.** → The button carries an accessibility label, and the context menu's other two items are unaffected. Not fully solved: a keyboard-only path to delete does not exist, which is a gap this change does not close.
- **Deleting the wrong task is unrecoverable.** → The confirmation names the task, which is the difference between confirming an action and confirming a specific action.

## Migration Plan

Nothing to migrate. No schema change: the change adds a function, a route and an interface affordance. Existing tasks are unaffected until someone deletes one.

Rollback: reverting the code removes the ability. Anything already deleted stays deleted, which is the nature of the feature.

## Open Questions

None.
