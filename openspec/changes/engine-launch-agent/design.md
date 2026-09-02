## Context

See proposal.md - Why for the motivation and `specs/engine-lifecycle/spec.md` for the contract.

What constrains the approach:

- The engine is started today with `pnpm start` from `engine/`, which runs `tsx src/index.ts`. It binds `127.0.0.1:4173` and nothing else supervises it.
- On this machine `pnpm` is at `/opt/homebrew/bin/pnpm` and `node` resolves through a version-manager shim at `/Users/wahidlinku/.vite-plus/bin/node`. A GUI application inherits neither: launched apps get a minimal `PATH`, so a naive spawn of `pnpm` fails with "command not found". This is the single biggest trap in the change.
- The app is built into DerivedData. It has no reliable path back to the checkout, and this session's checkout is a git worktree whose directory name is already misleading, so any guess would be wrong.
- The app has no `UserDefaults` usage yet and reaches the Keychain only through `KeychainClient` for secrets.
- `APIClient.baseURL` is a hardcoded `http://127.0.0.1:4173`. Reachability can be judged from any authenticated request failing at the transport layer.

## Goals

- One place decides whether the engine is reachable, and every part of the UI reads that.
- The managed engine uses the user's own toolchain without the app having to discover, or hardcode, where it lives.
- Installing and removing are both reversible from the Settings sheet and leave nothing behind.

## Non-Goals

- Bundling Node or the engine inside the app. That would make it self-contained and is the right long-term answer, but it is a packaging project, not this change.
- Supervising anything other than the engine.
- Changing how the app authenticates, or adding an unauthenticated health endpoint. Reachability is judged from a request the app is already entitled to make.
- Auto-installing the agent without being asked. Writing to `~/Library/LaunchAgents` is the user's decision, made in Settings.
- Restarting the engine automatically from inside the app. launchd's `KeepAlive` does that better, and doing both would fight.

## Decisions

### Discover the toolchain once at install time, and run no shell at launch

The plist runs the real node binary directly on the pnpm script, with an explicit
`PATH` and `WorkingDirectory` and no shell anywhere:

```
ProgramArguments = [<realNode>, <pnpm>, "start"]
WorkingDirectory = <engineDir>
EnvironmentVariables.PATH = <realNodeDir>:<pnpmDir>:/usr/bin:/bin:/usr/sbin:/sbin
```

**Rewritten during implementation, after the shell approach failed three times.** The
original decision was a shell wrapper so the engine would resolve `pnpm` and `node` the
way the user's terminal does. Each attempt failed for a different reason, and the
sequence is worth keeping because each one looked like the fix:

1. `-lc` (login) sources `.zprofile`, which supplies Homebrew's `pnpm` but also
   Homebrew's node v26. v26 cannot load the `better-sqlite3` that v24 compiled, so
   every `KeepAlive` retry died on `ERR_DLOPEN_FAILED`, 855 log lines of it.
2. `-ic` (interactive) sources `.zshrc`, which supplies the version manager's node v24
   but not Homebrew, so the job died with `command not found: pnpm` and exit code 127.
   Worse, `.zshrc` did not even complete under launchd: it failed on `pyenv` not being
   found before it finished building `PATH`.
3. `-lic` sources both and does resolve both tools, but `~/.vite-plus/bin/node` is a
   symlink to a single multiplexed `vp` binary. Under launchd that shim hangs forever
   on a unix socket waiting for a service that is not there. The job reported
   `state = running` with a live pid while nothing ever listened and nothing was ever
   logged, which is the most misleading of the three failures.

The shim in step 3 is what settles it. No shell invocation can help, because the thing
the shell resolves to is itself the problem. So the shell is used exactly once, at
install time, to ask the toolchain where it really lives:

- `node -e 'process.stdout.write(process.execPath)'` makes the shim report the real
  binary behind it, which is the load-bearing trick.
- `command -v pnpm` locates the pnpm script.
- `-lic`, both flags, because measurement showed neither alone yields both tools.

Baking paths in was rejected in the original design on the grounds that a
version-manager shim's target goes stale when the user switches Node versions. That
objection stands, and is accepted rather than solved: a stale plist is a visible
failure (the Engine settings show the engine unreachable) with a one-click fix
(remove, reinstall), which is the same mitigation already accepted for the engine
directory moving. An invisible hang was strictly worse.

`exec` is gone along with the shell: there is no wrapper process left for launchd to
supervise instead of the engine. `WorkingDirectory` replaces `cd '<dir>' &&`, which
removes the shell quoting question entirely.

The methodological lesson, which cost the most here: a wrapper was twice "verified" by
running it from an interactive terminal that already had a working `PATH`. That is not
the environment launchd uses. Reproducing with a deliberately minimal `PATH`, and then
under launchd itself, is what actually distinguished the three failures.

### `KeepAlive` is blanket `true`

**Reversed during implementation, after measuring it.** The original decision was a
dictionary with `SuccessfulExit: false`, to recover a crash while respecting a
deliberate shutdown. Under launchd it restarted nothing at all: killing the engine left
it dead, with `last exit code = 0` and `runs = 1`.

The reason is that the supervised process is `pnpm`, which traps `SIGTERM` and exits 0.
Every death of the engine arrives through that wrapper, so the exit status this key
depends on is never anything but 0, and the difference between a crash and a clean
shutdown is not observable from where launchd sits. A conditional key that can only ever
see one value is worse than no supervision, because it looks like supervision.

With blanket `KeepAlive`, verified under launchd: killing the engine brings it back
within seconds, `runs` goes to 2, the pid changes and the engine answers again.

The original objection, that blanket `KeepAlive` races against removal, does not hold.
`remove()` calls `launchctl bootout`, which removes the job from the domain rather than
asking it to stop, and a job launchd no longer knows cannot be restarted. Verified the
same way: after a bootout the engine is gone, no process remains, and the job is no
longer known.

The remaining trade-off is unchanged: a persistent failure to bind the port becomes a
restart loop rather than a single failure. The install-time port check is still what
prevents that, and it was equally necessary under the conditional form, since an
`EADDRINUSE` crash exits non-zero.

### Starting depends on whether launchd knows the job, not on the plist existing

`start()` bootstraps when the job is not loaded and kickstarts when it is.

**Added during implementation**, after two bugs in a row. First, the banner's Start
button called `install()`, which runs `bootstrap` on a label launchd already knows and is
refused. Then, after the agent was booted out to stop a crash loop, the plist was still
on disk while the job was gone, so kickstarting failed with "Could not find service".

Both came from the same wrong assumption, that a plist on disk means launchd knows the
job. It does not: `bootout` unloads the job and leaves the file. `isAgentLoaded()`, which
reads the exit status of `launchctl print`, is what makes the distinction explicit.

### Refuse to install while the port is taken

Installing checks whether anything is listening on 4173 first, and refuses if so.

This is not politeness. `KeepAlive` plus a port that cannot be bound is an infinite restart loop: launchd starts the engine, it dies on `EADDRINUSE`, launchd starts it again, and the log fills up. Refusing up front converts an invisible loop into one sentence the user can act on.

### Reachability by transport failure on a request the app already makes

The app judges the engine down when a request fails at the transport layer, which `APIError.transportFailed` already distinguishes from every server-side error. A dedicated health endpoint was considered and rejected: it would have to be unauthenticated to be worth anything, and this change has no appetite for a second unauthenticated route after the OAuth callback.

Polling every 30 seconds while a window is open is enough to satisfy the spec's one-minute bound without being chatty.

### The engine directory lives in `UserDefaults`, and is validated

A path is not a secret, so the Keychain is the wrong home; `UserDefaults` is the standard one. The directory is validated by looking for the engine's `package.json`, which is what makes "this folder does not look like the engine" a real check rather than a guess.

### One observable type owns engine state

A single `@Observable` type holds the reachability state, the chosen directory, and whether an agent is installed, and performs install and remove. The Settings sheet and the banner both read it, so they cannot disagree about whether the engine is up.

## Risks / Trade-offs

- **A stale plist after the checkout moves.** The embedded directory becomes wrong and every launch attempt fails. → The Engine settings validate the directory and say so, and removing then reinstalling fixes it. Not worth watching the filesystem for.
- **`launchctl` subcommand differences across macOS versions.** `bootstrap`/`bootout` replaced `load`/`unload`, and the older forms still work but warn. → Use `bootstrap`/`bootout` against the user's GUI domain, and treat a non-zero exit as a failure to report rather than to swallow.
- **The engine's log grows unbounded.** stdout and stderr go to a file with no rotation. → Acceptable: the engine's output is a handful of lines per poll. Worth revisiting only if it becomes a problem.
- **The user could end up with both a managed engine and a hand-started one** on different occasions. → The port check refuses the overlap at install time, and the Engine settings always show the live reachability, so the state is visible rather than guessed.
- **Reachability polling could mask a slow engine as a dead one** if a request times out under load. → Only a transport-level failure counts, not a slow success, and the notice clears itself as soon as a request succeeds.

## Migration Plan

Nothing to migrate. The change is additive: with no agent installed the app behaves as it does today, except that an unreachable engine now says so.

Rollback: removing the agent from Settings, or deleting the plist and running `launchctl bootout`, returns the machine to its current state. Reverting the app code leaves an installed agent running, which is harmless and still useful.

## Open Questions

None.
