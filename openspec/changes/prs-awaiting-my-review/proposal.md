## Why

The Pull requests screen has a "Needs review" tab, but a pull request where the user is only a requested reviewer never reaches Workbench at all. The engine asks GitHub for two things: pull requests the user authored, and pull requests assigned to the user. A colleague's pull request that names the user as a reviewer matches neither search, so it is never fetched and never stored. Review work is invisible in the app and has to be chased in GitHub's own interface.

Confirmed against the real setup: `gh search prs --review-requested=@me --state=open` returns `LinkuNijmegen/acv-website#45`, and that pull request is absent from the `prs` table while every one of the 7 stored rows has `authored_by_me = 1`.

The tab also does not mean what its name suggests. It keeps a pull request whose review decision is neither approved nor changes-requested, applied to a set that only ever holds the user's own work. So today it lists the user's own pull requests waiting on someone else, which is nearly the same set as "Mine".

## What Changes

- The engine also asks GitHub for open pull requests where the user is a requested reviewer, and stores that fact per pull request.
- **BREAKING** behaviour change: the "Needs review" tab lists pull requests waiting on the user's review. The user's own pull requests waiting on someone else no longer appear there; they stay available under "Mine" and "Assigned to me".
- A pull request the user neither authored nor is assigned to becomes visible in Workbench for the first time. The "Assigned to me" and "Mine" tabs must keep excluding it.
- A review request that is withdrawn or already dealt with clears on the next poll, so the tab does not keep work the user has finished.
- The existing truncation guard covers the third search too, so a capped result cannot make reconciliation delete stored pull requests.
- Unchanged: a pull request is still stored only when its repository is a configured project. `prs.project_id` is `NOT NULL REFERENCES projects(id)`, so a review request on a repository with no project stays out. This is why `linku-bergop4/bergop4-portal-app#101`, which the same search returns, will not appear.

## Capabilities

### New Capabilities

- `pr-review-queue`: pull requests waiting on the user's own review are collected from the source and shown apart from the user's own work.

### Modified Capabilities

None. `openspec/specs/` is empty, and the three capability specs proposed so far, `jira-issue-status`, `task-deletion` and `engine-lifecycle`, are untouched.

## Impact

**Engine**
- `engine/src/db.ts`: migration 8, one nullable-free `review_requested` column on `prs`, matching how `authored_by_me` and `assigned_to_me` are already declared.
- `engine/src/sources/githubPrs.ts`: a third `gh search prs` call with `--review-requested=@me`, a new flag on `GithubPr`, and the truncation flag widened to cover it.
- `engine/src/prs.ts`: carry the flag through `UpsertGithubPrInput`, both halves of the upsert, and `rowToPr`.
- `engine/src/types.ts`: the flag on `Pr`.
- `engine/src/poller.ts`: pass it through `upsertGithubPr`.

**App**
- `app/Workbench/Models/PullRequest.swift`: the flag, optional so existing payloads still decode.
- `app/Workbench/Views/PRsLogic.swift`: the `.needsReview` case of `keep`, and the empty state text, which currently promises only "pull requests you open or get assigned".

**Not affected**
- Pull requests the fix pipeline creates from a ticket, and `recordPr`.
- The pull request detail screen, the diff, the chat, the merge, and the review reply drafts.
- Jira, tasks, tickets and projects.

**Risk**
- The flag has to be overwritten on every poll rather than only on insert, for the same reason the Jira status columns are. A review request that is completed or withdrawn would otherwise stick, and the tab would keep offering work that is done.
- A pull request authored by someone else has no local branch and no ticket. `fetchPrDetail` already returns `headRefName` so the agent panel can build a worktree for a pull request this engine did not create, but no such pull request has ever actually been stored, so that path is unproven in practice.
- Each newly visible pull request adds one `gh pr view` call per poll cycle.
- Dropping the old meaning of the tab is deliberate and was chosen by the user. Anyone relying on it to see their own pull requests awaiting review uses "Mine" instead.
