import { execa } from 'execa';
import type { SourceIssue } from '../types.js';

export function mapGithubIssue(raw: any, repo: string): SourceIssue {
  return {
    source: 'github',
    sourceId: `GH-${repo}#${raw.number}`,
    title: raw.title,
    url: raw.url,
    body: raw.body ?? '',
    projectKey: repo,
  };
}

export async function fetchGithubIssues(repos: string[]): Promise<SourceIssue[]> {
  const results: SourceIssue[] = [];
  for (const repo of repos) {
    try {
      const { stdout } = await execa('gh', [
        'search', 'issues', '--assignee=@me', '--state=open', '--repo', repo,
        '--json', 'number,title,body,url',
      ]);
      const raws = JSON.parse(stdout || '[]');
      results.push(...raws.map((raw: any) => mapGithubIssue(raw, repo)));
    } catch (err) {
      throw new Error(`GitHub fetch failed for ${repo}: ${String(err)}`);
    }
  }
  return results;
}
