import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { worktreePathFor, mergePr, openWorktree } from '../src/git.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

describe('worktreePathFor', () => {
  it('replaces slashes in the branch name for the directory name', () => {
    expect(worktreePathFor('/repos/demo', 'fix/lin-7')).toBe('/repos/demo/.worktrees/fix-lin-7');
  });
});

describe('mergePr', () => {
  it('runs gh pr merge with --squash in the worktree', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await mergePr('/repos/demo/.worktrees/fix-lin-7');
    expect(execa).toHaveBeenCalledWith('gh', ['pr', 'merge', '--squash', '--delete-branch'], {
      cwd: '/repos/demo/.worktrees/fix-lin-7',
    });
  });
});

describe('openWorktree', () => {
  it('fetches and bases the worktree off the existing branch, not the default branch', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    const project = { id: 1, name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main', githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null, status: 'active' as const, blurb: '' };
    const path = await openWorktree(project, 'fix/gh-demo-1');
    expect(path).toBe('/repos/demo/.worktrees/fix-gh-demo-1');
    expect(execa).toHaveBeenCalledWith('git', ['fetch', 'origin', 'fix/gh-demo-1'], { cwd: '/repos/demo' });
    expect(execa).toHaveBeenCalledWith('git', ['fetch', 'origin', 'main'], { cwd: '/repos/demo' });
    expect(execa).toHaveBeenCalledWith('git', ['worktree', 'add', '-B', 'fix/gh-demo-1', path, 'origin/fix/gh-demo-1'], { cwd: '/repos/demo' });
  });
});
