## Purpose

Lets the user review the code of a pull request from inside Workbench, in the background, and publish the resulting remarks as comments on the lines they are about, one at a time and each on the user's own say-so.

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

### Requirement: A review runs in the background

Starting a review SHALL NOT block the screen it was started from, and SHALL NOT require the user to wait on it or keep any particular screen open. A review takes minutes, and the user SHALL be free to work elsewhere while it runs.

#### Scenario: The user carries on working

- **WHEN** a review has been started
- **THEN** the user can move to another screen and keep using the app
- **AND** the review continues

#### Scenario: The user leaves the pull request

- **WHEN** the user navigates away from the pull request a review was started for
- **THEN** the review is not cancelled

### Requirement: A finished review announces itself

When a review finishes and has remarks to show, the system SHALL notify the user, because nothing is waiting on screen for the result.

A review that produced nothing to post SHALL NOT be announced as though it had.

A notification SHALL point the user at the pull request the review belongs to.

#### Scenario: A review finishes with remarks

- **WHEN** a review finishes and has remarks that can be posted
- **THEN** the user is notified
- **AND** the notification identifies which pull request it is about

#### Scenario: A review finishes with nothing to say

- **WHEN** a review finishes with no remark that can be posted
- **THEN** the user is not interrupted as though there were something to act on

#### Scenario: A review fails

- **WHEN** a review cannot be completed
- **THEN** the failure is made visible to the user rather than leaving the review looking as if it were still running

### Requirement: A finished review waits until it is dealt with

The system SHALL keep a finished review's remarks until the user posts or discards them. They SHALL survive the user navigating elsewhere, and SHALL survive the system restarting.

The remarks SHALL be read on the pull request they belong to.

A review interrupted by a restart SHALL NOT be left appearing to run forever.

#### Scenario: The user comes back later

- **WHEN** the user opens a pull request some time after its review finished
- **THEN** the remarks are still there, unposted

#### Scenario: The system restarts

- **WHEN** the system restarts after a review has finished
- **THEN** the remarks are still there

#### Scenario: A review is interrupted by a restart

- **WHEN** the system restarts while a review is running
- **THEN** that review is not reported as still running
- **AND** the user can start a new review of that pull request

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

### Requirement: Nothing is published without the user saying so, one remark at a time

The system SHALL publish nothing until the user explicitly asks for it, and SHALL treat each remark as its own decision: the user SHALL be able to post one remark without posting any other. Running a review SHALL NOT publish anything by itself.

The user SHALL be able to change a remark's wording before it is published, and to discard a single remark without posting it.

What is published SHALL be what the user last saw for that remark, including any edit they made.

A remark that has been posted SHALL be shown as posted, and SHALL NOT be offered for posting again.

#### Scenario: A review finishes

- **WHEN** a review produces remarks
- **THEN** they are shown on the pull request
- **AND** nothing has been posted to the pull request

#### Scenario: The user posts one remark

- **WHEN** the user posts a single remark
- **THEN** that remark appears on the pull request
- **AND** the other remarks are not posted
- **AND** they are still available to post afterwards

#### Scenario: The user edits a remark

- **WHEN** the user changes the wording of a remark and then posts it
- **THEN** the edited wording is what is posted

#### Scenario: The user discards one remark

- **WHEN** the user discards a remark
- **THEN** it is not posted
- **AND** it is no longer offered
- **AND** the others are unaffected

#### Scenario: An already posted remark

- **WHEN** a remark has been posted
- **THEN** it is shown as posted
- **AND** posting it a second time is not offered

### Requirement: Remarks written against an earlier commit are marked

When the pull request has moved on since a review was written, the system SHALL say so rather than deleting the remarks or presenting them as current.

The remarks SHALL remain available to post, because whether they still apply is the user's judgement.

#### Scenario: The branch has moved on

- **WHEN** the pull request has new commits since its review was written
- **THEN** the remarks are marked as written against an earlier commit
- **AND** they are still offered

#### Scenario: The branch has not moved

- **WHEN** the pull request is still at the commit its review was written against
- **THEN** the remarks are not marked as outdated

### Requirement: Remarks are published as comments on their lines

When the user posts a remark, the system SHALL post it as a comment attached to the line it names on the pull request.

The system SHALL NOT post a summary, a heading, a score, or any commentary of its own alongside them. Only the remarks are posted.

The system SHALL NOT submit a verdict on the pull request, such as approving it or requesting changes.

#### Scenario: Posting remarks

- **WHEN** the user posts two remarks on different lines
- **THEN** two comments appear on the pull request, each on the line its remark names
- **AND** nothing else is posted

#### Scenario: No summary is added

- **WHEN** remarks are posted
- **THEN** no overall comment, heading or score accompanies them

#### Scenario: No verdict is given

- **WHEN** remarks are posted
- **THEN** the pull request is neither approved nor marked as needing changes by the system

### Requirement: A failure to post is reported on the remark that failed

The system SHALL report a failure to post, against the remark it failed for, and SHALL keep that remark available rather than losing it.

Posting SHALL NOT be reported as done when it was not. A failure on one remark SHALL NOT affect any other.

#### Scenario: Posting one remark fails

- **WHEN** posting a remark fails
- **THEN** the user is told it failed, on that remark
- **AND** the remark is still there to try again
- **AND** it is not shown as posted

#### Scenario: The pull request rejects the anchor

- **WHEN** the pull request will not accept a comment on that line
- **THEN** the reason is reported on that remark
- **AND** the other remarks are unaffected

#### Scenario: The pull request cannot be reached

- **WHEN** the pull request cannot be reached at all
- **THEN** the failure is reported
- **AND** the remarks are still available to the user rather than lost
