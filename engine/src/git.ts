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

/// The files git still considers unmerged, meaning a conflict nobody resolved.
///
/// Read before `git add -A`, never after: staging a conflicted file is what marks it
/// resolved, so once everything is added the markers are ordinary content and there
/// is nothing left to detect.
export async function unresolvedConflicts(worktreePath: string): Promise<string[]> {
  const out = await git(worktreePath, ['diff', '--name-only', '--diff-filter=U']);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

export async function commitAll(worktreePath: string, message: string): Promise<boolean> {
  // Refused rather than committed. `git add -A` on a conflicted file marks it
  // resolved, and the commit then succeeds with `<<<<<<<` in the content, which
  // `pushDetachedHead` force-pushes onto the pull request. Nothing upstream of
  // here can see that, because after the add the conflict is gone from the index.
  //
  // Only reachable since a revise can start a merge; before that no caller ever
  // handed this a conflicted tree.
  const unresolved = await unresolvedConflicts(worktreePath);
  if (unresolved.length > 0) {
    throw new Error(`unresolved merge conflict in ${unresolved.join(', ')}, nothing was committed`);
  }

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

export type ConflictCheck =
  | { state: 'clean' }
  | { state: 'conflicts'; files: string[] }
  | { state: 'unknown' };

/// Whether merging the default branch into a branch would conflict, and where.
///
/// `merge-tree --write-tree` answers from the object store: no checkout, no second
/// worktree, and nothing left half merged if the engine dies mid-call. It needs
/// both refs to be current, which openDetachedWorktree fetches before anything
/// else runs.
///
/// Exit 0 is clean. Exit 1 is a conflict, but only when a merged tree came with
/// it: a ref git cannot resolve also exits 1, with the reason on stderr and
/// nothing at all on stdout. The tree oid on the first line is what tells those
/// two apart, so it is what this reads rather than the exit code alone.
///
/// Anything it cannot read is unknown rather than clean. Claiming a branch is
/// clean when git could not say is how a request gets refused for a conflict
/// nobody checked.
export async function conflictsWith(
  repoPath: string,
  defaultBranch: string,
  branch: string
): Promise<ConflictCheck> {
  const result = await execa(
    'git',
    ['merge-tree', '--write-tree', '--name-only', `origin/${defaultBranch}`, `origin/${branch}`],
    { cwd: repoPath, reject: false }
  ).catch(() => null);
  if (!result) return { state: 'unknown' };
  if (result.exitCode === 0) return { state: 'clean' };
  if (result.exitCode !== 1) return { state: 'unknown' };

  // First line is the tree oid, then the conflicted paths, then a blank line and
  // git's own running commentary.
  const lines = String(result.stdout ?? '').split('\n');
  if (!/^[0-9a-f]{40,64}$/.test(lines[0] ?? '')) return { state: 'unknown' };

  const rest = lines.slice(1);
  const end = rest.indexOf('');
  return { state: 'conflicts', files: (end === -1 ? rest : rest.slice(0, end)).filter(Boolean) };
}

/// Merges a ref into the worktree and leaves the result for commitAll to finish.
///
/// A conflict is the state the caller wants, so exit 1 is not a failure here.
/// `--no-commit` means the clean case is left staged too, rather than writing a
/// merge commit with a message nobody chose.
export async function mergeBranchInto(worktreePath: string, ref: string): Promise<void> {
  const result = await execa('git', ['merge', '--no-commit', '--no-ff', ref], {
    cwd: worktreePath,
    reject: false,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`git merge ${ref} failed: ${result.stderr || result.stdout}`);
  }
}
