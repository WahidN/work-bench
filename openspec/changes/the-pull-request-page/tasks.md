# Tasks

Tests first in each group, then the code that answers them. Section 6 removes the panel, and
it comes after the page works, so there is never a commit with neither surface.

## 1. Engine: what GitHub says about merging

- [x] 1.1 Add a failing test for `fetchPrDetail` in `engine/tests/sources/`: the `gh pr view --json` call asks for `mergeable`, and the value comes back on the result.
- [x] 1.2 Add `mergeable` to the `--json` list and to `GithubPrDetail`. It is `MERGEABLE`, `CONFLICTING` or `UNKNOWN`, kept as GitHub's own string rather than a boolean, because unknown is a third answer and not a false.
- [x] 1.3 Add `mergeable TEXT` to `prs` in `SCHEMA` in `engine/src/db.ts`, nullable, no `CHECK`: a new GitHub value must not start failing writes.
- [x] 1.4 Append migration 12 with the same column, carrying the comment migration 11 carries.
- [x] 1.5 Add `mergeable` to `Pr` and to `UpsertGithubPrInput` in `engine/src/types.ts`.
- [x] 1.6 Add a failing test for `rowToPr` and `upsertGithubPr` in `engine/tests/prs.test.ts`: the field round-trips, and is null on a pull request never detailed.
- [x] 1.7 Carry it through `rowToPr`, `upsertGithubPr` and the poller's upsert call.

## 2. Engine: the resolve route

- [x] 2.1 Add failing tests for `POST /prs/:id/resolve-conflicts` in `engine/tests/api/prs.test.ts`: it runs the chat turn with a phrase `isConflictRequest` matches; it answers 404 for a pull request that is not there; it answers 409 while another agent holds that pull request's lock; a failure is recorded in the thread the way the message route's is.
- [x] 2.2 Write the route next to `POST /prs/:id/merge`, calling `sendPrMessage` with the conflict phrase the way that one calls it with "merge it". Take the job lock with activity `conflicts` so the page can name what is running.
- [x] 2.3 Add `'conflicts'` to `JobActivity` in `engine/src/types.ts` and to the label map the agents list reads.

## 3. Client: what the page needs to know

- [x] 3.1 Add failing tests in `client/src/prDetailLogic.test.ts` for `reviewedLine`: never reviewed reads as not reviewed; a reviewed pull request reads with its relative time; it does not read GitHub's approved state as a Workbench review.
- [x] 3.2 Add failing tests for `agentsForPr`: it keeps agents whose target is this pull request; it drops agents on another pull request and on a ticket; an empty list reads as nothing running.
- [x] 3.3 Write both in `client/src/prDetailLogic.ts`.
- [x] 3.4 Move `authorLabel` and `showsSentEcho` from `agentChatLogic.ts` into `prDetailLogic.ts`, with their tests, unchanged.
- [x] 3.5 Add `useResolveConflicts` to `client/src/queries.ts`, invalidating on settle the way the chat sends do, since a failed resolve also writes to the thread.

## 4. Client: the agent section on the page

- [x] 4.1 Add failing tests for a new `client/src/PrAgentSection.tsx`: it names the reviewed state; it lists a running agent on this pull request and not one on another; sending shows the message and a working line; both go once the thread returns the stored message; a failed send keeps the draft.
- [x] 4.2 Write `PrAgentSection.tsx`, taking the pull request and rendering the reviewed line, the agents, the thread and the composer. The echo and the working line come from `AgentChatPanel` unchanged.
- [x] 4.3 Add a failing test that the Review section renders with no findings at all, which is the state that was invisible.
- [x] 4.4 Render the section unconditionally in `PrDetailScreen.tsx` and put `PrAgentSection` inside it, under the findings.

## 5. Client: the Resolve conflicts button

- [x] 5.1 Add failing tests in `client/src/PrDetailScreen.test.tsx`: the button is offered on `mergeable: 'CONFLICTING'`; it is absent on `MERGEABLE`, on `UNKNOWN` and on null; pressing it calls the route and disables while it runs; a failure raises the alert.
- [x] 5.2 Add the button next to Review in the header, and wire it to `useResolveConflicts`.

## 6. Client: the panel goes

- [x] 6.1 Delete `client/src/AgentChatPanel.tsx` and `client/src/AgentChatPanel.test.tsx`.
- [x] 6.2 Remove the agent action and its props from `TodayScreen.tsx`, `PRsScreen.tsx`, `JiraScreen.tsx`, `ProjectDetailScreen.tsx`, `TaskRow.tsx` and `AppHeader.tsx`, updating each screen's tests to assert the action is gone rather than deleting the assertions.
- [x] 6.3 Remove `chatTarget`, `openProjectChat` and the four callbacks from `Shell.tsx`.
- [x] 6.4 Remove `askAgent` from `shortcuts.ts` and `commandPaletteLogic.ts`, with a test in each that the entry is gone.
- [x] 6.5 Delete `client/src/agentChatLogic.ts` and its test, now that the two functions worth keeping have moved.
- [x] 6.6 Remove `useProjectThread`, `useTicketThread`, `useTodoThread`, `useSendProjectMessage`, `useSendTicketMessage` and `useSendTodoMessage` from `queries.ts`. The engine routes stay: nothing about them is broken and the API is the contract.
- [x] 6.7 Grep for `AgentChatTarget`, `onOpenAgent`, `onChatTodo` and `sparkles` and clear whatever the removals left behind.

## 7. By hand

- [x] 7.1 Open a pull request never reviewed. The page says so. Press Review, the page lists the review as running, and says reviewed with the time when it lands. Done on acv-website#78: "Not reviewed yet", then `RUNNING Reviewing just started`, then "Reviewed 2m ago" with 5 findings after 180s. The last step failed the first time, see 7.9.
- [x] 7.2 Open a pull request reviewed with no remarks. It reads as reviewed, not as never reviewed. Done on ndff-app#73 by setting `reviewed_at` on the row and putting it back after: "Reviewed 30m ago", 0 findings, section and composer both there. That is the state the old page rendered as nothing at all.
- [ ] 7.3 Type an instruction in the composer. It appears at once with the working line, and the answer lands under it. Half done. The thread renders on the page, proven by 7.6: the sent message and the reply both appear as YOU and AGENT bubbles above the composer. The live revise was not run, because all four pull requests in the inbox are the user's own and a revise commits and force-pushes to the branch. The echo and the working line are covered by the unit tests, and the identical code was measured in a browser in `make-the-chat-answer`.
- [x] 7.4 Walk Today, the pull request list, Jira and a project. No row offers an agent. Press the old shortcut, nothing opens.
- [x] 7.5 Open a pull request GitHub reports as conflicting. The button is there. Open a mergeable one, it is not. Done on real data: cang-frontend#233 is CONFLICTING and offers it, acv-website#78 is MERGEABLE and does not.
- [x] 7.6 Press Resolve conflicts on a branch that merges cleanly. The thread says there is no conflict, in seconds. Done on acv-website#80 through the route, which is the path the button takes: 3.6 seconds, no agent, no commit, no push, head sha unchanged, and both messages in the thread.
- [x] 7.7 Press Resolve conflicts while a review is running on the same pull request. It is refused. Done: 409 `already working on this` while job 769 held acv-website#78.
- [x] 7.8 Measure the page in the browser with `agent-browser`, at the width the window uses. The header buttons do not wrap onto a third row and the composer sits at the bottom of the section. Measured at 1440: all four buttons on one row at `top: 137`, right edge 1386.

- [x] 7.9 Fix what 7.1 caught. The review landed, the five findings rendered, and the line above them still read "Not reviewed yet". A review is started with one request and writes `reviewed_at` minutes later from a job nothing on the page awaits, so no mutation invalidates `GET /prs/:id`. `PrAgentSection` now re-reads the pull request when the last agent on it finishes, with a test.

## 8. Before the pull request

- [x] 8.1 `cd engine && pnpm test && pnpm typecheck`
- [x] 8.2 `cd client && pnpm test && pnpm build`
- [x] 8.3 `cd client/src-tauri && cargo test --lib`
- [x] 8.4 `openspec validate the-pull-request-page --strict`
