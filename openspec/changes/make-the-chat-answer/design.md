## Context

Three separate gaps produced one symptom. Keeping them apart matters, because two are cheap
and one changes what a revise run does.

Measured on the running setup before writing this:

- `pr_messages` holds one row: the user message from 12:32:56 on pull request 967. No
  assistant row follows it.
- `jobs` row 640 holds the reason, an `ExecaError` after 1800000 ms. The jobs table is the
  only place it exists. `grep -c 'console' engine/src/api/routes/prs.ts` finds nothing in
  the chat route's `catch`.
- All four chat modules have the same three lines: store the user message, run the agent,
  store the reply. `ticketChat.ts:24,28,34`, `todoChat.ts:40,46,52`,
  `projectChat.ts:22,25,31`, `prChat.ts:38,114,124`. A throw between the first and the last
  is what leaves the thread unanswered, and it is the same shape in all four.
- `git merge-tree --write-tree origin/main origin/chore/remove-unused-schemas` exits 1 in
  0.2 seconds in the ACV repo. It reads the object store, not a working tree.

## Decision 1: report the failure from the route, not from the chat module

The four chat modules could each wrap their own `runClaude` in a `try`. That was rejected.
The failure that reached the user came from `execa`, but `mergePrChat` can fail on
`gh pr merge` and `revisePrChat` can fail on `pushDetachedHead`, and none of those are
inside a `runClaude` call. A wrap around the agent call only would report the timeout and
stay silent on the other two.

The routes already have the `catch`, they already have the id, and they are the last place
that knows the send failed. One helper called from four `catch` blocks covers every way a
send can die, including ones not yet written.

The helper writes the assistant message with the same `addXMessage` the success path uses,
so the row is an ordinary message and the panel needs no new case to render it. It also
logs one line, which is the part that makes the next report answerable without SQLite.

The cost is that a failure before the user message is stored, such as `PR 967 not found`,
writes an assistant message into an otherwise empty thread. That is odd to look at and still
better than a 500 the user never sees.

## Decision 2: the panel echoes locally, it does not touch the query cache

An optimistic update through `onMutate` on `useEngineMutation` would reach every mutation
that helper serves, which is most of the app. Rolling it back correctly on error is work
that buys nothing here, because the thread is refetched on settle anyway.

Instead the panel keeps the text it just sent in local state and renders it as a user bubble
plus a working line underneath. It clears when the thread query comes back with more
messages than it had at send time, so the real row replaces the echo rather than appearing
next to it.

`client/src/queries.ts:275` says no optimistic updates on purpose, to keep a port bug and a
race apart. That comment gets amended rather than ignored: the reason it gives was about the
query cache, and this echo never enters it.

## Decision 3: start the merge only for a request that is about the merge

Opening every revise worktree with the default branch merged in was rejected. It would put a
merge commit in the pull request for a request that had nothing to do with merging, and it
would grow the diff the self-review then scores.

Detecting the intent is the other option, and this codebase already does it once:
`isMergeRequest` matches the whole message against three phrases, deliberately not a
substring, so "don't merge this yet" cannot fire it. `isConflictRequest` follows that shape
but matches on substring, because "fix the merge conflict in this branch" is a sentence and
not a command phrase. The risk of a false positive is bounded: the worst case is a merge
commit the user did not ask for on a branch that was going to need one anyway.

When the request is about a conflict and the branch has none, no agent runs. The answer is a
sentence, written straight into the thread, and it costs one `merge-tree` call to be sure of
it. That is the case that burned 30 minutes.

## Decision 4: `merge-tree`, not a trial merge in a scratch worktree

`git merge-tree --write-tree` reports conflicts from the object store alone. No checkout, no
second worktree, no cleanup, and it cannot leave the repo in a merging state if the engine
dies halfway. It needs `origin/<branch>` and `origin/<default>` to be current, which
`openDetachedWorktree` already fetches both of before it does anything else.

Exit 0 means clean. Exit 1 means conflicts, but only when a merged tree came with it:
measured on the ACV repo, a ref git cannot resolve also exits 1, with the reason on stderr
and nothing at all on stdout. So the tree oid on the first line is what tells those apart,
not the exit code. Anything it cannot read is unknown rather than clean, because claiming a
branch is clean when git could not say is how a revise run ends up in the same silence this
change is about.
