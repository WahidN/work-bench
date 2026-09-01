import { execa } from 'execa';
import { join } from 'node:path';
import type { Project } from './types.js';

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd });
  return stdout;
}

export function worktreePathFor(repoPath: string, branch: string): string {
  return join(repoPath, '.worktrees', branch.replace(/\//g, '-'));
}

export async function createFixWorktree(project: Project, branch: string): Promise<string> {
  const path = worktreePathFor(project.repoPath, branch);
  await git(project.repoPath, ['fetch', 'origin', project.defaultBranch]);
  await git(project.repoPath, ['worktree', 'remove', '--force', path]).catch(() => {});
  await git(project.repoPath, ['worktree', 'add', '-B', branch, path, `origin/${project.defaultBranch}`]);
  return path;
}

// Detached: checks out origin/<branch> without creating or moving a local branch.
// The prs table can now hold the user's own real branches, so opening one must
// never force a local branch pointer to wherever origin happens to be.
export async function openDetachedWorktree(project: Project, branch: string): Promise<string> {
  const path = worktreePathFor(project.repoPath, branch);
  await git(project.repoPath, ['fetch', 'origin', branch]);
  // getDiff compares against origin/<defaultBranch>, so that ref must be fresh.
  await git(project.repoPath, ['fetch', 'origin', project.defaultBranch]);
  await git(project.repoPath, ['worktree', 'remove', '--force', path]).catch(() => {});
  await git(project.repoPath, ['worktree', 'add', '--detach', path, `origin/${branch}`]);
  return path;
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await git(repoPath, ['worktree', 'remove', '--force', worktreePath]).catch(() => {});
}

export async function commitAll(worktreePath: string, message: string): Promise<boolean> {
  await git(worktreePath, ['add', '-A']);
  const status = await git(worktreePath, ['status', '--porcelain']);
  if (!status.trim()) return false;
  await git(worktreePath, ['commit', '-m', message]);
  return true;
}

export async function pushBranch(worktreePath: string, branch: string): Promise<void> {
  await git(worktreePath, ['push', '-u', 'origin', branch, '--force-with-lease']);
}

// For a detached-HEAD worktree: pushes the current commit to the remote branch
// by explicit refspec, so the remote branch moves without ever creating or
// moving a local branch to publish it.
export async function pushDetachedHead(worktreePath: string, branch: string): Promise<void> {
  await git(worktreePath, ['push', 'origin', `HEAD:${branch}`, '--force-with-lease']);
}

export async function getDiff(worktreePath: string, defaultBranch: string): Promise<string> {
  return git(worktreePath, ['diff', `origin/${defaultBranch}...HEAD`]);
}

// The commit a review's inline comments anchor to. Taken from the worktree the
// diff came from, so the line numbers and the commit they hang off cannot
// disagree. Asking GitHub for the head sha separately would be a second source
// of truth, and when the two differ the result is a comment on the wrong line
// rather than an error.
export async function headSha(worktreePath: string): Promise<string> {
  return (await git(worktreePath, ['rev-parse', 'HEAD'])).trim();
}

export async function createPr(
  worktreePath: string,
  title: string,
  body: string,
  baseBranch: string
): Promise<string> {
  try {
    const { stdout } = await execa(
      'gh',
      ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch],
      { cwd: worktreePath }
    );
    const match = stdout.match(/https:\/\/github\.com\/[^\s)]+/);
    return match ? match[0] : stdout.trim();
  } catch (err) {
    const existing = await execa('gh', ['pr', 'view', '--json', 'url', '-q', '.url'], {
      cwd: worktreePath,
    }).catch(() => null);
    if (!existing) throw err;
    await execa('gh', ['pr', 'ready'], { cwd: worktreePath }).catch(() => {});
    return existing.stdout.trim();
  }
}

export async function markPrDraft(worktreePath: string): Promise<void> {
  await execa('gh', ['pr', 'ready', '--undo'], { cwd: worktreePath });
}

// selector is a PR number or URL, given explicitly so gh never has to infer the
// PR from the current branch: a detached-HEAD worktree is on no branch at all.
export async function mergePr(worktreePath: string, selector: string): Promise<void> {
  await execa('gh', ['pr', 'merge', selector, '--squash', '--delete-branch'], { cwd: worktreePath });
}
