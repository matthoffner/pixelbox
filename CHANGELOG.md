# Changelog

## Unreleased - 2026-07-11

- Added a live run proof receipt over the preview with project, command, URL, touched files, copy-to-clipboard, and persisted proof metadata for quick-start generated runtimes.
- Added a Live Check action that probes the preview URL, captures HTTP status, latency, and page title/heading, and carries that evidence into Ship Briefs.
- Added an in-app Proof Ledger that records recent Live Checks and Ship Briefs, persists them in preview config, and copies a shareable evidence trail.
- Added a one-click Ship Brief action that copies an agent-ready continuation prompt and writes the current live proof into `.pixelbox/handoff.md`.
- Added File Peek for proof receipt files so generated/touched files can be inspected and copied without leaving Pixelbox.
- Improved narrow-screen preview flow so fresh mobile sessions and successful preview launches keep quick actions and proof controls reachable.
- Scoped `npm test` to Pixelbox-owned test files so ignored local `projects/` workspaces no longer break the product test suite.

## 0.3.0 - 2026-04-26

- Added an in-app agent monitor panel for active Codex sessions plus backend process/transcript inspection hooks.
- Added hidden-project management with restore controls and cleaner per-project action menus.
- Improved local preview orchestration with automatic localhost port reassignment and injected `PORT` environment variables for server runtimes.
- Expanded the Pixelbox landing experience into an ambient dashboard surface in `generated/landing.html`.
- Added repo docs for product direction in `vision.md` and revenue-cadence notes under `docs/hoffner-systems/`.

## 0.2.0 - 2026-04-25

- Added an AI Launch panel with startup presets for Codex, Claude, Gemini, Hermes, OpenClaw TUI, and plain terminal mode.
- Added native app runtime support with run/capture/image fields so Pixelbox can manage non-web previews.
- Added project switching shortcuts via `Cmd/Ctrl+Shift+ArrowLeft` and `Cmd/Ctrl+Shift+ArrowRight`.
- Added terminal drag-and-drop for file paths plus improved float resizing with edge and corner handles.
- Added preview IPC helpers for resolving local files and running capture commands from the renderer.
