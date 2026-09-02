## Why

The Jira screen shows one project's issues as a single flat list with no indication of what state each issue is in. Since the fetch stopped filtering on `statusCategory != Done`, that list holds every issue ever assigned to the user: 684 rows across 19 project keys, 178 of them under `MR` alone, with closed work rendered identically to active work. The user cannot tell an In Progress issue from one closed two years ago.

Widening the query was deliberate and correct, because the old filter silently excluded any workflow status mapped to the Done category, hiding In Review and Blocked issues. The missing half is showing the status the app now has no reason not to know.

## What Changes

- The Jira fetch asks for each issue's `status` field and stores the status name and its category on the todo.
- The Jira screen groups a project's issues into sections by exact status name, in a stable order driven by status category, instead of one flat list.
- Each section header names the status and counts its issues, so a project with 178 issues reads as a handful of labelled groups.
- Migration 7 adds `status` and `status_category` to `todos`. Both are nullable: a manual todo has no Jira status, and issues stored before this change have none until the next poll refreshes them.
- No change to which issues are fetched. The JQL stays `assignee = currentUser() ORDER BY updated DESC`.

## Capabilities

### New Capabilities

- `jira-issue-status`: the app knows and displays the Jira workflow status of each mirrored issue, and groups the Jira screen by it.

### Modified Capabilities

None. This is the first OpenSpec change in this repository, so there are no existing specs under `openspec/specs/` to amend.

## Impact

**Engine**
- `engine/src/sources/jira.ts`: request the `status` field; carry status name and category through `SourceIssue`.
- `engine/src/types.ts`: `SourceIssue` and `Todo` gain the two status fields.
- `engine/src/db.ts`: `todos.status` and `todos.status_category` in `SCHEMA`, plus migration 7. A column change on an existing table, so `MIGRATIONS` is mandatory here, unlike the new-table case where `CREATE TABLE IF NOT EXISTS` in `SCHEMA` suffices.
- `engine/src/todos.ts`: `upsertJiraTodo` writes both columns; `rowToTodo` reads them.

**App**
- `app/Workbench/Models/Todo.swift`: two optional fields.
- `app/Workbench/Views/JiraLogic.swift`: a grouping function over rows, plus the section ordering rule.
- `app/Workbench/Views/JiraScreen.swift`: render grouped sections rather than a flat `ForEach`.

**Not affected**
- Which issues arrive. This change is display only.
- Today, the project detail screen, and the sidebar counts: they filter on `pinned` and `done`, not status.
- The agent chat, promote, and Create PR paths on the Jira row.

**Risk**
- Every existing Jira todo has a null status until the next poll rewrites it, so the screen must render an unknown-status group rather than dropping those rows.
- 19 projects with independent workflows may produce a long tail of sparse status names. Ordering by category keeps active work at the top regardless.
