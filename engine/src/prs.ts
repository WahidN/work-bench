import type Database from 'better-sqlite3';
import type { Pr, PrMessage, PrStatus, PrReviewState } from './types.js';

// Every route that returns a PR hands it to Swift, whose decoder has no defaults,
// so the message count has to ride along on every read rather than only the list.
const PR_SELECT = `SELECT p.*, (SELECT COUNT(*) FROM pr_messages m WHERE m.pr_id = p.id) AS message_count FROM prs p`;

function rowToPr(row: any): Pr {
  return {
    id: row.id, ticketId: row.ticket_id, projectId: row.project_id, branch: row.branch,
    number: row.number, url: row.url, status: row.status,
    lastReviewScore: row.last_review_score, pinned: !!row.pinned, createdAt: row.created_at,
    title: row.title, reviewState: row.review_state as PrReviewState | null,
    isDraft: !!row.is_draft, githubUpdatedAt: row.github_updated_at,
    authoredByMe: !!row.authored_by_me, assignedToMe: !!row.assigned_to_me,
    reviewRequestedByMe: !!row.review_requested_by_me,
    messageCount: Number(row.message_count ?? 0),
  };
}

export function getPr(db: Database.Database, id: number): Pr | null {
  const row = db.prepare(`${PR_SELECT} WHERE p.id = ?`).get(id);
  return row ? rowToPr(row) : null;
}

export function listPrs(db: Database.Database, filter: { status?: PrStatus } = {}): Pr[] {
  if (filter.status) {
    return db.prepare(`${PR_SELECT} WHERE p.status = ? ORDER BY p.created_at`).all(filter.status).map(rowToPr);
  }
  return db.prepare(`${PR_SELECT} ORDER BY p.created_at`).all().map(rowToPr);
}

export interface RecordPrInput {
  ticketId: number | null;
  projectId: number;
  branch: string;
  number: number | null;
  url: string | null;
  status: PrStatus;
}

// authored_by_me is set here, not left to the column default: recordPr is only
// ever called by the fix pipeline right after createPr runs `gh pr create` with
// the user's own authenticated gh, so the user is always the author.
export function recordPr(db: Database.Database, input: RecordPrInput): Pr {
  const result = db
    .prepare(
      `INSERT INTO prs (ticket_id, project_id, branch, number, url, status, created_at, authored_by_me)
       VALUES (@ticketId, @projectId, @branch, @number, @url, @status, @createdAt, 1)`
    )
    .run({ ...input, createdAt: new Date().toISOString() });
  return getPr(db, Number(result.lastInsertRowid))!;
}

export function setPrPinned(db: Database.Database, id: number, pinned: boolean): Pr | null {
  db.prepare('UPDATE prs SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  return getPr(db, id);
}

export function updatePrStatus(
  db: Database.Database,
  id: number,
  status: PrStatus,
  lastReviewScore: number | null
): Pr | null {
  db.prepare('UPDATE prs SET status = ?, last_review_score = ? WHERE id = ?').run(status, lastReviewScore, id);
  return getPr(db, id);
}

function rowToPrMessage(row: any): PrMessage {
  return { id: row.id, prId: row.pr_id, role: row.role, content: row.content, createdAt: row.created_at };
}

export function listPrMessages(db: Database.Database, prId: number): PrMessage[] {
  return db.prepare('SELECT * FROM pr_messages WHERE pr_id = ? ORDER BY id').all(prId).map(rowToPrMessage);
}

export function addPrMessage(db: Database.Database, prId: number, role: 'user' | 'assistant', content: string): PrMessage {
  const result = db
    .prepare('INSERT INTO pr_messages (pr_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(prId, role, content, new Date().toISOString());
  return rowToPrMessage(db.prepare('SELECT * FROM pr_messages WHERE id = ?').get(result.lastInsertRowid));
}

export interface UpsertGithubPrInput {
  projectId: number;
  number: number;
  title: string;
  url: string;
  githubUpdatedAt: string;
  isDraft: boolean;
  authoredByMe: boolean;
  assignedToMe: boolean;
  reviewRequestedByMe: boolean;
  reviewState: PrReviewState | null;
  branch: string;
}

/// Matches on (project_id, number) so a PR the fix pipeline opened and the same
/// PR seen from GitHub end up as one row instead of two. Status and ticket stay
/// whatever the engine set; the branch is taken from GitHub, which reports the
/// same name the pipeline pushed and gives an ingested PR a workable branch.
export function findPrByNumber(db: Database.Database, projectId: number, number: number): Pr | null {
  const row = db.prepare(`${PR_SELECT} WHERE p.project_id = ? AND p.number = ?`).get(projectId, number);
  return row ? rowToPr(row) : null;
}

export function upsertGithubPr(db: Database.Database, input: UpsertGithubPrInput): Pr {
  const existing = findPrByNumber(db, input.projectId, input.number);

  const fields = {
    title: input.title,
    url: input.url,
    githubUpdatedAt: input.githubUpdatedAt,
    isDraft: input.isDraft ? 1 : 0,
    authoredByMe: input.authoredByMe ? 1 : 0,
    assignedToMe: input.assignedToMe ? 1 : 0,
    // Restated on every poll, not only on insert: a review the user has given, or
    // one the author withdrew, has to clear or the queue keeps finished work.
    reviewRequestedByMe: input.reviewRequestedByMe ? 1 : 0,
    reviewState: input.reviewState,
    branch: input.branch,
  };

  if (existing) {
    db.prepare(
      `UPDATE prs SET title = @title, url = @url, github_updated_at = @githubUpdatedAt,
       is_draft = @isDraft, authored_by_me = @authoredByMe, assigned_to_me = @assignedToMe,
       review_requested_by_me = @reviewRequestedByMe,
       review_state = @reviewState, branch = @branch WHERE id = @id`
    ).run({ ...fields, id: existing.id });
    return getPr(db, existing.id)!;
  }

  const result = db
    .prepare(
      `INSERT INTO prs (ticket_id, project_id, branch, number, url, status, created_at,
         title, github_updated_at, is_draft, authored_by_me, assigned_to_me, review_requested_by_me, review_state)
       VALUES (NULL, @projectId, @branch, @number, @url, 'open', @createdAt,
         @title, @githubUpdatedAt, @isDraft, @authoredByMe, @assignedToMe, @reviewRequestedByMe, @reviewState)`
    )
    .run({ ...fields, projectId: input.projectId, number: input.number, createdAt: new Date().toISOString() });
  return getPr(db, Number(result.lastInsertRowid))!;
}

/// Deletes rows GitHub no longer returns, which is how a merged or closed PR
/// leaves the inbox. Two guards: a row with no number is mid creation by the
/// fix pipeline, and an empty fetch is far more likely a failed gh call than a
/// genuinely empty inbox, so it reconciles nothing at all.
export function reconcileGithubPrs(
  db: Database.Database,
  projectIds: number[],
  seen: Array<{ projectId: number; number: number }>
): number {
  if (seen.length === 0 || projectIds.length === 0) return 0;
  const keep = new Set(seen.map((s) => `${s.projectId}#${s.number}`));
  const rows = db
    .prepare(
      `SELECT id, project_id, number FROM prs
       WHERE number IS NOT NULL AND project_id IN (${projectIds.map(() => '?').join(',')})`
    )
    .all(...projectIds) as Array<{ id: number; project_id: number; number: number }>;

  const doomed = rows.filter((row) => !keep.has(`${row.project_id}#${row.number}`));
  const deleteMessages = db.prepare('DELETE FROM pr_messages WHERE pr_id = ?');
  // A stored review's remarks go with the pull request they are about. Their
  // `pr_id` is NOT NULL, so unlike a ticket's link this one cannot be cleared and
  // left behind, and a remark with no pull request could never be posted or read
  // anyway: the path, the line and the commit only mean something against it.
  //
  // Including the ones already posted. Those live on GitHub now, which is the
  // durable record; the row here is only the local draft they were sent from.
  //
  // Missing this is what broke every poll cycle for a day. Three tables reference
  // prs(id), two were handled here, and the third refused the delete. Because the
  // loop below is one transaction, that one row rolled back all the others, so
  // nine merged pull requests stayed in the inbox and `POST /poll` answered
  // `githubPrs: FOREIGN KEY constraint failed` with no clue which table.
  const deleteFindings = db.prepare('DELETE FROM pr_review_findings WHERE pr_id = ?');
  const deleteCommentFixes = db.prepare('DELETE FROM pr_comment_fixes WHERE pr_id = ?');
  // A ticket keeps pointing at the PR the fix pipeline opened for it, and
  // foreign keys are enforced, so the reference has to go before the row does.
  // The ticket itself stays: its history is worth more than the link.
  const clearTicketLink = db.prepare('UPDATE tickets SET pr_id = NULL WHERE pr_id = ?');
  const deletePr = db.prepare('DELETE FROM prs WHERE id = ?');
  db.transaction(() => {
    for (const row of doomed) {
      deleteMessages.run(row.id);
      deleteFindings.run(row.id);
      deleteCommentFixes.run(row.id);
      clearTicketLink.run(row.id);
      deletePr.run(row.id);
    }
  })();
  return doomed.length;
}
