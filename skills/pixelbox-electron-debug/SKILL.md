---
name: pixelbox-electron-debug
description: Use this when working on Pixelbox UI/terminal issues that require live Electron behavior, interactive Playwright triage, dock/resize debugging, and screenshot+log based intervention loops.
---

# Pixelbox Electron Debug

Use this skill for Pixelbox debugging sessions where browser-only tooling is insufficient.

## When to use

- Terminal input/output is broken or flaky in the app.
- Dock/undock/resize layout regressions appear.
- Project switching, preview rendering, or webview behavior differs from static browser rendering.
- The user asks for frequent screenshots and proactive intervention while tests run.

## Execution modes

1. **True Electron (default for real bugs)**
- Use Playwright Electron scripts in `test/`.
- This mode can access preload APIs and `node-pty` terminal behavior.

2. **Playwright MCP browser (manual collaboration)**
- Use only for renderer-only manual walkthroughs.
- Treat `window.api`/terminal bridge failures as expected outside Electron.

## Fast start commands

- Launch app for manual use: `npm run dev`
- Standard electron suite: `npm run test:pw:run`
- One-pass side-dock smoke: `node test/pw_side_nav_smoke.js`
- Live debug cycle with screenshots every 10s: `npm run test:pw:live-cycle`

Optional tuning for live cycle:
- `PW_INTERVAL_MS=5000 PW_CYCLES=12 npm run test:pw:live-cycle`

## Required debug loop behavior

When running long tests:

1. Capture screenshot at least every 10 seconds.
2. Read latest terminal tail/state after each capture.
3. Intervene immediately when stalled:
- no terminal progress for >20s
- missing expected marker text
- preview/webview blank or masked
4. Report each intervention with:
- trigger condition
- action taken
- post-action result

## Assertions to keep

- Terminal input path works (`echo __MARKER__` appears in terminal output).
- Preview area keeps positive width/height after dock changes.
- Dock-right and dock-bottom can return to float mode.
- Controls remain visible at minimum terminal sizes.

## Artifacts

Write artifacts under `screenshots/` and keep trace JSON when possible.

- For live-cycle runs, use generated `trace.json` to summarize state transitions.
- Include exact file paths for screenshots in updates.

## MCP collaboration pattern

If the user wants to drive manually step-by-step:

1. Open/refresh the target page.
2. Take snapshot + screenshot.
3. Ask for one next action.
4. Execute one action.
5. Re-capture and summarize differences.

Do not batch many actions without re-checking visual output.
