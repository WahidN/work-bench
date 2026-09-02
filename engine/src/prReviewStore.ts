import type Database from 'better-sqlite3';
import type { ReviewFinding, StoredReviewFinding } from './types.js';

function rowToFinding(row: any): StoredReviewFinding {
  return {
    id: row.id,
    prId: row.pr_id,
    path: row.path,
    line: row.line,
    body: row.body,
    commitSha: row.commit_sha,
    posted: !!row.posted,
    createdAt: row.created_at,
  };
}

/// Writes a review's findings, replacing whatever that pull request had.
///
/// Replacing rather than appending: a second review of the same pull request is a
/// fresh opinion of the current code, not more remarks to add to the last one, and
/// stacking them would fill the page with duplicates from every run.
///
/// One transaction, so a review is never half-replaced: the old remarks are gone
/// and the new ones are not there yet.
export function replaceReviewFindings(
  db: Database.Database,
  prId: number,
  findings: ReviewFinding[],
  commitSha: string
): void {
  const now = new Date().toISOString();
  const clear = db.prepare('DELETE FROM pr_review_findings WHERE pr_id = ?');
  const insert = db.prepare(
    `INSERT INTO pr_review_findings (pr_id, path, line, body, commit_sha, posted, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  );

  db.transaction(() => {
    clear.run(prId);
    for (const finding of findings) {
      insert.run(prId, finding.path, finding.line, finding.body, commitSha, now);
    }
  })();
}

/// Ordered by id, which is insertion order, so the page does not reshuffle
/// between reads.
export function listReviewFindings(db: Database.Database, prId: number): StoredReviewFinding[] {
  return db
    .prepare('SELECT * FROM pr_review_findings WHERE pr_id = ? ORDER BY id')
    .all(prId)
    .map(rowToFinding);
}

export function getReviewFinding(db: Database.Database, id: number): StoredReviewFinding | null {
  const row = db.prepare('SELECT * FROM pr_review_findings WHERE id = ?').get(id);
  return row ? rowToFinding(row) : null;
}

export function markFindingPosted(db: Database.Database, id: number): void {
  db.prepare('UPDATE pr_review_findings SET posted = 1 WHERE id = ?').run(id);
}

/// False when there was nothing to delete, so the route can answer 404 rather
/// than reporting success for an id that never existed.
export function deleteReviewFinding(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM pr_review_findings WHERE id = ?').run(id).changes > 0;
}
