## Why

Working on a pull request means using two surfaces at once. The page holds the review, the
diff and the GitHub conversation. The agent lives in a slide-over that covers the page,
opened from a button on a row somewhere else, and its transcript is the only place a
revision is recorded.

The buttons that open it are spread over six files: a row action on Today
(`TodayScreen.tsx:95`), one on the pull request list (`PRsScreen.tsx:301`), one on a Jira
row (`JiraScreen.tsx:202`), one on a project row (`ProjectDetailScreen.tsx:114`), one in
the task row menu (`TaskRow.tsx:91`), and the header button with its `⌘J`
(`AppHeader.tsx:159`, `shortcuts.ts:30`). Every one of them opens the same panel with a
different target.

Two things the page cannot say at all:

- Whether Workbench has reviewed this pull request. The review section only renders when
  `findings.length > 0` (`PrDetailScreen.tsx:734`), so a review that found nothing to say
  and a review that never ran look identical. The list has had a Reviewed column since
  `see-what-the-agent-is-doing`; the page it links to has not.
- What is running on it. `GET /agents` knows, and the sidebar shows it, but the page a user
  is sitting on while an agent works on that very pull request says nothing.

And resolving a merge conflict, the thing that started this, is a sentence you have to know
to type.

## What Changes

- The pull request page carries the whole job: Review, Resolve conflicts and Merge at the
  top, then one Review section holding whether it was reviewed and when, what is running on
  it, the agent transcript, and a composer to tell the agent what to do.
- The agent panel is removed, with every button and shortcut that opens it.
- **BREAKING** ticket chat, Jira issue chat and project chat lose their only surface. The
  engine routes stay, nothing in the app calls them. See Not covered.
- A Resolve conflicts button, shown only on a pull request GitHub reports as conflicting.
  It runs the conflict path that `make-the-chat-answer` added, which re-checks locally and
  answers in seconds when there is nothing to resolve.
- `prs` gains `mergeable`, read from the `gh pr view` call the poller already makes.

## Capabilities

### New Capabilities

- `pr-page`: everything needed to act on a pull request is on its page.
- `pr-conflicts`: a conflicting pull request offers to resolve the conflict.

### Modified Capabilities

None. `openspec/specs/` does not exist yet, so no capability spec is promoted.

## Impact

Builds on `make-the-chat-answer`, which is on the same branch and not yet merged. That
change's engine half is what this one stands on: `conflictsWith`, `mergeBranchInto`,
`isConflictRequest` and `recordChatFailure`. Its client half, the echo and the working line
in the panel, moves into the new composer rather than being deleted.

**Engine**
- `engine/src/db.ts`: migration 12, `prs.mergeable TEXT`, nullable, and the same in
  `SCHEMA`.
- `engine/src/sources/githubPrs.ts`: `mergeable` on the `gh pr view --json` call that
  already asks for `reviewDecision` and `headRefName`.
- `engine/src/prs.ts`, `engine/src/poller.ts`, `engine/src/types.ts`: the field through
  the upsert and `rowToPr`.
- `engine/src/api/routes/prs.ts`: `POST /prs/:id/resolve-conflicts`, which calls
  `sendPrMessage` with the conflict phrase the way the merge route calls it with "merge
  it". No new pipeline, no second lock.

**Client, removed**
- `client/src/AgentChatPanel.tsx` and its test, about 690 lines.
- The agent action in `TodayScreen.tsx`, `PRsScreen.tsx`, `JiraScreen.tsx`,
  `ProjectDetailScreen.tsx`, `TaskRow.tsx` and `AppHeader.tsx`, with the props that carry
  them through `Shell.tsx`.
- `⌘J` in `shortcuts.ts` and "Ask the agent" in `commandPaletteLogic.ts`.
- In `agentChatLogic.ts`: `chatSubject`, `targetSymbol`, `chatTargetForTodo`,
  `targetProjectId`, `targetIsItem`, `canMerge` and the `AgentChatTarget` type. What the
  composer still needs, `authorLabel` and `showsSentEcho`, moves to `prDetailLogic.ts` and
  the file goes.
- In `queries.ts`: `useProjectThread`, `useTicketThread`, `useTodoThread`,
  `useSendProjectMessage`, `useSendTicketMessage`, `useSendTodoMessage`. Orphaned by this
  change, so they go with it.

**Client, added**
- `client/src/PrAgentSection.tsx`: the reviewed line, this pull request's running agents,
  the transcript and the composer.
- `client/src/prDetailLogic.ts`: `reviewedLine`, `agentsForPr`, and the two functions
  moving out of `agentChatLogic.ts`.
- `client/src/PrDetailScreen.tsx`: the Resolve conflicts button, and the Review section
  rendering whether or not there are findings.
- `client/src/queries.ts`: `useResolveConflicts`, and `useRunningAgents` read on the page.

**Not covered**
- Ticket, Jira issue and project chat. Chosen deliberately: the panel goes and only the
  pull request gets a replacement. The engine keeps `POST /tickets/:id/messages`,
  `POST /todos/:id/messages` and `POST /projects/:id/messages`, because the API is the
  contract a second client would use and nothing about them is broken. Giving those three
  their own page treatment is its own change, and until then they cannot be chatted with
  from the app.
- The agent transcripts already stored for tickets, issues and projects stay in the
  database. Nothing deletes them, and they come back the moment a surface for them does.
- The sidebar's Agents screen. It stays exactly as it is, and the page's list is a filter
  over the same `GET /agents`, not a second source.
- Streaming what the agent is doing. `GET /agents` reports an activity and how long it has
  been going, which is what the page shows. Reading the agent's own output would mean
  changing how every agent is run.
