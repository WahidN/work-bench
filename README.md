# Workbench

A native macOS window with every open pull request that is assigned to you or waiting on your review. Filter the list by repo in the sidebar.

Built with [GPUIX](https://gpuix.dev): React and TypeScript on Bun, drawn on the GPU by [GPUI](https://gpui.rs).

## Requirements

- macOS on Apple Silicon
- [Bun](https://bun.sh)
- The GitHub CLI, logged in (`gh auth status`)

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
