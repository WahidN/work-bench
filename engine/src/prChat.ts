import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getPr, addPrMessage, updatePrStatus, setPrPinned } from './prs.js';
import { getTicket, updateTicketStatus, setTicketPinned } from './tickets.js';
import { openDetachedWorktree, removeWorktree, commitAll, pushDetachedHead, getDiff, mergePr } from './git.js';
import { runClaude } from './claude.js';
import { reviewDiff, reviewPasses, averageScore, type ReviewSubject } from './review.js';
import { passComment, failComment } from './fixPipeline.js';
import type { Pr, Project } from './types.js';

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
  action: 'revised' | 'merged' | 'refused';
  reply: string;
}

export async function sendPrMessage(db: Database.Database, prId: number, userMessage: string): Promise<PrChatResult> {
  const pr = getPr(db, prId);
  if (!pr) throw new Error(`PR ${prId} not found`);
  const project = getProject(db, pr.projectId);
  if (!project) throw new Error(`Project ${pr.projectId} not found`);

  // Resolved before the message is stored, so a turn that cannot start leaves no
  // user message behind in a thread that will never answer it.
  const merge = isMergeRequest(userMessage);
  const subject = merge ? null : chatSubject(db, pr);
  addPrMessage(db, prId, 'user', userMessage);

  if (!pr.authoredByMe) return refusePrChat(db, pr, merge);
  return subject === null
    ? mergePrChat(db, pr, project)
    : revisePrChat(db, pr, project, subject, userMessage);
}

/// A pull request ingested from GitHub has no ticket, so its own title is the
/// only statement of intent there is. A pipeline PR keeps using its ticket,
/// whose body carries the fuller context the prompts were written against.
function chatSubject(db: Database.Database, pr: Pr): ReviewSubject {
  const ticket = pr.ticketId === null ? null : getTicket(db, pr.ticketId);
  return ticket ?? { title: pr.title, body: '' };
}

// gh needs an explicit selector since a detached worktree is on no branch for
// it to infer from. A row the fix pipeline inserted before the PR exists on
// GitHub has neither, so that has to fail before a worktree is even opened
// rather than let gh guess from whatever branch happens to be checked out.
function mergeSelector(pr: Pr): string {
  if (pr.number !== null) return String(pr.number);
  if (pr.url !== null) return pr.url;
  throw new Error(`PR ${pr.id} has no number or url to merge`);
}

// Squash-merging deletes the branch and cannot be undone, and revising force-pushes
// over it, so both are only ever done on a pull request the user wrote themselves.
// The inbox is mostly other people's work, assigned or awaiting review, and that is
// exactly what must not be rewritten from here.
async function refusePrChat(db: Database.Database, pr: Pr, merge: boolean): Promise<PrChatResult> {
  const reply = merge
    ? `Workbench only merges pull requests you authored. Merge ${pr.url} yourself on GitHub if that's what you want.`
    : `Workbench only changes pull requests you authored. Say it on ${pr.url} instead, so whoever wrote it can act on it.`;
  addPrMessage(db, pr.id, 'assistant', reply);
  return { action: 'refused', reply };
}

async function mergePrChat(db: Database.Database, pr: Pr, project: Project): Promise<PrChatResult> {
  const selector = mergeSelector(pr);
  const worktreePath = await openDetachedWorktree(project, pr.branch);
  try {
    await mergePr(worktreePath, selector);
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
  updatePrStatus(db, pr.id, 'merged', pr.lastReviewScore);
  setPrPinned(db, pr.id, false);
  const ticket = pr.ticketId === null ? null : getTicket(db, pr.ticketId);
  if (ticket) {
    updateTicketStatus(db, ticket.id, 'done', pr.id);
    setTicketPinned(db, ticket.id, false);
  }
  const reply = `Merged ${pr.url}.`;
  addPrMessage(db, pr.id, 'assistant', reply);
  return { action: 'merged', reply };
}

function buildRevisePrompt(subject: ReviewSubject, instruction: string): string {
  return `Revise the fix already implemented on this branch for "${subject.title}".

Requested change: ${instruction}

Make the changes directly in this working tree. Do not commit or push.`;
}

async function revisePrChat(
  db: Database.Database,
  pr: Pr,
  project: Project,
  subject: ReviewSubject,
  userMessage: string
): Promise<PrChatResult> {
  const worktreePath = await openDetachedWorktree(project, pr.branch);

  try {
    await runClaude({
      cwd: worktreePath,
      prompt: buildRevisePrompt(subject, userMessage),
      allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      timeoutMs: 30 * 60 * 1000,
    });

    const committed = await commitAll(worktreePath, `fix: ${userMessage}`);
    if (!committed) {
      const reply = "I didn't find a change to make for that. Could you be more specific?";
      addPrMessage(db, pr.id, 'assistant', reply);
      return { action: 'revised', reply };
    }

    await pushDetachedHead(worktreePath, pr.branch);
    const diff = await getDiff(worktreePath, project.defaultBranch);
    const score = await reviewDiff(worktreePath, subject, diff);
    const passed = reviewPasses(score);
    updatePrStatus(db, pr.id, passed ? 'open' : 'needs_attention', averageScore(score));

    const reply = passed ? passComment(score, 1) : failComment(score);
    addPrMessage(db, pr.id, 'assistant', reply);
    return { action: 'revised', reply };
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
}
