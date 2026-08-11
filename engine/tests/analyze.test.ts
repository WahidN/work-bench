import { describe, expect, it } from 'vitest';
import { isAnalysis, buildAnalyzePrompt } from '../src/analyze.js';
import type { SourceIssue } from '../src/types.js';

const issue: SourceIssue = {
  source: 'github', sourceId: 'GH-linku/demo#1', title: 'Crash on null user',
  url: 'https://github.com/linku/demo/issues/1', body: 'TypeError: user is null', projectKey: 'linku/demo',
};

describe('isAnalysis', () => {
  it('accepts a well-formed analysis', () => {
    expect(isAnalysis({
      summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: ['a.ts'], confidence: 'high',
    })).toBe(true);
  });

  it('rejects a missing confidence field', () => {
    expect(isAnalysis({ summary: 's', rootCause: 'r', proposedFix: 'p', affectedFiles: [] })).toBe(false);
  });
});

describe('buildAnalyzePrompt', () => {
  it('embeds the issue title and body', () => {
    const prompt = buildAnalyzePrompt(issue);
    expect(prompt).toContain('Crash on null user');
    expect(prompt).toContain('TypeError: user is null');
  });
});
