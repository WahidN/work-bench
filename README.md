# Workbench

A native macOS window with every open pull request that is assigned to you or waiting on your review. Filter the list by repo in the sidebar.

Open a pull request and press Review with Claude. Claude reads the diff and writes remarks in Dutch, each on a file and line. Press Post on a remark to put it on the pull request as an inline comment under your name. Nothing goes to GitHub without that press.

On your own pull request, press Fix on a remark. Claude changes the code in a temporary worktree of your clone under `~/Documents/Projecten`, and the app commits and pushes it to the branch, without force and without hooks. A posted remark gets a reply under it that says how it was fixed. Pull in your clone before you push from there again.

When you open a pull request, its inline comments on GitHub load with their replies, so the remarks you posted are back after a restart. The list marks the pull requests you commented on.

Built with [GPUIX](https://gpuix.dev): React and TypeScript on Bun, drawn on the GPU by [GPUI](https://gpui.rs).

## Requirements

- macOS on Apple Silicon
- [Bun](https://bun.sh)
- The GitHub CLI, logged in (`gh auth status`)
- Claude Code, logged in (`claude`), for the review

## Run

```bash
bun install
bun run dev
```

The app asks `gh` for your pull requests when it opens and when you press Refresh. It keeps no token and no database.

## Check

```bash
bun run typecheck
bun run test
```

`bun run test` also drives the window on the GPUIX test renderer and writes `screenshots/pr-list.png`.
