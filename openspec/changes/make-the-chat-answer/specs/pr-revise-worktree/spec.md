## Purpose

Gives a revise request a worktree that matches what was asked, so a request about a merge
conflict has the conflict in front of it and a request that cannot work is answered instead
of run.

## ADDED Requirements

### Requirement: The prompt says what the worktree is

A revise run opens a detached checkout of the branch head. Nothing is merged and nothing is
in progress. The system SHALL say that in the prompt, so the agent does not assume a state
that is not there.

#### Scenario: An ordinary revision

- **WHEN** the agent is asked to revise the branch
- **THEN** the prompt says the worktree is a detached checkout of the branch head with no
  merge in progress

### Requirement: A conflict request opens the worktree mid-merge

When the request is about a merge conflict and the branch conflicts with the project's
default branch, the system SHALL start that merge in the worktree before the agent runs, and
SHALL say in the prompt that the merge is in progress and which files conflict.

The result SHALL be published the way any other revision is: committed, pushed to the pull
request's branch, and reviewed again.

#### Scenario: Asking to fix a real conflict

- **WHEN** the user asks to fix the merge conflict on a branch that conflicts with the
  default branch
- **THEN** the worktree has that merge started and the conflict in it
- **AND** the prompt names the conflicting files

#### Scenario: A revision that is not about conflicts

- **WHEN** the user asks for any other change on a branch that conflicts with the default
  branch
- **THEN** no merge is started
- **AND** the diff gains no merge commit

### Requirement: A conflict that does not exist is answered, not run

Running an agent to fix a conflict that is not there costs the full timeout and answers
nothing. When the request is about a conflict and the branch merges cleanly, the system
SHALL answer in the thread and SHALL NOT run the agent.

#### Scenario: Asking about a conflict on a clean branch

- **WHEN** the user asks to fix the merge conflict on a branch that merges cleanly
- **THEN** the thread holds an assistant message saying the branch has no conflict
- **AND** no agent is started

#### Scenario: Git cannot say

- **WHEN** the conflict check itself fails
- **THEN** the branch is not treated as clean
- **AND** the request is run rather than refused
