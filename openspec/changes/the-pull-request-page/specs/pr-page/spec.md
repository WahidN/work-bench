## Purpose

Puts everything needed to act on a pull request on its own page, so working on one is not
split between a page and a panel opened from somewhere else.

## ADDED Requirements

### Requirement: The page says whether Workbench has reviewed it

A review that found nothing to say and a review that never ran are different answers. The
page SHALL say which, and SHALL say when the review ran.

This SHALL hold whether or not the review left any remarks.

#### Scenario: Never reviewed

- **WHEN** the user opens a pull request Workbench has not reviewed
- **THEN** the page says it has not been reviewed

#### Scenario: Reviewed with nothing to say

- **WHEN** the user opens a pull request that was reviewed and produced no remarks
- **THEN** the page says it was reviewed, and when

#### Scenario: Reviewed with remarks

- **WHEN** the user opens a pull request that was reviewed and has remarks waiting
- **THEN** the page says it was reviewed, and when
- **AND** the remarks are on the page

### Requirement: The page says what is running on this pull request

An agent takes minutes, and the page the user is on while one works is this one. The page
SHALL list the agents running on this pull request, naming what each is doing and how long
it has been going.

An agent working on anything else SHALL NOT be listed here.

#### Scenario: A review is running

- **WHEN** a review is running on the open pull request
- **THEN** the page says a review is running, and for how long

#### Scenario: An agent is running on a different pull request

- **WHEN** an agent is running on another pull request
- **THEN** the open pull request's page lists nothing

#### Scenario: Nothing is running

- **WHEN** no agent is running on this pull request
- **THEN** the page lists no agents

### Requirement: The agent is told what to do from the page

The page SHALL offer a composer that sends an instruction to the agent for this pull
request, and SHALL show the thread of what has been asked and answered.

The composer SHALL show the message the moment it is sent and SHALL say the agent is
working until the send finishes, because the send holds its request open for as long as the
agent runs.

A failed send SHALL leave the typed text in the composer.

#### Scenario: Sending an instruction

- **WHEN** the user types an instruction and sends it
- **THEN** the message is in the thread at once
- **AND** the page says the agent is working

#### Scenario: The agent answers

- **WHEN** the send finishes
- **THEN** the answer is in the thread
- **AND** the page no longer says the agent is working

#### Scenario: The send fails

- **WHEN** the send fails
- **THEN** the typed text is still in the composer
- **AND** the page no longer says the agent is working

### Requirement: The agent panel is gone

The slide-over panel SHALL be removed, together with every button, menu entry and keyboard
shortcut that opened it.

Nothing in the app SHALL open a chat for a ticket, a Jira issue or a project, because the
pull request page is the only replacement this change builds.

#### Scenario: No agent action on a row

- **WHEN** the user is on Today, the pull request list, Jira, or a project
- **THEN** no row offers to open an agent panel

#### Scenario: The shortcut is gone

- **WHEN** the user presses the shortcut that opened the panel
- **THEN** nothing opens

#### Scenario: The stored threads survive

- **WHEN** a ticket, issue or project already has an agent thread stored
- **THEN** that thread is not deleted
