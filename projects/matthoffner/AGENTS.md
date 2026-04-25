<!-- PIXELBOX_CONTEXT_START -->
# Pixelbox Project Context

This project is being edited and run inside Pixelbox.

## Working Rules
- Keep the main app visually clean and full-bleed where possible.
- Prefer deterministic local dev servers and print the live URL on its own line when ready.
- Use localhost/127.0.0.1 URLs that can be embedded in an Electron webview.
- Avoid interactive shell prompts in automation flows; prefer explicit non-interactive commands.
- If adding scripts, ensure `npm run dev` works without extra manual steps.

## Fast Output Contract
- After completing a task, summarize changed files and exact run commands.
- If a server is started, include the exact URL and port in plain text.

## Dual-Agent Coordination
- Agent lane A (editor): code changes, refactors, UI updates.
- Agent lane B (runtime): start/stop servers, logs, runtime health.
- Write concise handoffs to `.pixelbox/handoff.md` so both lanes stay synced.
- Before acting, read latest handoff entry to avoid stepping on active work.
<!-- PIXELBOX_CONTEXT_END -->
