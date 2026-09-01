## Purpose

Lets the user review the code of a pull request from inside Workbench and publish the resulting remarks as comments on the lines they are about, with the user reading and confirming those remarks before anything reaches the pull request.

## ADDED Requirements

### Requirement: A review can be started from a pull request

The system SHALL offer an explicit action to review a pull request, both from a pull request in the list and from an opened pull request.

The action SHALL be offered for any pull request the system holds, whoever opened it, because reviewing is most often owed on work the user did not write.

The system SHALL report that a review is running, and SHALL NOT offer to start a second review of the same pull request while one is running.

#### Scenario: Reviewing from the list

- **WHEN** the user starts a review from a pull request in the list
- **THEN** the review runs for that pull request
- **AND** the user does not have to open it first

#### Scenario: Reviewing an opened pull request

- **WHEN** the user starts a review while reading a pull request
- **THEN** the review runs for that pull request

#### Scenario: A colleague's pull request

- **WHEN** the pull request was opened by someone other than the user
- **THEN** the review is offered for it in the same way as for the user's own

#### Scenario: A review is already running

- **WHEN** a review of a pull request is running
- **THEN** the user is shown that it is running
- **AND** starting another review of that pull request is not offered

### Requirement: Reviewing changes nothing

The review SHALL be read-only. It SHALL NOT commit, SHALL NOT push, SHALL NOT alter the pull request's branch, and SHALL NOT change any recorded state of the pull request such as its status.

Any working copy the review needs SHALL be removed once the review has finished, including when the review fails.

#### Scenario: The branch is untouched

- **WHEN** a review of a pull request finishes
- **THEN** the pull request's branch is unchanged
- **AND** nothing has been committed or pushed

#### Scenario: The pull request's own state is untouched

- **WHEN** a review finishes, whatever it found
- **THEN** the pull request's status is what it was before
- **AND** which lists it appears in is unaffected

#### Scenario: The review fails partway

- **WHEN** a review cannot be completed
- **THEN** the failure is reported to the user
- **AND** no working copy is left behind

### Requirement: A finding names a place and says one thing

Each finding the review produces SHALL identify the file it concerns, the line in that file it concerns, and the remark to be made there.

A remark SHALL stand on its own as a comment on that line. It SHALL NOT depend on a summary, a heading, a score, or any other finding to be understood.

#### Scenario: A finding is produced

- **WHEN** the review finds something worth saying
- **THEN** the finding names a file, a line in it, and the remark

#### Scenario: The review finds nothing

- **WHEN** the review has no remark to make about the changes
- **THEN** the user is told that the review found nothing
- **AND** nothing is offered for posting

### Requirement: A finding that cannot be anchored is never posted

The system SHALL only publish a finding whose file and line correspond to a line of the pull request's changes that a comment can be attached to.

A finding that names a file not in the changes, or a line that is not part of them, SHALL NOT be published. The system SHALL report that it was discarded, and SHALL still offer the findings that can be anchored.

#### Scenario: A finding names a line outside the changes

- **WHEN** a finding names a line that is not part of the pull request's changes
- **THEN** it is not published
- **AND** the user is told it was discarded and why

#### Scenario: A finding names a file that was not changed

- **WHEN** a finding names a file the pull request does not change
- **THEN** it is not published
- **AND** the remaining findings are still offered

#### Scenario: Every finding is discarded

- **WHEN** no finding can be anchored to the changes
- **THEN** the user is told that nothing can be posted
- **AND** posting is not offered

### Requirement: Nothing is published without the user saying so

The system SHALL show the findings to the user and SHALL publish nothing until the user explicitly asks for it. Running a review SHALL NOT publish anything by itself.

The user SHALL be able to change a remark's wording before it is published, to discard a single finding, and to discard the review entirely without publishing.

What is published SHALL be what the user last saw, including any edit they made.

#### Scenario: A review finishes

- **WHEN** a review produces findings
- **THEN** they are shown to the user
- **AND** nothing has been posted to the pull request

#### Scenario: The user edits a remark

- **WHEN** the user changes the wording of a remark and then publishes
- **THEN** the edited wording is what is posted

#### Scenario: The user discards one finding

- **WHEN** the user discards a finding and then publishes
- **THEN** that finding is not posted
- **AND** the others are

#### Scenario: The user discards the review

- **WHEN** the user discards the review without publishing
- **THEN** nothing is posted to the pull request
- **AND** the pull request is unchanged

### Requirement: Findings are published as comments on their lines

When the user publishes, the system SHALL post each remaining finding as a comment attached to the line it names on the pull request.

The system SHALL NOT post a summary, a heading, a score, or any commentary of its own alongside them. Only the remarks are posted.

The system SHALL NOT submit a verdict on the pull request, such as approving it or requesting changes.

#### Scenario: Publishing findings

- **WHEN** the user publishes two findings on different lines
- **THEN** two comments appear on the pull request, each on the line its finding names
- **AND** nothing else is posted

#### Scenario: No summary is added

- **WHEN** findings are published
- **THEN** no overall comment, heading or score accompanies them

#### Scenario: No verdict is given

- **WHEN** findings are published
- **THEN** the pull request is neither approved nor marked as needing changes by the system

### Requirement: A failure to publish is reported and never silent

The system SHALL report a failure to publish to the user, and SHALL make clear what was posted and what was not.

Publishing SHALL NOT be reported as done when it was not.

#### Scenario: Publishing fails

- **WHEN** publishing a finding fails
- **THEN** the user is told it failed
- **AND** the user can tell which findings reached the pull request and which did not

#### Scenario: The pull request cannot be reached

- **WHEN** the pull request cannot be reached at all
- **THEN** the failure is reported
- **AND** the findings are still available to the user rather than lost
