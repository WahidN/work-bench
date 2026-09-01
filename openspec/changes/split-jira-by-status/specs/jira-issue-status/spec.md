## Purpose

Makes the workflow state of every mirrored Jira issue visible in Workbench, so a project's issues read as labelled groups of active and finished work instead of one undifferentiated list.

## ADDED Requirements

### Requirement: A mirrored Jira issue carries its workflow status

The system SHALL record, for every Jira issue it mirrors, the issue's status name exactly as Jira reports it and the category that status belongs to. A status name SHALL NOT be normalised, translated, or mapped onto a fixed set: whatever the project's workflow calls the status is what the system stores and shows.

The category SHALL be one of the three Atlassian status categories: to do, in progress, or done.

#### Scenario: An issue in a custom workflow status

- **WHEN** Jira reports an assigned issue whose status is named "Ready for test" in the in-progress category
- **THEN** the system records the status name "Ready for test" and the category in progress
- **AND** the issue appears under a group labelled "Ready for test"

#### Scenario: An issue whose status changes in Jira

- **WHEN** an issue already mirrored as "To Do" is moved to "In Progress" in Jira and the next fetch runs
- **THEN** the recorded status name and category are replaced with the new ones
- **AND** the issue appears under the "In Progress" group rather than "To Do"

#### Scenario: A task that did not come from Jira

- **WHEN** the user creates a task by hand in Workbench
- **THEN** that task has no status name and no category
- **AND** nothing about the Jira screen's grouping applies to it

### Requirement: The Jira screen groups a project's issues by status

When a project is selected on the Jira screen, the system SHALL present that project's issues in groups, one per distinct status name, rather than as a single flat list. Each group SHALL be labelled with the status name and the number of issues it contains.

Group order SHALL be determined by status category, in the order in progress, to do, then done, so that active work appears above finished work regardless of how many statuses a workflow defines. Within a category, groups SHALL be ordered by descending issue count, and ties broken alphabetically by status name, so ordering is stable between fetches.

Within a group, the existing issue ordering SHALL be preserved.

#### Scenario: A project with issues in several statuses

- **WHEN** the selected project has 40 issues across "In Progress", "To Do" and "Done"
- **THEN** three groups are shown, each labelled with its status name and count
- **AND** "In Progress" appears above "To Do", which appears above "Done"

#### Scenario: A workflow with several statuses in one category

- **WHEN** the selected project has issues in "In Review" and "Blocked", both in the in-progress category, with more issues in "Blocked"
- **THEN** both groups appear above every to-do and done group
- **AND** "Blocked" appears above "In Review", because it holds more issues

#### Scenario: A project whose issues are all in one status

- **WHEN** every issue in the selected project has the status "Done"
- **THEN** a single group labelled "Done" is shown with the full count
- **AND** no empty groups are shown for statuses the project does not use

#### Scenario: A project with no issues

- **WHEN** the selected project has no mirrored issues
- **THEN** no groups are shown
- **AND** the screen's existing empty state is shown instead

### Requirement: Issues stored before statuses were recorded remain visible

The system SHALL continue to show an issue whose status is unknown, because it was mirrored before the system began recording statuses and has not been refreshed since. Such issues SHALL be collected into a single group, labelled to say the status is not known yet, placed last so it never displaces active work.

An unknown status SHALL NOT cause an issue to be hidden, dropped, or reported as an error.

#### Scenario: A database written before this change

- **WHEN** the Jira screen opens on a project whose issues were all mirrored before statuses were recorded
- **THEN** every issue is still listed, in one group saying the status is not known yet
- **AND** the next successful fetch replaces that group with real status groups

#### Scenario: A mix of known and unknown statuses

- **WHEN** a project holds some issues with a recorded status and some without
- **THEN** the issues with a status appear in their own groups, ordered by category
- **AND** the remaining issues appear in the unknown group, last
