## Purpose

Lets the user act on a review comment from the thread it sits in, by handing the remark and their own instruction to the agent, which changes the pull request's branch to answer it while the user works elsewhere.

## ADDED Requirements

### Requirement: A review comment can be handed to the agent

The system SHALL offer, on a review comment thread of an opened pull request, an action that sends the user's own words to the agent as an instruction to change the code the comment is about.

The instruction the agent receives SHALL include the comment being answered, the file and the line it is attached to, and the user's words. The user SHALL NOT have to restate the remark for the agent to know which problem is meant.

The action SHALL NOT be offered without something to send: an empty instruction SHALL NOT start anything.

#### Scenario: Handing a remark to the agent

- **WHEN** the user writes an instruction on a review comment thread and starts a fix
- **THEN** the agent is asked to change the code that comment is about
- **AND** it is given the comment, its file and line, and the user's instruction

#### Scenario: The user says nothing

- **WHEN** the instruction is empty or only whitespace
- **THEN** no fix is started

### Requirement: Only a pull request the user wrote can be fixed

A fix changes the pull request's branch, so the system SHALL offer it only on a pull request the user authored.

On a pull request the user did not author, the system SHALL NOT offer the action and SHALL NOT accept a fix for it by any other route. The thread SHALL still show its comments, and the system SHALL say that replying to the reviewer happens on GitHub, so the user is not left looking for an action that is deliberately absent.

#### Scenario: The user's own pull request

- **WHEN** the user opens a review comment thread on a pull request they authored
- **THEN** the fix action is offered

#### Scenario: A colleague's pull request

- **WHEN** the user opens a review comment thread on a pull request someone else authored
- **THEN** the fix action is not offered
- **AND** the comments on that thread are still shown
- **AND** the user is told that replying happens on GitHub

#### Scenario: A fix is asked for anyway

- **WHEN** a fix is requested for a pull request the user did not author
- **THEN** it is refused
- **AND** nothing is committed or pushed

### Requirement: Replying to a review comment is not offered

Answering a reviewer in words is not part of this capability. The system SHALL NOT post a reply to a review comment on the user's behalf, and SHALL NOT offer to.

#### Scenario: The user wants to answer the reviewer

- **WHEN** the user reads a review comment
- **THEN** the system offers no way to post a text reply to it
- **AND** nothing the user types on the thread reaches the pull request as a comment

### Requirement: A fix runs in the background

Starting a fix SHALL NOT block the screen it was started from, and SHALL NOT require the user to wait on it or keep any particular screen open. A fix takes minutes, and the user SHALL be free to work elsewhere while it runs.

The system SHALL report on the thread it was asked from whether a fix is running or waiting its turn.

#### Scenario: The user carries on working

- **WHEN** a fix has been started
- **THEN** the user can move to another screen and keep using the app
- **AND** the fix continues

#### Scenario: The user leaves the pull request

- **WHEN** the user navigates away from the pull request a fix was started for
- **THEN** the fix is not cancelled

#### Scenario: A fix is running

- **WHEN** a fix is running for a thread
- **THEN** that thread shows that it is running

#### Scenario: A fix is waiting its turn

- **WHEN** a fix cannot start yet because the pull request is busy
- **THEN** that thread shows that it is waiting rather than running

### Requirement: A finished fix announces itself

When a fix finishes, the system SHALL notify the user, because nothing is waiting on screen for the result.

A notification SHALL name the pull request the fix belongs to. A fix SHALL be announced once, not again on every later look at it.

#### Scenario: A fix lands

- **WHEN** a fix finishes and has changed the branch
- **THEN** the user is notified
- **AND** the notification identifies which pull request it is about

#### Scenario: The user is not told twice

- **WHEN** a fix has already been announced
- **THEN** it is not announced again

#### Scenario: A fix fails

- **WHEN** a fix cannot be completed
- **THEN** the failure is made visible to the user rather than leaving the fix looking as if it were still running
- **AND** the reason is shown on the thread it was started from

### Requirement: Every attempt's outcome waits on its thread

The system SHALL keep what became of each fix on the thread it was asked for, and SHALL keep it until the pull request itself is gone. An outcome SHALL survive the user navigating elsewhere and SHALL survive the system restarting.

A comment MAY carry more than one attempt. Each SHALL keep its own instruction and its own outcome, in the order they were asked for, so a second attempt does not erase what the first did or reported.

A fix interrupted by a restart SHALL NOT be left appearing to run, or appearing to be waiting its turn, and the user SHALL be able to ask again afterwards.

#### Scenario: The user comes back later

- **WHEN** the user opens a pull request some time after a fix on one of its threads finished
- **THEN** that thread still says what the fix did

#### Scenario: A second attempt on the same comment

- **WHEN** the user asks for another fix on a comment that already has one
- **THEN** both are shown on that thread, each with its own instruction and outcome
- **AND** the earlier one is not erased

#### Scenario: The system restarts

- **WHEN** the system restarts after a fix has finished
- **THEN** the outcome is still on the thread

#### Scenario: A fix is interrupted by a restart

- **WHEN** the system restarts while a fix is running or waiting its turn
- **THEN** that fix is not reported as still running or still waiting
- **AND** the user can ask for a new fix on that thread

### Requirement: A fix changes only that pull request's branch

A fix SHALL commit its changes and publish them on the branch of the pull request it was started from, so the reviewer sees the answer on the pull request they commented on.

A fix SHALL NOT publish to any other branch, SHALL NOT open a new pull request, and SHALL NOT change the pull request's recorded state, such as its status or which lists it appears in. A remark about one line is not a verdict on the whole pull request.

The system SHALL refuse to publish rather than overwrite work that arrived on the branch after the fix started.

Any working copy the fix needs SHALL be removed once it has finished, including when it fails.

#### Scenario: A fix lands on the branch

- **WHEN** a fix finishes with changes
- **THEN** they are committed and published on that pull request's branch
- **AND** no other branch is written to
- **AND** no new pull request is opened

#### Scenario: The pull request's own state is untouched

- **WHEN** a fix finishes, whatever it changed
- **THEN** the pull request's status is what it was before
- **AND** which lists it appears in is unaffected

#### Scenario: The branch moved on while the fix ran

- **WHEN** the branch received other work after the fix started
- **THEN** the fix does not overwrite it
- **AND** the user is told the fix could not be published, on that thread

#### Scenario: The fix fails partway

- **WHEN** a fix cannot be completed
- **THEN** the failure is reported to the user
- **AND** no working copy is left behind

### Requirement: A fix that changes nothing says so

When the agent finds nothing to change for an instruction, the system SHALL report that on the thread and SHALL publish nothing. It SHALL NOT be reported as a fix that landed, and it SHALL NOT be reported as a failure of the system.

#### Scenario: The agent finds nothing to change

- **WHEN** a fix produces no change to the code
- **THEN** the thread says that nothing was changed
- **AND** nothing is committed or published
- **AND** the user can try again with a clearer instruction

### Requirement: Several fixes may be asked for, and they run one at a time

The user SHALL be able to ask for a fix without waiting for one already asked for. Asking SHALL NOT be refused because the pull request is busy.

A fix, a review, and the agent's other work on a pull request all need that pull request's code, so the system SHALL work on only one of them at a time for the same pull request. Fixes waiting their turn SHALL be started in the order they were asked for.

A fix that is waiting rather than running SHALL say so on its thread, so the delay is not read as a fix doing nothing. A fix waiting behind work of another kind, such as a review, SHALL keep its place rather than being failed.

Pull requests SHALL NOT wait on each other.

#### Scenario: Asking for several at once

- **WHEN** the user asks for a fix on three comments of one pull request without waiting
- **THEN** all three are accepted
- **AND** each says whether it is running or waiting its turn

#### Scenario: They run in the order they were asked for

- **WHEN** three fixes are waiting on one pull request
- **THEN** they are started in the order the user asked for them
- **AND** only one is running at any moment

#### Scenario: A review is already running

- **WHEN** the user asks for a fix on a pull request whose review is running
- **THEN** the fix is accepted and waits
- **AND** it starts once the review has finished

#### Scenario: A fix on another pull request

- **WHEN** a fix is running on one pull request and the user asks for one on a different pull request
- **THEN** both run
