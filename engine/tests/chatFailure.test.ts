// engine/tests/chatFailure.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { createTicket } from '../src/tickets.js';
import { createManualTodo, listTodoMessages } from '../src/todos.js';
import { recordPr, listPrMessages } from '../src/prs.js';
import { listTicketMessages } from '../src/tickets.js';
import { listProjectMessages } from '../src/projects.js';
import { chatFailureText, recordChatFailure } from '../src/chatFailure.js';

let db: Database.Database;
let projectId: number;

beforeEach(() => {
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
});

// The shape execa throws on a timeout. The milliseconds are in the message because
// that is where execa puts them, which is what chatFailureText reads.
function timeoutError(ms: number): Error {
  const err = new Error(`Command timed out after ${ms} milliseconds: claude -p 'Revise...'`);
  (err as any).timedOut = true;
  return err;
}

describe('chatFailureText', () => {
  it('names a timeout as a timeout, in minutes', () => {
    const text = chatFailureText(timeoutError(30 * 60 * 1000));

    expect(text).toContain('30 minutes');
    expect(text.toLowerCase()).toContain('stopped');
    expect(text).not.toContain('ExecaError');
    expect(text).not.toContain('1800000');
  });

  it('reads the minutes off the error rather than assuming one timeout', () => {
    expect(chatFailureText(timeoutError(15 * 60 * 1000))).toContain('15 minutes');
  });

  // A timeout flagged by execa but with no milliseconds to read still has to say
  // it ran out of time, because that is the part the user acts on.
  it('still says it ran out of time when the milliseconds cannot be read', () => {
    const err = new Error('Command timed out');
    (err as any).timedOut = true;

    expect(chatFailureText(err).toLowerCase()).toContain('time');
  });

  it('carries the message of any other failure', () => {
    expect(chatFailureText(new Error('fatal: could not read from remote'))).toContain(
      'fatal: could not read from remote'
    );
  });

  it('is one paragraph, because it renders in a chat bubble', () => {
    expect(chatFailureText(timeoutError(30 * 60 * 1000))).not.toContain('\n');
    expect(chatFailureText(new Error('boom'))).not.toContain('\n');
  });
});

describe('recordChatFailure', () => {
  let logged: unknown[][];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a pull request thread', () => {
    const prId = recordPr(db, {
      ticketId: null, projectId, branch: 'fix/x', number: 1, url: 'u', status: 'open',
    }).id;

    recordChatFailure(db, 'pr', prId, timeoutError(30 * 60 * 1000));

    const messages = listPrMessages(db, prId);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toContain('30 minutes');
  });

  it('answers a ticket thread', () => {
    const ticketId = createTicket(db, {
      source: 'github', sourceId: 'GH-1', projectId, title: 't', body: 'b', url: 'u', analysis: null,
    }).id;

    recordChatFailure(db, 'ticket', ticketId, new Error('boom'));

    expect(listTicketMessages(db, ticketId).map((m) => m.role)).toEqual(['assistant']);
  });

  it('answers an issue thread', () => {
    const todoId = createManualTodo(db, 'look at the retry', { projectId }).id;

    recordChatFailure(db, 'todo', todoId, new Error('boom'));

    expect(listTodoMessages(db, todoId).map((m) => m.role)).toEqual(['assistant']);
  });

  it('answers a project thread', () => {
    recordChatFailure(db, 'project', projectId, new Error('boom'));

    expect(listProjectMessages(db, projectId).map((m) => m.role)).toEqual(['assistant']);
  });

  it('logs one line naming the chat, the target and the failure', () => {
    recordChatFailure(db, 'project', projectId, new Error('boom'));

    expect(logged).toHaveLength(1);
    const line = logged[0].map(String).join(' ');
    expect(line).toContain('project');
    expect(line).toContain(String(projectId));
    expect(line).toContain('boom');
  });

  // The send already failed. A foreign key on a pull request the poller deleted
  // mid-turn must not replace that failure with a second one the route did not
  // expect, because the route's catch is the last thing standing.
  it('never throws when the thread cannot be written', () => {
    expect(() => recordChatFailure(db, 'pr', 9999, new Error('boom'))).not.toThrow();
    expect(logged.length).toBeGreaterThan(0);
  });
});
