## Why

A chat send can fail and leave the panel looking exactly like a send that never happened.

Observed on the real setup on 2026-09-17. The user sent "fix the merge conflict in this
branch" on pull request 967 at 12:32:56. The message is in `pr_messages` as row 11. The job
is in `jobs` as row 640:

```
job 640 | pr-chat | pr 967 | failed | 12:32:56
ExecaError: Command timed out after 1800000 milliseconds: claude -p 'Revise the fix
already implemented on this branch for "Remove filter tags, municipality overview and
statistics".\n\nRequested change: fix the merge conflict in this branch\n...'
```

The agent ran for the full 30 minutes in `engine/src/prChat.ts:118` and was killed. Three
things then hid that from the user:

1. `AgentChatPanel` does not echo the message it just sent, so the transcript stayed empty
   for the whole half hour. `client/src/queries.ts:275` rules out optimistic updates on
   purpose, to keep the port faithful to the Swift app.
2. `revisePrChat` never reaches its `addPrMessage(... 'assistant' ...)` when the run throws,
   so no failure lands in the thread either. All four chat modules have that same shape:
   user message stored, agent run, assistant message. A throw in the middle leaves a
   question with no answer in it.
3. `engine/src/api/routes/prs.ts:316` catches the error and writes it only to the `jobs`
   table. Nothing reaches `~/Library/Logs/workbench-engine.log`. Finding out what happened
   meant opening SQLite.

The request could not have succeeded either. `openDetachedWorktree` checks out
`origin/<branch>` detached with no merge started, so the worktree the agent was handed had
no conflict in it. The branch does conflict with main:

```
git merge-tree --write-tree origin/main origin/chore/remove-unused-schemas  ->  exit 1
```

The agent was asked to fix a conflict that was not in front of it, with Bash allowed, and
churned until the timeout.

## What Changes

- A chat run that fails writes the failure into the thread as an assistant message, for all
  four kinds of chat, and logs one line to the engine log.
- The panel puts the message in the transcript the moment it is sent and says the agent is
  working, so a long run reads as a long run instead of as nothing.
- A revise prompt tells the agent what the worktree actually is: a detached checkout of the
  branch head, no merge in progress.
- A revise request about a merge conflict opens the worktree with the merge already started,
  so the conflict is really there to resolve. A request about a conflict on a branch that
  has none is answered without running an agent at all.
- **BREAKING** nothing. No route changes shape and no table gains a column.

## Capabilities

### New Capabilities

- `agent-chat-feedback`: a chat send says what it is doing while it runs, and says so when
  it fails.
- `pr-revise-worktree`: a revise request works on a worktree that matches what was asked.

### Modified Capabilities

None. `openspec/specs/` does not exist yet, so no capability spec is promoted.

## Impact

**Engine**
- New `engine/src/chatFailure.ts`: one helper that records a failed run as an assistant
  message and logs it. All four routes call it from the `catch` they already have.
- `engine/src/api/routes/prs.ts`, `engine/src/api/routes/tickets.ts`,
  `engine/src/api/routes/todos.ts`, `engine/src/api/routes/projects.ts`: one call in each
  `catch`. The status code and body stay as they are.
- `engine/src/git.ts`: `mergeBranchInto`, and `conflictsWith` built on
  `git merge-tree --write-tree`, which needs no working tree and no second checkout.
- `engine/src/prChat.ts`: `isConflictRequest`, the worktree opened with the merge started
  for one, the refusal for a conflict that does not exist, and the two extra sentences in
  `buildRevisePrompt`.

**Client**
- `client/src/AgentChatPanel.tsx`: the sent message and a working line, both local to the
  panel, cleared when the thread comes back with the real rows.

**Not covered**
- The 30 minute timeout stays at 30 minutes. It is the guard that ends a run nobody can
  see the end of, and shortening it would cut off revisions that legitimately take long.
  What was wrong was the silence, not the number.
- Streaming the agent's output into the panel. `runClaude` reads stdout to the end, so
  there is nothing to stream from without changing how every agent call works.
- `reconcileGithubPrs` in `engine/src/prs.ts:166` deletes a pull request's chat messages
  when the pull request leaves the GitHub inbox. `pr_messages` ids start at 11, so it has
  already wiped threads. The guards against a partial fetch look right, so it only fires on
  a pull request that really was merged or closed, but it does mean a thread can disappear
  from under the user. That is its own change.
- Project chat still takes no job lock, so two sends on one project still run at once. The
  failure message is the only thing this change gives it.
