import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getPr, addPrMessage, updatePrStatus } from './prs.js';
import { getTicket, updateTicketStatus } from './tickets.js';
import { openWorktree, removeWorktree, commitAll, pushBranch, getDiff, mergePr } from './git.js';
import { runClaude } from './claude.js';
import { reviewDiff, reviewPasses, averageScore } from './review.js';
import { passComment, failComment } from './fixPipeline.js';
import type { Pr, Project, Ticket } from './types.js';

const MERGE_PHRASES = ['merge it', 'merge this', 'go ahead and merge'];

// Merging must be a direct, explicit user action, so the whole message has to be
// the merge phrase. A substring match would fire on "don't merge this yet".
// Only trailing dots and exclamation marks are stripped, never a question mark:
// "merge it?" is a question, not an instruction.
export function isMergeRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/[.!\s]+$/, '');
  return MERGE_PHRASES.includes(normalized);
}

export interface PrChatResult {
  action: 'revised' | 'merged';
  reply: string;
}

export async function sendPrMessage(db: Database.Database, prId: number, userMessage: string): Promise<PrChatResult> {
  const pr = getPr(db, prId);
  if (!pr) throw new Error(`PR ${prId} not found`);
  const project = getProject(db, pr.projectId);
  if (!project) throw new Error(`Project ${pr.projectId} not found`);

  addPrMessage(db, prId, 'user', userMessage);

  return isMergeRequest(userMessage) ? mergePrChat(db, pr, project) : revisePrChat(db, pr, project, userMessage);
}

async function mergePrChat(db: Database.Database, pr: Pr, project: Project): Promise<PrChatResult> {
  const worktreePath = await openWorktree(project, pr.branch);
  try {
    await mergePr(worktreePath);
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
  updatePrStatus(db, pr.id, 'merged', pr.lastReviewScore);
  const ticket = getTicket(db, pr.ticketId);
  if (ticket) updateTicketStatus(db, ticket.id, 'done', pr.id);
  const reply = `Merged ${pr.url}.`;
  addPrMessage(db, pr.id, 'assistant', reply);
  return { action: 'merged', reply };
}

function buildRevisePrompt(ticket: Ticket, instruction: string): string {
  return `Revise the fix already implemented on this branch for "${ticket.title}".

Requested change: ${instruction}

Make the changes directly in this working tree. Do not commit or push.`;
}

async function revisePrChat(
  db: Database.Database,
  pr: Pr,
  project: Project,
  userMessage: string
): Promise<PrChatResult> {
  const ticket = getTicket(db, pr.ticketId);
  if (!ticket) throw new Error(`Ticket for PR ${pr.id} not found`);
  const worktreePath = await openWorktree(project, pr.branch);

  try {
    await runClaude({
      cwd: worktreePath,
      prompt: buildRevisePrompt(ticket, userMessage),
      allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      timeoutMs: 30 * 60 * 1000,
    });

    const committed = await commitAll(worktreePath, `fix: ${userMessage}`);
    if (!committed) {
      const reply = "I didn't find a change to make for that. Could you be more specific?";
      addPrMessage(db, pr.id, 'assistant', reply);
      return { action: 'revised', reply };
    }

    await pushBranch(worktreePath, pr.branch);
    const diff = await getDiff(worktreePath, project.defaultBranch);
    const score = await reviewDiff(worktreePath, ticket, diff);
    const passed = reviewPasses(score);
    updatePrStatus(db, pr.id, passed ? 'open' : 'needs_attention', averageScore(score));

    const reply = passed ? passComment(score, 1) : failComment(score);
    addPrMessage(db, pr.id, 'assistant', reply);
    return { action: 'revised', reply };
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
}
