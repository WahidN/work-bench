import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createProject, listProjectMessages } from '../src/projects.js';
import * as claude from '../src/claude.js';
import { sendProjectMessage, buildProjectChatPrompt } from '../src/projectChat.js';

vi.mock('../src/claude.js');

let db: Database.Database;
let projectId: number;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  projectId = createProject(db, {
    name: 'Atlas Payments', repoPath: '/repos/atlas', defaultBranch: 'main',
    githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  }).id;
});

describe('sendProjectMessage', () => {
  it('records the user message and the reply, in order', async () => {
    vi.mocked(claude.runClaude).mockResolvedValue('Start with the refund retry.');

    const reply = await sendProjectMessage(db, projectId, 'what should I do first?');

    expect(reply).toBe('Start with the refund retry.');
    expect(listProjectMessages(db, projectId).map((m) => [m.role, m.content])).toEqual([
      ['user', 'what should I do first?'],
      ['assistant', 'Start with the refund retry.'],
    ]);
  });

  it('runs Claude read-only in the project checkout', async () => {
    vi.mocked(claude.runClaude).mockResolvedValue('ok');

    await sendProjectMessage(db, projectId, 'catch me up');

    const call = vi.mocked(claude.runClaude).mock.calls[0][0];
    expect(call.cwd).toBe('/repos/atlas');
    expect(call.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('passes the whole transcript, including the new message, to the prompt', async () => {
    vi.mocked(claude.runClaude).mockResolvedValue('ok');
    await sendProjectMessage(db, projectId, 'first');
    await sendProjectMessage(db, projectId, 'second');

    const secondPrompt = vi.mocked(claude.runClaude).mock.calls[1][0].prompt;
    expect(secondPrompt).toContain('You: first');
    expect(secondPrompt).toContain('Claude: ok');
    expect(secondPrompt).toContain('You: second');
  });

  it('throws for an unknown project and records nothing', async () => {
    await expect(sendProjectMessage(db, 999, 'hi')).rejects.toThrow('Project 999 not found');
    expect(claude.runClaude).not.toHaveBeenCalled();
  });
});

describe('buildProjectChatPrompt', () => {
  it('names the project', () => {
    expect(buildProjectChatPrompt('Atlas Payments', [])).toContain('Atlas Payments');
  });

  it('omits the discussion section on the first message', () => {
    expect(buildProjectChatPrompt('Atlas Payments', [])).not.toContain('Discussion so far');
  });

  it('includes prior turns when there is history', () => {
    const prompt = buildProjectChatPrompt('Atlas Payments', [
      { id: 1, projectId: 1, role: 'user', content: 'hey', createdAt: '' },
    ]);
    expect(prompt).toContain('You: hey');
  });
});
