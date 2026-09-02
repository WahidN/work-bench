import { claudeJson } from './claude.js';
import type { ReviewSubject } from './review.js';
import type { ReviewFinding } from './types.js';

interface ReviewFindings {
  findings: ReviewFinding[];
}

/// Deliberately separate from `buildReviewPrompt` in review.ts. That one asks
/// "is this good enough to merge" and wants a verdict; this one asks "what
/// should I say, and where" and wants anchored remarks. Asking one model for
/// both shapes at once tends to return a blend of the two.
///
/// The line must be one the diff actually shows, because a remark anchored
/// anywhere else is thrown away before it is ever posted.
export function buildPrReviewPrompt(subject: ReviewSubject, diff: string): string {
  return `You are reviewing a pull request titled "${subject.title}".
${subject.body}

Diff:
${diff}

Write review remarks about this change. Each remark is posted as a comment on one
line of the diff, on its own, with nothing else around it: no summary, no heading
and no other remark to lean on. Write each one so it reads as a comment a
colleague left on that line.

Only comment on lines the diff above shows as added or unchanged. Use the line
number from the new version of the file, and give the file path exactly as the
diff spells it.

Say something only where it is worth a colleague's time. Few sharp remarks beat a
list of everything noticed. If the change is fine, return no findings at all.

Return ONLY JSON: {"findings": [{"path": "...", "line": 0, "body": "..."}]}`;
}

export function isReviewFindings(v: any): v is ReviewFindings {
  if (!v || !Array.isArray(v.findings)) return false;
  return v.findings.every(
    (f: any) =>
      f &&
      typeof f.path === 'string' &&
      f.path.length > 0 &&
      typeof f.line === 'number' &&
      typeof f.body === 'string' &&
      // An empty body would post a comment that says nothing, which is worse
      // than no comment at all.
      f.body.trim().length > 0
  );
}

/// Read-only by construction. The tool list is the boundary: a prompt asking the
/// model not to change anything is a request, whereas withholding Write, Edit and
/// Bash is a guarantee. This is what makes "reviewing changes nothing" a property
/// of the system rather than of the model's cooperation.
export async function reviewPrDiff(
  worktreePath: string,
  subject: ReviewSubject,
  diff: string
): Promise<ReviewFinding[]> {
  const result = await claudeJson<ReviewFindings>(
    {
      cwd: worktreePath,
      prompt: buildPrReviewPrompt(subject, diff),
      allowedTools: ['Read', 'Grep', 'Glob'],
      timeoutMs: 15 * 60 * 1000,
    },
    isReviewFindings
  );
  return result.findings;
}
