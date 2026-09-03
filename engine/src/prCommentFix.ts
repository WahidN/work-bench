import type Database from 'better-sqlite3';
import { openDetachedWorktree, removeWorktree, commitAll, pushDetachedHead } from './git.js';
import { runClaude } from './claude.js';
import { getTicket } from './tickets.js';
import { getPr } from './prs.js';
import { getProject } from './projects.js';
import { acquireJob, finishJob } from './jobs.js';
import { claimNextQueuedFix, finishCommentFix } from './prCommentFixStore.js';
import type { ReviewSubject } from './review.js';
import type { CommentFixState, Pr, Project } from './types.js';

export interface CommentFixRequest {
  commentId: number;
  path: string;
  line: number;
  comment: string;
  instruction: string;
}

export interface CommentFixResult {
  state: Exclude<CommentFixState, 'queued' | 'running'>;
  detail: string | null;
}

function fixSubject(db: Database.Database, pr: Pr): ReviewSubject {
  const ticket = pr.ticketId === null ? null : getTicket(db, pr.ticketId);
  return ticket ?? { title: pr.title, body: '' };
}

export function buildCommentFixPrompt(subject: ReviewSubject, request: CommentFixRequest): string {
  return `A reviewer left this comment on "${subject.title}", on ${request.path} at line ${request.line}:

${request.comment}

The author wants it answered in the code, and says: ${request.instruction}

Change only what that comment is about. Make the changes directly in this working tree. Do not commit and do not push.`;
}

export async function runCommentFix(
  db: Database.Database,
  pr: Pr,
  project: Project,
  request: CommentFixRequest
): Promise<CommentFixResult> {
  if (!pr.authoredByMe) {
    throw new Error(`Workbench only fixes pull requests you authored. ${pr.url} is not one.`);
  }

  const subject = fixSubject(db, pr);
  const worktreePath = await openDetachedWorktree(project, pr.branch);

  try {
    await runClaude({
      cwd: worktreePath,
      prompt: buildCommentFixPrompt(subject, request),
      allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
      timeoutMs: 30 * 60 * 1000,
    });

    const committed = await commitAll(
      worktreePath,
      `fix: review comment on ${request.path}:${request.line}`
    );
    if (!committed) {
      return {
        state: 'nothing',
        detail: "The agent found no change to make for that. Try saying more precisely what to change.",
      };
    }

    try {
      await pushDetachedHead(worktreePath, pr.branch);
    } catch (err) {
      return {
        state: 'failed',
        detail: `The branch moved on while this fix ran, so it was not published: ${String(err)}`,
      };
    }

    return { state: 'landed', detail: null };
  } finally {
    await removeWorktree(project.repoPath, worktreePath);
  }
}

const draining = new WeakMap<Database.Database, Set<number>>();

function beginDraining(db: Database.Database, prId: number): boolean {
  let prIds = draining.get(db);
  if (!prIds) {
    prIds = new Set();
    draining.set(db, prIds);
  }
  if (prIds.has(prId)) return false;
  prIds.add(prId);
  return true;
}

function endDraining(db: Database.Database, prId: number): void {
  draining.get(db)?.delete(prId);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function drainCommentFixes(
  db: Database.Database,
  prId: number,
  options: { retryMs?: number } = {}
): Promise<void> {
  const retryMs = options.retryMs ?? 5_000;
  if (!beginDraining(db, prId)) return;

  try {
    while (true) {
      const pending = db
        .prepare(`SELECT id FROM pr_comment_fixes WHERE pr_id = ? AND state = 'queued' LIMIT 1`)
        .get(prId);
      if (!pending) return;

      const job = acquireJob(db, 'pr-chat', 'pr', prId);
      if (!job) {
        await wait(retryMs);
        continue;
      }

      const fix = claimNextQueuedFix(db, prId);
      if (!fix) {
        finishJob(db, job.id, 'done');
        return;
      }

      const pr = getPr(db, prId);
      const project = pr ? getProject(db, pr.projectId) : null;
      let failure: string | null = null;
      try {
        if (!pr || !project) throw new Error(`PR ${prId} or its project is gone`);
        const result = await runCommentFix(db, pr, project, {
          commentId: fix.commentId,
          path: fix.path,
          line: fix.line,
          comment: fix.comment,
          instruction: fix.instruction,
        });
        finishCommentFix(db, fix.id, result.state, result.detail);
      } catch (err) {
        failure = String(err);
        finishCommentFix(db, fix.id, 'failed', failure);
      } finally {
        finishJob(db, job.id, failure ? 'failed' : 'done', failure);
      }
    }
  } finally {
    endDraining(db, prId);
  }
}
