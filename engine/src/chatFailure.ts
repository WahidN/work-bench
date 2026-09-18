import type Database from 'better-sqlite3';
import { addPrMessage } from './prs.js';
import { addTicketMessage } from './tickets.js';
import { addTodoMessage } from './todos.js';
import { addProjectMessage } from './projects.js';

export type ChatKind = 'pr' | 'ticket' | 'todo' | 'project';

const WRITERS: Record<
  ChatKind,
  (db: Database.Database, id: number, role: 'user' | 'assistant', content: string) => unknown
> = {
  pr: addPrMessage,
  ticket: addTicketMessage,
  todo: addTodoMessage,
  project: addProjectMessage,
};

// execa flags a killed run with `timedOut` and puts the limit in the message,
// which is the only place it is exposed. Read it back rather than repeating the
// number here: the four chats do not share one timeout.
function timedOutAfter(err: unknown): number | null {
  if (!err || typeof err !== 'object' || (err as any).timedOut !== true) return null;
  const match = String((err as any).message ?? '').match(/timed out after (\d+) milliseconds/);
  return match ? Number(match[1]) : null;
}

/// What the user reads in the thread when their message got no answer.
///
/// One paragraph, because it renders in a chat bubble next to the agent's own
/// replies. A timeout is named as a timeout: it is the one failure the user can
/// do something about, by asking for a smaller step.
export function chatFailureText(err: unknown): string {
  if ((err as any)?.timedOut === true) {
    const ms = timedOutAfter(err);
    const ran = ms === null ? 'ran out of time' : `ran for ${Math.round(ms / 60000)} minutes without finishing`;
    return `The agent ${ran} and was stopped, so there is no answer to this. Ask for a smaller step, or say where it should start.`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `This did not finish: ${message.replace(/\s+/g, ' ').trim()}`;
}

/// Records a failed send in the thread it failed in, and logs it.
///
/// Called from the routes rather than from the four chat modules, because a send
/// can also die after the agent finished, on the push or the merge that follows
/// it. The route's catch is the one place that sees all of them.
///
/// Never throws. The send has already failed and the route's catch is the last
/// thing standing, so a foreign key on a pull request the poller deleted mid-turn
/// must not replace the real failure with a second one.
export function recordChatFailure(
  db: Database.Database,
  kind: ChatKind,
  targetId: number,
  err: unknown
): void {
  console.error(`chat failed: ${kind} ${targetId}:`, String(err));
  try {
    WRITERS[kind](db, targetId, 'assistant', chatFailureText(err));
  } catch (writeErr) {
    console.error(`chat failed: could not record the failure on ${kind} ${targetId}:`, String(writeErr));
  }
}
