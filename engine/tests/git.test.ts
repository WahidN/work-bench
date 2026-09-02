import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import { worktreePathFor, mergePr, openDetachedWorktree, pushDetachedHead, createFixWorktree, headSha } from '../src/git.js';

vi.mock('execa');
afterEach(() => vi.clearAllMocks());

const demoProject = {
  id: 1, name: 'demo', repoPath: '/repos/demo', defaultBranch: 'main',
  githubRepo: null, jiraProjectKey: null, sentryProjectSlug: null,
  status: 'active' as const, blurb: '', notes: '',
};

describe('worktreePathFor', () => {
  it('replaces slashes in the branch name for the directory name', () => {
    expect(worktreePathFor('/repos/demo', 'fix/lin-7')).toBe('/repos/demo/.worktrees/fix-lin-7');
  });
});

describe('mergePr', () => {
  it('runs gh pr merge with the selector and --squash in the worktree', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await mergePr('/repos/demo/.worktrees/fix-lin-7', '24');
    expect(execa).toHaveBeenCalledWith('gh', ['pr', 'merge', '24', '--squash', '--delete-branch'], {
      cwd: '/repos/demo/.worktrees/fix-lin-7',
    });
  });
});

describe('openDetachedWorktree', () => {
  it('fetches the branch and the default branch, then checks out detached without creating or moving a local branch', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    const path = await openDetachedWorktree(demoProject, 'feat/header');
    expect(path).toBe('/repos/demo/.worktrees/feat-header');
    expect(execa).toHaveBeenCalledWith('git', ['fetch', 'origin', 'feat/header'], { cwd: '/repos/demo' });
    expect(execa).toHaveBeenCalledWith('git', ['fetch', 'origin', 'main'], { cwd: '/repos/demo' });
    expect(execa).toHaveBeenCalledWith('git', ['worktree', 'remove', '--force', path], { cwd: '/repos/demo' });
    expect(execa).toHaveBeenCalledWith('git', ['worktree', 'add', '--detach', path, 'origin/feat/header'], { cwd: '/repos/demo' });

    const usedDashB = vi.mocked(execa).mock.calls.some(
      (call) => Array.isArray(call[1]) && (call[1] as string[]).includes('-B')
    );
    expect(usedDashB).toBe(false);
  });
});

describe('pushDetachedHead', () => {
  it('pushes HEAD to the remote branch by explicit refspec, never touching a local branch', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    await pushDetachedHead('/repos/demo/.worktrees/feat-header', 'feat/header');
    expect(execa).toHaveBeenCalledWith('git', ['push', 'origin', 'HEAD:feat/header', '--force-with-lease'], {
      cwd: '/repos/demo/.worktrees/feat-header',
    });
  });
});

describe('createFixWorktree', () => {
  it('still force-moves a local branch onto the default branch, for the pipeline own fresh work', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    const path = await createFixWorktree(demoProject, 'fix/lin-7');
    expect(path).toBe('/repos/demo/.worktrees/fix-lin-7');
    expect(execa).toHaveBeenCalledWith('git', ['worktree', 'add', '-B', 'fix/lin-7', path, 'origin/main'], {
      cwd: '/repos/demo',
    });
  });
});

// The commit an inline comment anchors to has to be the one the diff was taken
// from, or the line numbers describe code the comment is not attached to.
// Reading it from the worktree is what keeps those two in step.
describe('headSha', () => {
  it('reads the checked-out commit of the worktree', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'a1b2c3d4\n' } as any);

    const sha = await headSha('/repos/demo/.worktrees/feat-header');

    expect(sha).toBe('a1b2c3d4');
    expect(execa).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], {
      cwd: '/repos/demo/.worktrees/feat-header',
    });
  });
});
