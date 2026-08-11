import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getTicket, listTicketMessages, addTicketMessage, updateTicketStatus } from './tickets.js';
import { runClaude } from './claude.js';
import type { TicketMessage } from './types.js';

export function buildSparPrompt(title: string, body: string, messages: TicketMessage[]): string {
  const transcript = messages.map((m) => `${m.role === 'user' ? 'You' : 'Claude'}: ${m.content}`).join('\n');
  return `You are discussing how to fix this issue with the person who will approve the fix. This is read-only analysis and discussion - do not make any changes.

Title: ${title}
${body}
${transcript ? `\nDiscussion so far:\n${transcript}` : ''}

Respond conversationally to continue the discussion, or answer their latest question.`;
}

export async function sendTicketMessage(db: Database.Database, ticketId: number, userMessage: string): Promise<string> {
  const ticket = getTicket(db, ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  const project = getProject(db, ticket.projectId);
  if (!project) throw new Error(`Project ${ticket.projectId} not found`);

  addTicketMessage(db, ticketId, 'user', userMessage);
  if (ticket.status === 'new') updateTicketStatus(db, ticketId, 'sparring', ticket.prId);

  const messages = listTicketMessages(db, ticketId);
  const reply = await runClaude({
    cwd: project.repoPath,
    prompt: buildSparPrompt(ticket.title, ticket.body, messages),
    allowedTools: ['Read', 'Grep', 'Glob'],
    timeoutMs: 15 * 60 * 1000,
  });
  addTicketMessage(db, ticketId, 'assistant', reply);
  return reply;
}
