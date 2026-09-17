## Purpose

Tells the user, from the pull request list, whether Workbench has reviewed a pull request, so
reviewing the same one twice is a choice rather than an accident.

## ADDED Requirements

### Requirement: The pull request list says whether Workbench has reviewed it

The system SHALL show on each pull request row whether Workbench has reviewed it, and when
that review ran.

This SHALL be distinct from the review decision GitHub reports. A pull request GitHub calls
approved may never have been reviewed by Workbench, and one Workbench has reviewed may still
be waiting on GitHub.

#### Scenario: A reviewed pull request

- **WHEN** Workbench has reviewed a pull request
- **THEN** its row says so, and says when the review ran

#### Scenario: An unreviewed pull request

- **WHEN** Workbench has never reviewed a pull request
- **THEN** its row says it has not been reviewed

#### Scenario: GitHub's decision is not Workbench's

- **WHEN** GitHub reports a pull request as approved and Workbench has never reviewed it
- **THEN** the row still says Workbench has not reviewed it

### Requirement: A review that found nothing still counts as reviewed

A review that had nothing to say stores no remarks. The system SHALL still record that the
review ran, so a clean pull request does not read as an unreviewed one.

#### Scenario: A clean review

- **WHEN** a review finishes and finds nothing to remark on
- **THEN** the pull request reads as reviewed

#### Scenario: A failed review

- **WHEN** a review fails before it finishes
- **THEN** the pull request does not read as reviewed

### Requirement: A branch Workbench moves drops its review

A review is written against one commit. When the system itself pushes to a reviewed pull
request's branch, it SHALL stop reporting that pull request as reviewed, because the review
no longer describes the branch.

This covers the pushes the system makes: a landed comment fix and a chat revision. It does
not cover a push made outside Workbench. `gh search prs` does not carry a head sha, and
reading one per pull request means a worktree per row on every poll, which would take the
job lock away from the agents this change exists to show. The pull request's own page still
reports its findings as outdated, which is the exact answer, computed where a worktree is
already open.

#### Scenario: A fix lands on the branch

- **WHEN** a comment fix commits and pushes to a reviewed pull request's branch
- **THEN** the pull request reads as unreviewed

#### Scenario: A fix that changed nothing

- **WHEN** a comment fix finds nothing to change and pushes nothing
- **THEN** the pull request still reads as reviewed
