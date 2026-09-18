## Purpose

Makes resolving a merge conflict a button on the pull request that has one, instead of a
sentence the user has to know to type.

## ADDED Requirements

### Requirement: A conflicting pull request offers to resolve it

The system SHALL record what GitHub reports about whether a pull request can be merged, and
SHALL offer a resolve action on a pull request GitHub reports as conflicting.

A pull request GitHub reports as mergeable SHALL NOT offer it. GitHub computes this lazily
and answers that it does not know until it has, and an unknown answer SHALL NOT offer it
either, because the premise of the action would be unverified.

#### Scenario: The branch conflicts

- **WHEN** the user opens a pull request GitHub reports as conflicting
- **THEN** the page offers to resolve the conflict

#### Scenario: The branch merges cleanly

- **WHEN** the user opens a pull request GitHub reports as mergeable
- **THEN** the page offers no resolve action

#### Scenario: GitHub has not worked it out yet

- **WHEN** GitHub has not computed whether the pull request can be merged
- **THEN** the page offers no resolve action
- **AND** the answer is picked up on a later poll

### Requirement: Resolving runs the same turn as asking for it

The resolve action SHALL run the same work as instructing the agent to resolve the conflict
in the composer, so both leave the same record.

Its result SHALL land in the pull request's thread, and it SHALL hold the same lock as any
other agent on that pull request, so it is listed while it runs and cannot run twice.

#### Scenario: Pressing resolve

- **WHEN** the user presses the resolve action
- **THEN** the agent works on the conflict with the merge started in its worktree
- **AND** the outcome is in the pull request's thread

#### Scenario: Resolve while an agent is already working

- **WHEN** the user presses the resolve action while an agent is working on that pull
  request
- **THEN** the request is refused rather than run alongside it

#### Scenario: GitHub was behind

- **WHEN** the user presses resolve and the branch turns out to merge cleanly
- **THEN** the thread says the branch has no conflict
- **AND** no agent is started
