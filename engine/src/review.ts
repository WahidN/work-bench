import { claudeJson } from './claude.js';
import type { ReviewScore } from './types.js';

/// What the review needs to know about the work: a Ticket already is one. A pull
/// request with no ticket behind it fills this in from its own title.
export interface ReviewSubject {
  title: string;
  body: string;
}

const DIMENSIONS = ['correctness', 'completeness', 'quality', 'tests', 'regressionRisk'] as const;

export function averageScore(s: ReviewScore): number {
  return DIMENSIONS.reduce((sum, d) => sum + s[d], 0) / DIMENSIONS.length;
}

export function reviewPasses(s: ReviewScore): boolean {
  return averageScore(s) >= 4 && s.correctness >= 4;
}

export function isReviewScore(v: any): v is ReviewScore {
  return (
    v &&
    DIMENSIONS.every((d) => typeof v[d] === 'number') &&
    Array.isArray(v.findings)
  );
}

export function buildReviewPrompt(subject: ReviewSubject, diff: string): string {
  return `You are a strict code reviewer. A fix was implemented for this ticket:

Title: ${subject.title}
${subject.body}

Diff:
${diff}

Score each dimension 1 to 5, where 5 is best. For regressionRisk, 5 means very low risk of breaking existing behavior.
Return ONLY JSON: {"correctness": n, "completeness": n, "quality": n, "tests": n, "regressionRisk": n, "findings": ["..."]}`;
}

export async function reviewDiff(worktreePath: string, subject: ReviewSubject, diff: string): Promise<ReviewScore> {
  return claudeJson(
    { cwd: worktreePath, prompt: buildReviewPrompt(subject, diff), allowedTools: ['Read'], timeoutMs: 15 * 60 * 1000 },
    isReviewScore
  );
}
