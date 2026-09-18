## Context

Measured on the running setup before writing this:

- Six files carry a button that opens the panel, and `Shell.tsx` threads four different
  callbacks through to them. `grep -c 'onOpenAgent\|onChatTodo\|onChat=' src/*.tsx` finds
  fourteen call sites.
- `AgentChatPanel.tsx` is 555 lines, of which the four-target machinery is roughly half:
  `useThread` calls four queries so one can run, and `chatSubject` has a branch per kind.
  With one target left, both collapse.
- `GET /prs/:id/review` already answers `running`, which is `isJobRunning(db, 'pr', prId)`.
  That is a boolean for one pull request. `GET /agents` answers the same fact with the
  activity and the start time, for everything. The page wants the second.
- `pr_messages` for pull request 967 holds the thread that was only ever visible in the
  panel. Nothing about the data moves; only where it is rendered.

## Decision 1: GitHub says whether it conflicts, git says whether there is work to do

Two sources can answer "does this branch conflict", and they were measured against each
other on pull request 77.

`git merge-tree --write-tree origin/main origin/chore/remove-unused-schemas` is exact and
local, and it answered `conflicts` at 15:19 and `clean` at 15:35 with the same head sha on
both sides. Nothing about the branch changed. The local `origin/main` had gone stale, and a
`git fetch` is what moved the answer. So the local check is only as current as the last
fetch, and a fetch per pull request per page read is a network call on a screen the user
opens constantly.

`gh pr view --json mergeable` was already being called by the poller for `reviewDecision`
and `headRefName`, so it is free. It answered `MERGEABLE` for 77 and, on a first ask for 78,
`UNKNOWN`: GitHub computes mergeability lazily and the next ask has it. It is also computed
against the pull request's real base branch, which is the thing that decides whether the
pull request can land.

So: GitHub decides whether the button is offered, and git decides what happens when it is
pressed. The button is an offer, and an offer that is occasionally stale costs a click.
`conflictsWith` then runs on fetched refs at click time and answers "this branch has no
conflict with main" in seconds when GitHub was behind. That refusal already exists, built in
`make-the-chat-answer` for exactly this case, so this decision adds no new failure mode.

`UNKNOWN` hides the button. Offering an action whose whole premise is unverified is worse
than not offering it, and the next poll turns it into a real answer.

## Decision 2: resolve-conflicts is a route over the chat turn, not a second pipeline

`POST /prs/:id/merge` already does this: it calls `sendPrMessage(db, prId, 'merge it')` and
lets `isMergeRequest` route it. `POST /prs/:id/resolve-conflicts` calls the same function
with the conflict phrase and lets `isConflictRequest` route it.

That buys the whole turn for free: the job lock, the failure recorded in the thread, the
worktree opened and removed, the commit, the push, the re-review, and the reply landing in
the transcript the page is already showing. A dedicated pipeline would have to repeat all of
it and would drift from the typed path, which stays supported.

## Decision 3: the page's agent list is a filter, not a new route

`GET /agents` returns every running agent with `targetType` and `targetId`. The page keeps
what matches this pull request. A `GET /prs/:id/agents` would be a second way to ask the
same question, and the two would disagree the first time one of them was changed.

The cost is that the page fetches the whole list. It is polled while the app is open
anyway for the sidebar count, so under one query client this is the same request, already
in flight, read twice.

## Decision 4: what the composer keeps from the panel

The echo and the working line were built and measured in `make-the-chat-answer`: the sent
text goes into the transcript at once, `showsSentEcho` drops it when the thread comes back
longer, and a failed send leaves the draft in the composer. That behaviour moves across
unchanged, because the reason for it is unchanged: a send holds its request open for
minutes and the thread does not hold the message until the engine answers.

What does not move is the four-target machinery. `chatSubject` picked a kicker, a title, a
placeholder and three quick prompts per kind. The page already has the title, the status and
the facts in its own header, so the composer needs a placeholder and nothing else. The quick
prompts go: two of the three for a pull request were "Reply for me" and "Make this a task",
neither of which the engine has ever done from this path.

`canMerge` goes too. The page has had its own Merge button since the rebuild
(`PrDetailScreen.tsx:677`), gated on `pr.authoredByMe`, which is the same rule.

## Decision 5: the Review section always renders

Today it is `findings.length > 0`. That makes three different states look like one: never
reviewed, reviewed with nothing to say, and reviewed with remarks that were all posted or
discarded. `prs.reviewedAt` tells them apart and has since `see-what-the-agent-is-doing`;
the page just never read it.

So the section is always there, and its first line is the state: not reviewed yet, or
reviewed with when. The findings, the agents and the transcript are what fills in under it.
That also gives the composer a fixed home, rather than one that appears and disappears with
the findings.
