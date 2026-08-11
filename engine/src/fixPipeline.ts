import type Database from 'better-sqlite3';
import { getProject } from './projects.js';
import { getTicket, listTicketMessages, updateTicketStatus } from './tickets.js';
import { recordPr, updatePrStatus, addPrMessage } from './prs.js';
import {
  createFixWorktree, removeWorktree, commitAll, pushBranch, getDiff, createPr, markPrDraft,
} from './git.js';
import { implementFix } from './implement.js';
import { reviewDiff, reviewPasses, averageScore } from './review.js';
import type { ReviewScore } from './types.js';

const MAX_REVIEW_ROUNDS = 3;

export interface FixResult {
  ticketStatus: 'in_review' | 'needs_attention';
  prId: number;
}

export function passComment(score: ReviewScore, rounds: number): string {
  return `Fix ready for review.
Review score: ${averageScore(score).toFixed(1)}/5 after ${rounds} round(s).
Scores: correctness ${score.correctness}, completeness ${score.completeness}, quality ${score.quality}, tests ${score.tests}, regression risk ${score.regressionRisk}.`;
}

export function failComment(score: ReviewScore): string {
  return `The fix did not reach the review threshold (minimum 4/5) after ${MAX_REVIEW_ROUNDS} rounds.
Unresolved findings:
${score.findings.map((f) => `- ${f}`).join('\n')}`;
}

export async function runFixPipeline(db: Database.Database, ticketId: number): Promise<FixResult> {
  const ticket = getTicket(db, ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  const project = getProject(db, ticket.projectId);
  if (!project) throw new Error(`Project ${ticket.projectId} not found`);

  const branch = `fix/${ticket.source}-${ticket.id}`;
  const worktreePath = await createFixWorktree(project, branch);

  try {
    const messages = listTicketMessages(db, ticketId);
    await implementFix(worktreePath, ticket, messages);

    const committed = await commitAll(worktreePath, `fix: ${ticket.title}`);
    if (!committed) throw new Error('implement session produced no changes');

    await pushBranch(worktreePath, branch);
    const prUrl = await createPr(
      worktreePath,
      ticket.title,
      `${ticket.body}\n\nWorkbench ticket: ${ticket.source}/${ticket.sourceId}`,
      project.defaultBranch
    );
    const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
    const pr = recordPr(db, {
      ticketId, projectId: project.id, branch,
      number: numberMatch ? Number(numberMatch[1]) : null, url: prUrl, status: 'open',
    });

    let lastScore: ReviewScore | null = null;
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      const diff = await getDiff(worktreePath, project.defaultBranch);
      const score = await reviewDiff(worktreePath, ticket, diff);
      lastScore = score;

      if (reviewPasses(score)) {
        updatePrStatus(db, pr.id, 'open', averageScore(score));
        addPrMessage(db, pr.id, 'assistant', passComment(score, round));
        updateTicketStatus(db, ticketId, 'in_review', pr.id);
        return { ticketStatus: 'in_review', prId: pr.id };
      }

      if (round < MAX_REVIEW_ROUNDS) {
        await implementFix(worktreePath, ticket, messages, score.findings);
        const changed = await commitAll(worktreePath, `fix: address review round ${round}`);
        if (!changed) break;
        await pushBranch(worktreePath, branch);
      }
    }

    await markPrDraft(worktreePath);
    updatePrStatus(db, pr.id, 'needs_attention', lastScore ? averageScore(lastScore) : null);
    addPrMessage(db, pr.id, 'assistant', failComment(lastScore!));
    updateTicketStatus(db, ticketId, 'needs_attention', pr.id);
    return { ticketStatus: 'needs_attention', prId: pr.id };
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
}
