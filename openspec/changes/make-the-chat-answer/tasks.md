# Tasks

Tests first in each group, then the code that answers them. Section 5 is the part no test
covers: a real failure, seen in the panel rather than in SQLite.

## 1. Engine: a failed run answers in the thread

- [x] 1.1 Add failing tests for a new `engine/src/chatFailure.ts`: a timeout reads as a timeout and names the minutes; any other error reads as a failure and carries the message; the text is one paragraph, because it is rendered in a chat bubble.
- [x] 1.2 Write `chatFailure.ts`. One exported function per what it needs: the text from an unknown error, and a recorder that stores it with the right `addXMessage` and logs one line.
- [x] 1.3 Add failing route tests that a failed send leaves an assistant message in the thread, one for each of `/prs/:id/messages`, `/tickets/:id/messages`, `/todos/:id/messages` and `/projects/:id/messages`. Stub the agent call to throw.
- [x] 1.4 Call the recorder from the `catch` in all four routes. The status code and the body stay as they are: the client still shows its alert, this only adds the record the user can read later.
- [x] 1.5 Add a failing test that `/prs/:id/merge` records its failure too, since it runs the same `sendPrMessage`.
- [x] 1.6 Add a failing test that a successful send stores no failure message.

## 2. Engine: knowing whether the branch conflicts

- [x] 2.1 Add failing tests for `conflictsWith` in `engine/src/git.ts`: exit 1 with a tree reads as conflicting, exit 0 as clean, any other exit as unknown, and exit 1 with no tree as unknown. That last one is not hypothetical: measured on the ACV repo, a ref git cannot resolve also exits 1, with the reason on stderr and nothing on stdout.
- [x] 2.2 Write `conflictsWith` on `git merge-tree --write-tree <default> <branch>`. No worktree, no checkout, and it cannot leave the repo mid-merge.
- [x] 2.3 Add `mergeBranchInto`, which runs `git merge` in the worktree and does not throw on a conflicting merge, because a conflict is the state this wants.

## 3. Engine: the revise path

- [x] 3.1 Add failing tests for `isConflictRequest` in `engine/src/prChat.ts`: it fires on "fix the merge conflict in this branch" and on "resolve the conflicts with main"; it does not fire on "merge it", which `isMergeRequest` already owns; it does not fire on a message that only mentions a file called conflict.
- [x] 3.2 Write `isConflictRequest`. Substring, unlike `isMergeRequest`, because this is a sentence and not a command phrase. Note that in a comment next to it.
- [x] 3.3 Add a failing test: a conflict request on a clean branch stores an assistant message and never calls the agent.
- [x] 3.4 Add a failing test: a conflict request on a conflicting branch merges the default branch into the worktree before the agent runs, and the prompt names the conflicting files.
- [x] 3.5 Add a failing test: any other request on a conflicting branch starts no merge.
- [x] 3.6 Add failing tests for `buildRevisePrompt`: it says the worktree is a detached checkout with no merge in progress; the conflict variant says the merge is in progress and lists the files.
- [x] 3.7 Write the three against those tests: the prompt sentences, the early answer, and the merge before `runClaude`.

## 4. Client: the panel shows the wait

- [x] 4.1 Add a failing test in `client/src/agentChatLogic.test.ts` for the pure part: given the message count at send time and the count now, the echo is shown or dropped.
- [x] 4.2 Write that function in `client/src/agentChatLogic.ts`.
- [x] 4.3 Add a failing panel test: sending shows the text in the transcript and a working line, both gone once the thread returns the stored message.
- [x] 4.4 Hold the sent text in `AgentChatPanel` and render it as a user bubble with the working line under it. Local state only, never the query cache.
- [x] 4.5 Amend the comment at `client/src/queries.ts:275`. It rules out optimistic updates for a reason that was about the cache, and this echo never enters it.
- [x] 4.6 Check the failure path: the alert still fires, the working line goes, the draft stays in the composer.

## 5. By hand

- [x] 5.1 Send a message on a pull request. The text appears at once and the panel says the agent is working.
- [x] 5.2 Stop the engine mid-send. The panel stops saying the agent is working and shows the alert.
- [ ] 5.3 Ask to fix the merge conflict on `chore/remove-unused-schemas` in the ACV project, which conflicts with main. The agent gets the conflict and the push lands. Not run: it force-pushes a real pull request. The mechanism under it was verified against the real repo instead, see 5.4.
- [x] 5.4 Ask the same on a branch that merges cleanly. It answers in seconds, not in 30 minutes. Checked directly against the ACV repo: `conflictsWith` reads the conflicting branch as conflicting and names `sanityConfig/personalization/personalizationTypes.ts`, main against main as clean, and a missing ref as unknown. `mergeBranchInto` leaves `UU` and real conflict markers in the worktree.
- [x] 5.5 Force a failure and read `~/Library/Logs/workbench-engine.log`. The line is there, and the thread has the message.

## 6. Before the pull request

- [x] 6.1 `cd engine && pnpm test && pnpm typecheck`
- [x] 6.2 `cd client && pnpm test && pnpm build`
- [x] 6.3 `cd client/src-tauri && cargo test --lib`
- [x] 6.4 `openspec validate make-the-chat-answer --strict`
