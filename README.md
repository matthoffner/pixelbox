# pixelbox

`pixelbox` is an Electron workspace shell for agentic software work:
- Floating terminal/chat panel
- Project switcher with in-app preview frame
- Persistent terminal/Codex session per project
- Back/forward/reload navigation per project session
- Integrated shell terminal via `node-pty` with stdio fallback + `xterm`

## Run

```bash
npm install
npm start
```

## Tests

```bash
# Node terminal tests (includes codex terminal e2e when enabled)
npm test
npm run test:codex

# Playwright-style Electron UI tests
npm run test:pw
npm run test:pw:run
npm run test:pw:codex
```

## Architecture

- `main.js`: Electron main process, filesystem IPC, terminal process lifecycle.
- `preload.js`: safe API bridge from renderer to main.
- `renderer/`: floating chat terminal UI and xterm wiring.
- `lib/terminalSession.js`: PTY backend with automatic stdio fallback for headless environments.

## Notes

- `node-pty` launches your system shell in the workspace root when available.
- In constrained/headless environments, the app falls back to non-PTY stdio shell execution.
