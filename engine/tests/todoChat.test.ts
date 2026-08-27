import { describe, expect, it, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject } from '../src/projects.js';
import { upsertJiraTodo, listTodos, listTodoMessages } from '../src/todos.js';
import * as claude from '../src/claude.js';
import { sendTodoMessage, buildTodoChatPrompt } from '../src/todoChat.js';

vi.mock('../src/claude.js');

const issue = {
  source: 'jira' as const,
  sourceId: 'JIRA-DEMO-1',
  title: '[DEMO-1] Logout redirects in a loop',
  url: 'https://x/browse/DEMO-1',
  body: 'Signing out bounces between /logout and /login.',
  projectKey: 'DEMO',
};

let db: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
});

function mappedTodo() {
  const project = createProject(db, {
    name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: 'DEMO', sentryProjectSlug: null,
  });
  upsertJiraTodo(db, issue, project);
  return { todo: listTodos(db)[0], project };
}

function unmappedTodo() {
  upsertJiraTodo(db, issue, null);
  return listTodos(db)[0];
}

describe('sendTodoMessage', () => {
  it('records the user message and the reply, in order', async () => {
    const { todo } = mappedTodo();
    vi.mocked(claude.runClaude).mockResolvedValue('It is the redirect guard.');

    const reply = await sendTodoMessage(db, todo.id, 'what is this about?');

    expect(reply).toBe('It is the redirect guard.');
    expect(listTodoMessages(db, todo.id).map((m) => [m.role, m.content])).toEqual([
      ['user', 'what is this about?'],
      ['assistant', 'It is the redirect guard.'],
    ]);
  });

  it('runs Claude read-only in the checkout when the issue maps to a project', async () => {
    const { todo } = mappedTodo();
    vi.mocked(claude.runClaude).mockResolvedValue('ok');

    await sendTodoMessage(db, todo.id, 'anything');

    const call = vi.mocked(claude.runClaude).mock.calls[0][0];
    expect(call.cwd).toBe('/repos/demo');
    expect(call.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    expect(call.timeoutMs).toBe(15 * 60 * 1000);
  });

  it('runs Claude with no directory and no tools when the issue maps to nothing', async () => {
    const todo = unmappedTodo();
    vi.mocked(claude.runClaude).mockResolvedValue('ok');

    await sendTodoMessage(db, todo.id, 'anything');

    const call = vi.mocked(claude.runClaude).mock.calls[0][0];
    expect(call.cwd).toBe(tmpdir());
    expect(call.allowedTools).toEqual([]);
  });

  it('passes the whole transcript, including the new message, to the prompt', async () => {
    const { todo } = mappedTodo();
    vi.mocked(claude.runClaude).mockResolvedValue('ok');
    await sendTodoMessage(db, todo.id, 'first');
    await sendTodoMessage(db, todo.id, 'second');

    const secondPrompt = vi.mocked(claude.runClaude).mock.calls[1][0].prompt;
    expect(secondPrompt).toContain('You: first');
    expect(secondPrompt).toContain('Claude: ok');
    expect(secondPrompt).toContain('You: second');
  });

  it('throws for an unknown todo and records nothing', async () => {
    await expect(sendTodoMessage(db, 999, 'hi')).rejects.toThrow('Todo 999 not found');
    expect(claude.runClaude).not.toHaveBeenCalled();
  });

  it('keeps the user message when Claude fails, so reopening shows it', async () => {
    const { todo } = mappedTodo();
    vi.mocked(claude.runClaude).mockRejectedValue(new Error('claude exploded'));

    await expect(sendTodoMessage(db, todo.id, 'will fail')).rejects.toThrow('claude exploded');
    expect(listTodoMessages(db, todo.id).map((m) => [m.role, m.content])).toEqual([
      ['user', 'will fail'],
    ]);
  });
});

describe('buildTodoChatPrompt', () => {
  it('states the reference, the title and the body', () => {
    const todo = unmappedTodo();
    const prompt = buildTodoChatPrompt(todo, null, []);

    expect(prompt).toContain('JIRA-DEMO-1');
    expect(prompt).toContain('[DEMO-1] Logout redirects in a loop');
    expect(prompt).toContain('Signing out bounces between /logout and /login.');
  });

  it('offers the repository when a project is mapped', () => {
    const { todo, project } = mappedTodo();
    const prompt = buildTodoChatPrompt(todo, project, []);

    expect(prompt).toContain('read it');
    expect(prompt).not.toContain('No repository is mapped');
  });

  it('says there is nothing to read when no project is mapped', () => {
    const todo = unmappedTodo();
    const prompt = buildTodoChatPrompt(todo, null, []);

    expect(prompt).toContain('No repository is mapped');
  });

  it('omits the discussion section on the first message', () => {
    const todo = unmappedTodo();
    expect(buildTodoChatPrompt(todo, null, [])).not.toContain('Discussion so far');
  });

  it('includes prior turns when there is history', () => {
    const todo = unmappedTodo();
    const prompt = buildTodoChatPrompt(todo, null, [
      { id: 1, todoId: todo.id, role: 'user', content: 'hey', createdAt: '' },
    ]);
    expect(prompt).toContain('You: hey');
  });
});
