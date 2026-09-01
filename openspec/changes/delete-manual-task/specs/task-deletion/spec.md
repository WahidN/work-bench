## Purpose

Lets a task the user typed be removed for good, so a mistake or an abandoned idea has a way out other than being marked done, and so a project is not held hostage by a task attached to it.

## ADDED Requirements

### Requirement: A manual task can be deleted

The system SHALL allow a task the user created to be deleted. Deleting it SHALL remove the task and everything belonging only to that task, and SHALL leave every other task untouched.

A deleted task SHALL NOT reappear.

#### Scenario: Deleting a task

- **WHEN** the user deletes a task they created
- **THEN** the task is gone from every screen that listed it
- **AND** it does not come back on a later refresh

#### Scenario: Deleting a task that has an agent thread

- **WHEN** the user deletes a task they had discussed with the agent
- **THEN** the task and its thread are both removed
- **AND** the deletion succeeds rather than failing because the thread referred to the task

#### Scenario: A task the user pinned

- **WHEN** the user deletes a task they created and had pinned
- **THEN** it is deleted like any other task they created
- **AND** pinning it first does not have to be undone to get rid of it

#### Scenario: Other tasks are unaffected

- **WHEN** the user deletes one of several tasks
- **THEN** only that task is removed
- **AND** the others keep their text, priority, due date and done state

### Requirement: A mirrored issue cannot be deleted

The system SHALL refuse to delete a task that mirrors an issue from an external source. Such a task is recreated whenever the source is next polled, so deleting it would appear to succeed and then silently undo itself.

The interface SHALL NOT offer deletion for a mirrored issue, and the system SHALL refuse it even if asked directly.

#### Scenario: The option is not offered

- **WHEN** the user looks at a row for a mirrored Jira issue
- **THEN** no way to delete it is offered anywhere on that row
- **AND** the actions that do apply to it are still offered

#### Scenario: Asked directly anyway

- **WHEN** deletion of a mirrored issue is requested directly
- **THEN** the request is refused with a reason
- **AND** the issue remains

### Requirement: Deleting a task does not delete work derived from it

The system SHALL leave a ticket created from a task in place when that task is deleted. A ticket is separate work with its own history, and removing the task it came from SHALL NOT remove it.

#### Scenario: A task that had been promoted

- **WHEN** a task that was promoted into a ticket is deleted
- **THEN** the ticket still exists with its own thread and status
- **AND** only the task is gone

### Requirement: Deleting is confirmed first

Because deletion cannot be undone and the system offers no trash, the system SHALL ask the user to confirm before deleting, and SHALL name the task being deleted so the user can see they picked the right one.

Declining SHALL leave the task exactly as it was.

#### Scenario: Confirming

- **WHEN** the user chooses to delete a task and confirms
- **THEN** the task is deleted

#### Scenario: Declining

- **WHEN** the user chooses to delete a task and then declines
- **THEN** the task is still there, unchanged

### Requirement: Deleting a task releases the project it was attached to

The system SHALL allow a project to be deleted once the tasks attached to it are gone. A task attached to a project SHALL NOT permanently prevent that project from being deleted.

#### Scenario: A project blocked only by a task

- **WHEN** a project cannot be deleted because a task is attached to it, and the user deletes that task
- **THEN** the project can then be deleted

### Requirement: A failed deletion says so

When a deletion cannot be completed, the system SHALL tell the user and SHALL leave the task in place. It SHALL NOT remove the task from the screen as though it had worked.

#### Scenario: The engine is unreachable

- **WHEN** the user confirms a deletion while the engine cannot be reached
- **THEN** the app reports that it failed
- **AND** the task is still listed
