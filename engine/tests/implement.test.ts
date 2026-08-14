import { describe, expect, it } from 'vitest';
import { buildImplementPrompt } from '../src/implement.js';
import type { Ticket, TicketMessage } from '../src/types.js';

const ticket: Ticket = {
  id: 1, source: 'github', sourceId: 'GH-1', projectId: 1, title: 'Fix null check',
  body: 'desc', url: 'https://x', analysis: null, status: 'sparring', prId: null, pinned: false, createdAt: '2026-01-01',
};

const messages: TicketMessage[] = [
  { id: 1, ticketId: 1, role: 'user', content: 'cap the backoff at 30s', createdAt: '2026-01-01' },
  { id: 2, ticketId: 1, role: 'assistant', content: 'Got it, capped at 30s.', createdAt: '2026-01-01' },
];

describe('buildImplementPrompt', () => {
  it('includes the ticket title and the chat transcript', () => {
    const prompt = buildImplementPrompt(ticket, messages);
    expect(prompt).toContain('Fix null check');
    expect(prompt).toContain('cap the backoff at 30s');
    expect(prompt).toContain('Got it, capped at 30s.');
  });

  it('includes reviewer findings on a retry', () => {
    const prompt = buildImplementPrompt(ticket, messages, ['missing null guard on email field']);
    expect(prompt).toContain('missing null guard on email field');
  });

  it('omits the findings section when there are none', () => {
    const prompt = buildImplementPrompt(ticket, messages, []);
    expect(prompt).not.toContain('Reviewer findings');
  });
});
