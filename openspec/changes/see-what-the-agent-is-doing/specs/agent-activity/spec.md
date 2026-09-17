## Purpose

Shows the user every agent Workbench has started and is still running, with what it is doing
and what it is working on, from anywhere in the app rather than only from the screen that
started it.

## ADDED Requirements

### Requirement: Running agents are listed apart from the screen that started them

The system SHALL offer a list of the agents it is running, reachable from anywhere in the
app.

Each entry SHALL name what the agent is doing, what it is working on, and how long it has
been running. An entry for a pull request SHALL name that pull request, and opening the entry
SHALL open it.

The list SHALL be current without the user asking for it again, because an agent finishes
while the user is on another screen.

#### Scenario: An agent is running while the user is elsewhere

- **WHEN** an agent started from Workbench is running and the user is on any screen
- **THEN** the app says an agent is running
- **AND** the list names what it is doing and which pull request it is on

#### Scenario: Opening what an agent is working on

- **WHEN** the user opens an entry for an agent working on a pull request
- **THEN** that pull request opens

#### Scenario: Nothing is running

- **WHEN** no agent is running
- **THEN** the app shows no running count

### Requirement: Only real agent work is listed

A job lock is taken by work that runs no agent, such as building a diff or comparing a head
sha. The system SHALL NOT present such a lock as a running agent.

#### Scenario: A lock held without an agent

- **WHEN** the engine holds a pull request's job lock to build a diff or read its head sha
- **THEN** no agent is listed for that pull request

#### Scenario: A review and a fix

- **WHEN** the engine is reviewing one pull request and fixing a comment on another
- **THEN** both are listed, each named for what it is doing

### Requirement: Work waiting its turn is listed as waiting

Fixes on one pull request run one at a time, so a fix can be queued behind another for
minutes before anything starts. The system SHALL list a queued fix, and SHALL distinguish it
from one that is running, so the user is told why nothing is happening yet.

#### Scenario: A second fix on the same pull request

- **WHEN** the user asks for a fix while another fix on the same pull request is running
- **THEN** the running fix is listed as running
- **AND** the queued fix is listed as waiting

### Requirement: A restart leaves no agent listed

An agent does not survive the engine stopping. After a restart the system SHALL NOT list work
that was running before it, so the list never shows an agent that no process is behind.

#### Scenario: The engine restarts mid-run

- **WHEN** the engine restarts while an agent is running
- **THEN** nothing is listed as running once it is up
