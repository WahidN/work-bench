import { describe, expect, it } from 'vitest';
import { averageScore, reviewPasses, isReviewScore, buildReviewPrompt } from '../src/review.js';
import type { Ticket, ReviewScore } from '../src/types.js';

const ticket: Ticket = {
  id: 1, source: 'github', sourceId: 'GH-1', projectId: 1, title: 'Fix null check',
  body: 'desc', url: 'https://x', analysis: null, status: 'in_review', prId: 1, createdAt: '2026-01-01',
};

describe('averageScore / reviewPasses', () => {
  it('averages the 5 dimensions', () => {
    const s: ReviewScore = { correctness: 5, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [] };
    expect(averageScore(s)).toBe(5);
  });

  it('fails when correctness is below 4 even if the average is high', () => {
    const s: ReviewScore = { correctness: 3, completeness: 5, quality: 5, tests: 5, regressionRisk: 5, findings: [] };
    expect(averageScore(s)).toBe(4.6);
    expect(reviewPasses(s)).toBe(false);
  });

  it('passes at exactly the 4/4 boundary', () => {
    const s: ReviewScore = { correctness: 4, completeness: 4, quality: 4, tests: 4, regressionRisk: 4, findings: [] };
    expect(reviewPasses(s)).toBe(true);
  });
});

describe('isReviewScore', () => {
  it('accepts a well-formed score', () => {
    expect(isReviewScore({ correctness: 4, completeness: 4, quality: 4, tests: 4, regressionRisk: 4, findings: [] })).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isReviewScore({ correctness: 4 })).toBe(false);
  });
});

describe('buildReviewPrompt', () => {
  it('embeds the diff and the rubric dimensions', () => {
    const prompt = buildReviewPrompt(ticket, '--- a/x.ts\n+++ b/x.ts');
    expect(prompt).toContain('--- a/x.ts');
    expect(prompt).toContain('correctness');
    expect(prompt).toContain('regressionRisk');
  });
});
