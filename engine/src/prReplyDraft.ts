import type Database from 'better-sqlite3';
import { getPr } from './prs.js';
import { getProject } from './projects.js';
import { runClaude } from './claude.js';
import { fetchReviewComment, type ReviewCommentDetail } from './sources/githubPrDetail.js';

export function buildReplyPrompt(comment: ReviewCommentDetail, prTitle: string): string {
  return `A reviewer left this comment on the pull request "${prTitle}". Write a reply to it.

Reviewer: ${comment.author}
File: ${comment.path}

Their comment:
${comment.body}

The diff they commented on:
${comment.diffHunk}

Read whatever you need to answer accurately. This is read-only analysis, do not make any changes.
Reply with the message text only, no preamble and no sign-off.`;
}

/// Produces suggested text and nothing else. Posting is a separate, explicit
/// action, because this text goes to a repository other people read.
export async function draftReviewReply(
  db: Database.Database,
  prId: number,
  commentId: number
): Promise<string> {
  const pr = getPr(db, prId);
  if (!pr) throw new Error(`PR ${prId} not found`);
  const project = getProject(db, pr.projectId);
  if (!project) throw new Error(`Project ${pr.projectId} not found`);
  if (!project.githubRepo) throw new Error(`Project ${project.id} has no GitHub repo configured`);

  const comment = await fetchReviewComment(project.githubRepo, commentId);
  return runClaude({
    cwd: project.repoPath,
    prompt: buildReplyPrompt(comment, pr.title),
    allowedTools: ['Read', 'Grep', 'Glob'],
    timeoutMs: 15 * 60 * 1000,
  });
}
