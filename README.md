# Workbench

A native macOS window with every open pull request that is assigned to you or waiting on your review. Filter the list by repo in the sidebar.

Hover a repo in the sidebar and press Hide to leave its pull requests out of the list and the widget. The Hidden group at the bottom of the sidebar lists the hidden repos. Click one to show it again.

Open a pull request and press Review with Claude. Claude reads the diff and writes remarks in Dutch, each on a file and line. Press Post on a remark to put it on the pull request as an inline comment under your name. Nothing goes to GitHub without that press.

On your own pull request, press Fix on a remark. Claude changes the code in a temporary worktree of your clone under `~/Documents/Projecten`, and the app commits and pushes it to the branch, without force and without hooks. Fix first opens a box where you can give Claude extra context, like which option to pick. That context is not posted. A posted remark gets a reply under it that says how it was fixed, or why no change was needed. Pull in your clone before you push from there again.

When you open a pull request, its inline comments on GitHub load with their replies, so the remarks you posted are back after a restart. The list marks the pull requests you commented on.

Built with [GPUIX](https://gpuix.dev): React and TypeScript on Bun, drawn on the GPU by [GPUI](https://gpui.rs).

Other programs can steer Workbench. `bun src/app.tsx --pr <url>` opens that pull request, and `--review` also starts a review. When Workbench already runs, the order goes to that window instead of a new one. `bun src/cli.ts prs` prints your open pull requests as JSON.

## Widget

`widget/` holds a small Swift app: a floating circle with the number of your open pull requests, at the notch or on the right edge of the screen. A click opens a list of them, and a click on a pull request opens it in Workbench. Drag the circle to any edge of any screen: it snaps to the nearest edge and stays there. Right-click it for the notch or right edge spot, to refresh the list, or to quit.

```bash
cd widget
swift build -c release
.build/release/WorkbenchWidget
```

It runs Workbench from `~/Documents/Projecten/workbench`. Use another folder with `-workbenchFolder <path>`, or save one with `defaults write WorkbenchWidget workbenchFolder <path>`.

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

The app asks `gh` for your pull requests when it opens and when you press Refresh. It keeps no token and no database. The repos you hide are saved in `~/.config/workbench/hidden-repos.json`.

## Check

```bash
bun run typecheck
bun run test
```

`bun run test` also drives the window on the GPUIX test renderer and writes `screenshots/pr-list.png`.
