import { runClaude } from './claude.js';
import type { Ticket, TicketMessage } from './types.js';

export function buildImplementPrompt(ticket: Ticket, messages: TicketMessage[], findings: string[] = []): string {
  const transcript = messages.map((m) => `${m.role === 'user' ? 'You' : 'Claude'}: ${m.content}`).join('\n');
  const findingsBlock =
    findings.length > 0 ? `\n\nReviewer findings to address:\n${findings.map((f) => `- ${f}`).join('\n')}` : '';
  return `Implement a fix for this ticket.

Title: ${ticket.title}
${ticket.body}

Discussion so far:
${transcript}
${findingsBlock}

Make the changes directly in this working tree. Do not commit or push.`;
}

export async function implementFix(
  worktreePath: string,
  ticket: Ticket,
  messages: TicketMessage[],
  findings: string[] = []
): Promise<void> {
  await runClaude({
    cwd: worktreePath,
    prompt: buildImplementPrompt(ticket, messages, findings),
    allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    timeoutMs: 30 * 60 * 1000,
  });
}
