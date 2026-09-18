import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getPr, addPrMessage, updatePrStatus, setPrPinned } from './prs.js';
import { getTicket, updateTicketStatus, setTicketPinned } from './tickets.js';
import {
  openDetachedWorktree, removeWorktree, commitAll, pushDetachedHead, getDiff, mergePr,
  conflictsWith, mergeBranchInto, unresolvedConflicts, type ConflictCheck,
} from './git.js';
import { runClaude } from './claude.js';
import { reviewDiff, reviewPasses, averageScore, type ReviewSubject } from './review.js';
import { passComment, failComment } from './fixPipeline.js';
import type { Pr, Project } from './types.js';
import { clearPrReviewed } from './prReviewStore.js';

const MERGE_PHRASES = ['merge it', 'merge this', 'go ahead and merge'];

// Merging must be a direct, explicit user action, so the whole message has to be
// the merge phrase. A substring match would fire on "don't merge this yet".
// Only trailing dots and exclamation marks are stripped, never a question mark:
// "merge it?" is a question, not an instruction.
export function isMergeRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/[.!\s]+$/, '');
  return MERGE_PHRASES.includes(normalized);
}

const CONFLICT_PHRASES = [
  'merge conflict',
  'conflict with',
  'conflicts with',
  'resolve the conflict',
  'fix the conflict',
];

// Substring, unlike isMergeRequest, because this is a sentence rather than a
// command phrase: "fix the merge conflict in this branch" is how it gets asked.
// Each phrase puts the word next to a merge, so a file called conflict.ts does
// not fire it. The worst a false positive can do is merge the default branch
// into a branch that already needed it.
export function isConflictRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return CONFLICT_PHRASES.some((phrase) => normalized.includes(phrase));
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

/// The agent gets a worktree it did not open, so the prompt has to say what that
/// worktree is. Without this it assumed a merge was in progress and spent the
/// whole timeout looking for conflict markers that were not there.
export function buildRevisePrompt(
  subject: ReviewSubject,
  instruction: string,
  defaultBranch: string,
  conflict: ConflictCheck | null
): string {
  const state =
    conflict?.state === 'conflicts'
      ? `The working tree is a detached checkout of the branch head with origin/${defaultBranch} merged into it, and that merge is in progress and uncommitted. These files conflict and are marked up in the tree:
${conflict.files.map((file) => `- ${file}`).join('\n')}`
      : `The working tree is a detached checkout of the branch head. Nothing has been merged into it and no merge is in progress.`;

  return `Revise the fix already implemented on this branch for "${subject.title}".

Requested change: ${instruction}

${state}

Make the changes directly in this working tree. Do not commit or push.`;
}

async function revisePrChat(
  db: Database.Database,
  pr: Pr,
  project: Project,
  subject: ReviewSubject,
  userMessage: string
): Promise<PrChatResult> {
  // Opened first because it fetches origin/<branch> and origin/<default>, which
  // conflictsWith needs to be current before it can answer.
  const worktreePath = await openDetachedWorktree(project, pr.branch);

  try {
    // Only for a request about the conflict. Merging on every revision would put
    // a merge commit in a pull request that asked for something else, and grow
    // the diff the self-review then scores.
    const conflict = isConflictRequest(userMessage)
      ? await conflictsWith(project.repoPath, project.defaultBranch, pr.branch)
      : null;

    // The case that cost 30 minutes: asked to fix a conflict, handed a clean
    // checkout with nothing to fix in it. An unknown check is not a clean one,
    // so it runs rather than refuses.
    if (conflict?.state === 'clean') {
      const reply = `This branch has no conflict with ${project.defaultBranch}, it merges cleanly as it stands. Tell me what to change instead, or merge it on GitHub.`;
      addPrMessage(db, pr.id, 'assistant', reply);
      return { action: 'revised', reply };
    }

    if (conflict?.state === 'conflicts') {
      await mergeBranchInto(worktreePath, `origin/${project.defaultBranch}`);
    }

    await runClaude({
      cwd: worktreePath,
      prompt: buildRevisePrompt(subject, userMessage, project.defaultBranch, conflict),
      allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      timeoutMs: 30 * 60 * 1000,
    });

    // The agent is not obliged to succeed, and a merge it half resolved must not be
    // committed. `commitAll` refuses it either way; this is here so the answer names
    // the files instead of reading as a git error.
    const unresolved = await unresolvedConflicts(worktreePath);
    if (unresolved.length > 0) {
      const reply = `I could not resolve the conflict. ${unresolved.join(', ')} still has conflict markers in it, so nothing was committed or pushed. Resolve it yourself, or tell me which side to keep.`;
      addPrMessage(db, pr.id, 'assistant', reply);
      return { action: 'revised', reply };
    }

    const committed = await commitAll(worktreePath, `fix: ${userMessage}`);
    if (!committed) {
      const reply = "I didn't find a change to make for that. Could you be more specific?";
      addPrMessage(db, pr.id, 'assistant', reply);
      return { action: 'revised', reply };
    }

    await pushDetachedHead(worktreePath, pr.branch);
    // The branch has moved, so the stored review no longer describes it.
    clearPrReviewed(db, pr.id);
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
