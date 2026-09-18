## Purpose

Makes a chat send visible for as long as it runs and readable when it fails, so a send that
went wrong never looks the same as a send that never happened.

## ADDED Requirements

### Requirement: A failed run is answered in the thread

A chat send stores the user's message before it runs the agent. When the run fails, the
system SHALL write the failure into the same thread as an assistant message, so the question
is not left with no answer under it.

This SHALL hold for every kind of chat the app offers: a project, a ticket, an issue and a
pull request.

The message SHALL say what failed in terms the user can act on, and SHALL name a timeout as
a timeout rather than as an error code.

#### Scenario: The agent run times out

- **WHEN** a chat send runs the agent and the run is killed on its timeout
- **THEN** the thread holds an assistant message saying the run timed out
- **AND** the user's own message is still there above it

#### Scenario: The send fails before the agent starts

- **WHEN** a chat send fails before the agent runs, such as a worktree that cannot be opened
- **THEN** the thread holds an assistant message saying so

#### Scenario: A pull request action fails after the agent finished

- **WHEN** the agent finishes and the push or the merge that follows it fails
- **THEN** the thread holds an assistant message naming that step

#### Scenario: A successful send is unchanged

- **WHEN** a chat send succeeds
- **THEN** the thread holds the agent's reply and no failure message

### Requirement: A failed run reaches the engine log

The jobs table is not somewhere the user can look. The system SHALL log one line for a
failed chat send, naming the kind of chat, what it was working on, and the failure.

#### Scenario: Reading back what went wrong

- **WHEN** a chat send has failed
- **THEN** the engine log holds a line for it

### Requirement: The panel shows the message while the agent works

A send holds its request open for as long as the agent runs, which is minutes. The panel
SHALL show the sent message in the transcript at once, and SHALL say that the agent is
working, until the send finishes.

The echo SHALL be replaced by the stored message when the thread is read back, never shown
next to it.

#### Scenario: Sending and waiting

- **WHEN** the user sends a message and the agent is still running
- **THEN** the transcript shows that message
- **AND** the panel says the agent is working

#### Scenario: The reply arrives

- **WHEN** the send finishes and the thread is read back
- **THEN** the transcript shows the stored message once
- **AND** the panel no longer says the agent is working

#### Scenario: The send fails

- **WHEN** the send fails
- **THEN** the panel no longer says the agent is working
- **AND** the draft is still in the composer to send again
