## Purpose

Collects the pull requests that are waiting on the user's own review and shows them apart from the user's own work, so review work owed to colleagues is visible in Workbench instead of only in GitHub.

## ADDED Requirements

### Requirement: Pull requests awaiting the user's review are collected

The system SHALL collect open pull requests where the user is a requested reviewer, regardless of who opened them and regardless of whether the user is an assignee.

A pull request SHALL be collected only when its repository belongs to a configured project, which is the same rule every other pull request already follows.

#### Scenario: A colleague asks the user for a review

- **WHEN** someone opens a pull request in a repository the user has a project for, and requests the user as a reviewer
- **THEN** that pull request appears in Workbench
- **AND** it is attributed to that project

#### Scenario: The repository has no project

- **WHEN** the user is requested as a reviewer on a pull request in a repository that no project is configured for
- **THEN** it is not collected
- **AND** collecting the others is unaffected

#### Scenario: The user is both the author and a reviewer

- **WHEN** a pull request the user opened also has the user as a requested reviewer
- **THEN** both facts are kept about it
- **AND** it is not stored twice

### Requirement: A review request that no longer stands is dropped

The system SHALL stop treating a pull request as awaiting the user's review once the request is withdrawn or the user has reviewed it. A finished review SHALL NOT keep the pull request in the review queue.

#### Scenario: The user has reviewed it

- **WHEN** the user submits their review and the source no longer reports the request
- **THEN** the pull request is no longer awaiting the user's review
- **AND** the pull request itself is not removed if it is still open and still relevant for another reason

#### Scenario: The request is withdrawn

- **WHEN** the author removes the user as a reviewer
- **THEN** the pull request stops awaiting the user's review

### Requirement: The review queue is shown apart from the user's own work

The system SHALL present the pull requests awaiting the user's review as their own list, separate from the lists of pull requests the user authored or was assigned.

A pull request the user neither authored nor was assigned SHALL NOT appear in those other two lists.

The user's own pull request that is waiting on someone else's review SHALL NOT appear in the review queue. It remains reachable as the user's own work.

#### Scenario: A colleague's pull request needing the user's review

- **WHEN** the user opens the list of pull requests awaiting their review
- **THEN** a colleague's pull request that names the user as reviewer is listed
- **AND** it shows the same title, reference, project and age as any other pull request row

#### Scenario: The user's own pull request waiting on someone else

- **WHEN** the user's own pull request has had no review yet
- **THEN** it is absent from the review queue
- **AND** it is still listed among the user's own pull requests

#### Scenario: A review-only pull request stays out of the other lists

- **WHEN** a pull request the user neither opened nor was assigned is collected for review
- **THEN** the authored list does not show it
- **AND** the assigned list does not show it

#### Scenario: Nothing is awaiting review

- **WHEN** no pull request is waiting on the user's review
- **THEN** the screen says so
- **AND** the message does not imply that only pull requests the user opened or was assigned can appear

### Requirement: A pull request awaiting review can be opened like any other

The system SHALL give a pull request that reached Workbench only through a review request the same detail view as one the user opened, including its changes. Its origin SHALL NOT make it a dead row.

#### Scenario: Opening a colleague's pull request

- **WHEN** the user opens a pull request that is in Workbench only because a review was requested
- **THEN** its details and its changes are shown
- **AND** nothing reports it as missing or broken because the user did not open it

### Requirement: An incomplete fetch never removes stored pull requests

When the source reports more pull requests than the system will retrieve in one go, the system SHALL treat the result as incomplete and SHALL NOT conclude that the missing ones are gone.

#### Scenario: The review request search is capped

- **WHEN** the search for pull requests awaiting the user's review returns as many results as the system will accept at once
- **THEN** stored pull requests are left in place
- **AND** the incompleteness is reported so it is diagnosable
