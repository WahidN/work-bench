import { claudeJson } from './claude.js';
import type { SourceIssue, Project, Analysis } from './types.js';

export function isAnalysis(v: any): v is Analysis {
  return (
    v &&
    typeof v.summary === 'string' &&
    typeof v.rootCause === 'string' &&
    typeof v.proposedFix === 'string' &&
    Array.isArray(v.affectedFiles) &&
    ['low', 'medium', 'high'].includes(v.confidence)
  );
}

export function buildAnalyzePrompt(issue: SourceIssue): string {
  return `Analyze this issue read-only, do not make any changes.

Title: ${issue.title}
Body: ${issue.body}

Return ONLY JSON: {"summary": "...", "rootCause": "...", "proposedFix": "...", "affectedFiles": ["..."], "confidence": "low"|"medium"|"high"}`;
}

export async function analyzeIssue(issue: SourceIssue, project: Project): Promise<Analysis> {
  return claudeJson(
    { cwd: project.repoPath, prompt: buildAnalyzePrompt(issue), allowedTools: ['Read', 'Grep', 'Glob'], timeoutMs: 15 * 60 * 1000 },
    isAnalysis
  );
}
