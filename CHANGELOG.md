# Changelog

## Unreleased - 2026-07-11

- Added a live run proof receipt over the preview with project, command, URL, touched files, copy-to-clipboard, and persisted proof metadata for quick-start generated runtimes.
- Added a Live Check action that probes the preview URL, captures HTTP status, latency, and page title/heading, and carries that evidence into Ship Briefs.
- Added an in-app Proof Ledger that records recent Live Checks and Ship Briefs, persists them in preview config, and copies a shareable evidence trail.
- Added Proof Snapshot capture so the proof receipt can save a live preview PNG into `.pixelbox/proof-snapshots/`, view it in-app, and record it in the ledger.
- Added Snapshot Compare for reviewing the latest proof snapshot beside the previous snapshot directly inside Pixelbox.
- Added a one-click Ship Brief action that copies an agent-ready continuation prompt and writes the current live proof into `.pixelbox/handoff.md`.
- Added File Peek for proof receipt files so generated/touched files can be inspected and copied without leaving Pixelbox.
- Added Runtime Output for proof receipts so managed server stdout/stderr can be inspected and copied from inside Pixelbox.
- Added Runtime Output tails to copied proof text, Ship Briefs, and handoff updates so failed runs carry their diagnostic text to the next agent.
- Added automatic Live Checks after managed server previews start so proof receipts gain HTTP/title evidence without a manual click.
- Added a Verify proof action that runs a Live Check and captures a proof snapshot in one click.
- Added Verified Run proof ledger events that bundle successful Verify HTTP evidence with the captured snapshot.
- Added Markdown Proof Packs that save the current proof, files, runtime tail, snapshot, and ledger into `.pixelbox/proof-packs/`.
- Added and deployed the landing page `0.4.6` release entry for proof receipts, Verified Runs, and Markdown Proof Packs.
- Improved Proof Ledger file chips so evidence files can be opened directly in File Peek from ledger rows.
- Improved automatic Live Check ledger behavior by deduping recent identical background checks.
- Fixed Proof Pack export paths so nested projects save packs inside their own `.pixelbox/proof-packs/` directory.
- Improved server runtime restarts so live projects show a Restart action, relaunch on the same managed port, reload the preview after code edits, and hide irrelevant source fields.
- Improved runtime failure visibility by showing managed server exit codes in the Running Page and proof receipt.
- Improved proof receipt status tones so healthy, waiting, and failed runtimes no longer share the same green indicator.
- Fixed hidden-state styling so first-load panels do not show dormant forms or controls before the user opens them.
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
