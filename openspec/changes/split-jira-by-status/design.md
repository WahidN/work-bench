## Context

See proposal.md - Why for the motivation, and `specs/jira-issue-status/spec.md` for the behaviour contract.

The constraints that shape the approach:

- Jira issues are mirrored into the `todos` table, not `tickets`. Adding fields therefore means changing an existing table, which in this engine means an append-only entry in `MIGRATIONS` in `engine/src/db.ts`. `CREATE TABLE IF NOT EXISTS` in `SCHEMA` silently no-ops on a column change, so `SCHEMA` alone is not enough. That distinction was established when `todo_messages` was added, where a new table did need only `SCHEMA`.
- `engine/src/sources/jira.ts` is the only file that talks to the Jira API. It currently requests `fields: 'summary,description,project'`.
- The Jira screen already groups by project via `JiraLogic.groups`, and renders one project's rows through `JiraLogic.rows` as a flat list. `JiraRow` is a presentation struct assembled there, and `JiraLogic` is a pure enum with tests, which is where the grouping rule belongs.
- 684 issues across 19 project keys, each project free to define its own workflow, so the number of distinct status names is unbounded and unknown ahead of time.

## Goals

- The status shown is whatever Jira calls it, with no mapping table in Workbench to maintain.
- Grouping and ordering are decided by a pure, tested function, so the ordering rule can be verified without a running app.
- An issue stored before this change stays visible.

## Non-Goals

- Filtering or hiding issues by status. Every assigned issue still appears; this change only groups them. Whether to also cap the fetch by recency is a separate decision the user has not made.
- Collapsing or remembering collapsed groups. Sections render expanded.
- Showing status anywhere but the Jira screen. Today, the project detail Tasks tab and the sidebar counts key off `pinned` and `done`, and are deliberately untouched.
- Reacting to a status change beyond redrawing, for example notifying when an issue becomes Blocked.

## Decisions

### Store the status name and its category, not just the name

Two columns, `status` and `status_category`, both nullable text.

The name alone cannot drive ordering: "Blocked" and "In Review" are meaningless to sort against "Done" without knowing which are active. The category supplies that, and Atlassian's model defines exactly three of them, keyed `new`, `indeterminate` and `done`. Those key names come from Atlassian's documentation, not from a response observed against this instance: no payload containing `status` has been inspected yet, because the diagnostics run so far requested only `summary,description,project`. Task 1.4 prints a real `fields.status` before the shape is relied on. Deriving the category from the status name inside Workbench instead would require a mapping table for every workflow in the company, which is exactly the maintenance burden this avoids.

Alternative considered: store only the name and sort alphabetically. Rejected because it puts "Done" above "In Progress" and buries active work.

### Both columns nullable, with an explicit unknown group

A manual todo has no Jira status, and every one of the 684 existing rows has none until the next poll rewrites it. Making the columns `NOT NULL DEFAULT ''` would be a lie dressed as data: an empty string is indistinguishable from a real status Workbench failed to read.

So they are nullable, and the spec requires an "unknown" group rendered last. That group is expected to be empty in normal operation after one poll, which is also how we will know the migration worked.

Alternative considered: backfill by fetching statuses for existing rows during migration. Rejected because a migration must not make network calls, and the next poll does the job within five minutes.

### Order groups by category, then by count, then by name

Category order is fixed: in progress, to do, done, then unknown. Within a category, descending count then alphabetical.

Category first is what keeps active work at the top no matter how many statuses a workflow defines. Count second means the group a user most likely wants is nearest the top of its category. Name third makes the order deterministic, which matters because a non-deterministic order would make the list appear to reshuffle between fetches.

Alternative considered: ordering by Jira's own workflow step order. Rejected because the API does not expose a reliable global ordering across projects, and 19 workflows have no common sequence.

### Grouping lives in `JiraLogic`, and `JiraRow` is unchanged

A new function returns groups of already-built rows, rather than changing `JiraRow` or `rows`. `JiraScreen` then renders sections of rows instead of a flat list.

This keeps the existing row assembly, its tests, and every row action (promote, Create PR, pin, chat) untouched, and confines the new rule to one tested function. It also means the change is additive at the logic layer: nothing that currently consumes `rows` has to move.

## Risks / Trade-offs

- **A long tail of sparse groups.** 19 independent workflows could yield many one-issue groups, making a project read as a list of headers. → Category ordering keeps the useful groups at the top, and descending count within a category pushes singletons down. If it proves unusable in practice, collapsing or a "show more" affordance is a follow-up, not part of this change.
- **Status is only as fresh as the last poll.** An issue transitioned in Jira sits in the wrong group until the next cycle, up to five minutes, or until the user clicks Refresh. → Acceptable, and identical to how every other Jira-derived field already behaves.
- **The unknown group could become permanent** if a fetch never rewrites some rows, for example an issue that has since been unassigned and so no longer appears in the query. Reconciliation deletes issues absent from the fetch, so such a row is removed rather than stranded. → No mitigation needed, but the unknown group is the signal to watch: if it persists after a successful poll, reconciliation is not doing its job.
- **Migration 7 runs against the user's real 684-row database.** → It is two `ALTER TABLE ADD COLUMN` statements with no data rewrite, the same shape as migrations 1 to 4, and the drift test in `engine/tests/db.test.ts` asserts a migrated database ends up with the same columns as a fresh one.

## Migration Plan

1. Migration 7 adds both columns, nullable, to `todos`. Existing rows get null.
2. On the next poll, `upsertJiraTodo` writes the real status for every issue Jira returns, which is all 684 of them.
3. The unknown group is visible between the engine restarting and that first poll finishing, then empties.

Rollback: reverting the code leaves two unread columns on `todos`. Nothing reads them, so no cleanup is required; SQLite would need a table rebuild to drop them, which is not worth doing. `user_version` stays at 7, so re-applying the reverted code does not replay the migration.

## Open Questions

None. The one open decision, whether to also cap the fetch by recency now that closed issues arrive, is deliberately out of scope here and does not affect these specs, this approach, or the task breakdown.
