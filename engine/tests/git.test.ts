import { describe, expect, it, vi, afterEach } from 'vitest';
import { execa } from 'execa';
import {
  worktreePathFor, mergePr, openDetachedWorktree, pushDetachedHead, createFixWorktree, headSha,
  conflictsWith, mergeBranchInto,
} from '../src/git.js';

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

// `merge-tree --write-tree` answers from the object store alone: no checkout, no
// second worktree, and it cannot leave the repo mid-merge if the engine dies.
describe('conflictsWith', () => {
  it('reads exit 1 as conflicting and lists the files', async () => {
    vi.mocked(execa).mockResolvedValue({
      exitCode: 1,
      stdout: [
        '1f2e126c6ec389bae18237672df145732e64ae28',
        'sanityConfig/personalization/personalizationTypes.ts',
        'sanityConfig/schemas/index.ts',
        '',
        'Auto-merging sanityConfig/schemas/index.ts',
        'CONFLICT (content): Merge conflict in sanityConfig/schemas/index.ts',
      ].join('\n'),
    } as any);

    const result = await conflictsWith('/repos/demo', 'main', 'chore/remove-unused-schemas');

    expect(result).toEqual({
      state: 'conflicts',
      files: ['sanityConfig/personalization/personalizationTypes.ts', 'sanityConfig/schemas/index.ts'],
    });
    expect(execa).toHaveBeenCalledWith(
      'git',
      ['merge-tree', '--write-tree', '--name-only', 'origin/main', 'origin/chore/remove-unused-schemas'],
      { cwd: '/repos/demo', reject: false }
    );
  });

  it('reads exit 0 as clean', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: 'f61596ba410370c41618db6082cc7f810db23ba7' } as any);

    expect(await conflictsWith('/repos/demo', 'main', 'feat/header')).toEqual({ state: 'clean' });
  });

  it('reads any other exit as unknown', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 128, stdout: '' } as any);

    expect(await conflictsWith('/repos/demo', 'main', 'gone')).toEqual({ state: 'unknown' });
  });

  // Measured on the ACV repo: a ref git cannot resolve exits 1, the same as a
  // conflict, with "not something we can merge" on stderr and nothing on stdout.
  // Reading the exit code alone reported a conflict for a branch that is gone.
  it('reads exit 1 with no tree as unknown, not as conflicting', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 1, stdout: '' } as any);

    expect(await conflictsWith('/repos/demo', 'main', 'gone')).toEqual({ state: 'unknown' });
  });

  it('reads a throw as unknown', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('git missing'));

    expect(await conflictsWith('/repos/demo', 'main', 'feat/header')).toEqual({ state: 'unknown' });
  });
});

describe('mergeBranchInto', () => {
  // A conflict is the state this wants, so exit 1 is a success here. --no-commit
  // leaves both outcomes for commitAll to finish, so the clean case does not
  // sneak in a commit message nobody wrote.
  it('does not throw when the merge conflicts', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 1, stdout: '' } as any);

    await expect(mergeBranchInto('/repos/demo/.worktrees/x', 'origin/main')).resolves.toBeUndefined();
    expect(execa).toHaveBeenCalledWith('git', ['merge', '--no-commit', '--no-ff', 'origin/main'], {
      cwd: '/repos/demo/.worktrees/x',
      reject: false,
    });
  });

  it('does not throw when the merge is clean', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '' } as any);

    await expect(mergeBranchInto('/repos/demo/.worktrees/x', 'origin/main')).resolves.toBeUndefined();
  });

  it('throws when git could not merge at all', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 128, stdout: '', stderr: 'not something we can merge' } as any);

    await expect(mergeBranchInto('/repos/demo/.worktrees/x', 'origin/main')).rejects.toThrow();
  });
});
