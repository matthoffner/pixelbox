# Dev Server Watchdog — Design

## Problem

Running Page's "Server command" mode (`lib/previewRuntimeManager.js`) spawns
the configured command as a raw `child_process`, scans its stdout/stderr for
a `localhost` URL, and throws the rest of the output away. When the command
fails (e.g. dependencies were never installed), the user gets a static
"Server stopped" label in Settings with no indication of why. There is also
no way to intervene — the process is a black box.

## Goal

Turn "Server command" mode into an AI-agent-managed process: instead of
Node spawning the command directly, a dedicated terminal session runs the
project's already-configured AI CLI (Claude/Codex/etc — whatever the
project's AI Launch panel already has selected), briefed to run the command,
diagnose failures, fix them, and keep the server alive. The user gets a
small embedded terminal in Settings to watch it work and type into it if
needed.

This fully replaces direct-spawn for `sourceType: 'server'`. `native` and
`html` modes are unaffected.

## Non-goals (v1)

- Auto-restarting the watchdog agent itself if the agent process exits/
  crashes. If the agent quits, Running Page shows "stopped" same as today;
  the user clicks Start again. (The dev server that the *agent* manages is
  still restarted by the agent per its instructions — this only concerns
  the outer agent process dying.)
- Full ANSI/cursor terminal emulation in the mini terminal. It reuses the
  existing plain-scrolling-text pattern already used by `#terminal`
  (`renderer/app.js`), not a full xterm.js-style emulator.
- Changing how the main AI Launch terminal / native Ghostty terminal work.
  This is a second, independent, small terminal session.

## Architecture

```
Running Page (Settings)
  "Server command" mode
        │ save/start
        ▼
DevServerWatchdog (new, lib/devServerWatchdog.js)
        │ builds prompt, calls
        ▼
TerminalManager (existing, lib/terminalManager.js — already multi-key)
        │ start(key = "watchdog:<projectPath>", { shell, argv })
        ▼
TerminalSession (existing, lib/terminalSession.js — PTY, env-scrubbed)
        │ runs: claude "You are supervising this project's dev
        │        server. Run: npm run dev. If it fails, diagnose
        │        (missing deps, port conflicts, etc.), fix, and
        │        retry. Keep it running; restart on crash."
        ▼
   Agent's own shell runs the actual `npm run dev` (or whatever
   command is configured) as a normal foreground/background job,
   using its own judgment to fix and restart it.
```

Output from this PTY flows through the *existing* `terminal:data` /
`terminal:exit` SSE events (already keyed — `TerminalManager` sends
`{ key, data }`), so no new transport is needed. `DevServerWatchdog` taps
that same data stream server-side to:
- extract a `localhost` URL (reusing `extractUrls()` already exported from
  `previewRuntimeManager.js`) and
- keep a capped rolling text buffer (last ~300 lines) so the mini terminal
  can show backlog immediately when Settings is reopened, not just live
  output from the moment it's opened.

It then emits the existing `preview:status` event shape (`running`, `url`,
`sourceType: 'server'`, `command`) so Running Page's current status
rendering (`renderRuntimeStatus`) needs no changes — from its perspective,
nothing about how it's told "server is up" is different, only what's
actually running underneath changed.

## Components

### 1. `buildWatchdogStartupCommand(options)` — pure function

New, in `lib/devServerWatchdog.js`. Takes:
```js
{ aiCli, cwd, serverCommand, codexDangerouslyBypassPermissions }
```
Reuses the existing per-CLI `definitions` map currently inlined in
`getStartupTerminalCommand` (`bridge/server.js`) — that map is extracted
into a small shared helper (`lib/aiLauncherDefinitions.js`) so both the
existing AI Launch bootstrap and this watchdog builder use one source of
truth for "how do I invoke CLI X non-interactively-primed."

Returns a full shell command string, e.g.:
```
env TERM=xterm-256color claude --dangerously-skip-permissions "You are supervising this project's dev server. Run: npm run dev. If it fails, diagnose (missing dependencies, port conflicts, missing env vars, etc.) and fix them, then retry. Once it's running, keep monitoring it — restart it if it crashes, diagnosing any new failure first. Work autonomously; only stop and ask if you're blocked on something only the user can provide (e.g. credentials)."
```
`serverCommand` is shell-escaped and interpolated into the prompt so the
agent knows the exact command to run (it's the same string already
configured in the "Server command" field today).

Pure and unit-testable in isolation — no process spawning, no I/O.

### 2. `DevServerWatchdog` class — in `lib/devServerWatchdog.js`

Constructor takes `{ terminalManager, sendStatus }` (the same
`terminalManager` instance `bridge/server.js` already owns).

- `start(key, options)` — calls `buildWatchdogStartupCommand`, then
  `terminalManager.start(watchdogKey(key), { shell, argv, cwd })`. Taps that
  session's output by subscribing to `bridge/server.js`'s existing internal
  `events` `EventEmitter` for `'terminal:data'` (the same event `emit()`
  already broadcasts to SSE clients), filtering for
  `payload.key === watchdogKey(key)` — no `TerminalManager` changes needed.
  Maintains `{ url, logBuffer }` per key.
- `stop(key)` — `terminalManager.kill(watchdogKey(key))`.
- `getLog(key)` — returns the buffered text for initial-load fetch.
- `watchdogKey(key)` → `` `watchdog:${key}` `` — namespacing so it can't
  collide with the main per-project terminal key.

### 3. `bridge/server.js` wiring

`/api/preview/syncRuntime` and `/api/preview/startRuntime`: when
`options.sourceType === 'server'`, delegate to `devServerWatchdog.start(...)`
instead of `previewRuntimeManager.start(...)`. `/api/preview/stopRuntime`
delegates to `devServerWatchdog.stop(...)` for the same condition.
`previewRuntimeManager` keeps owning `native` mode only; its `server`-mode
branch in `start()`/`syncProject()` is deleted (dead code removal, not a
parallel path).

New endpoint: `/api/preview/getLog` (`{ projectPath }` → `{ log }`) for
the mini terminal's initial backlog fetch, backed by
`devServerWatchdog.getLog(key)`.

Input to the watchdog terminal is just `terminalManager.write(text, key)` —
already exists, already generic.

### 4. Renderer — Running Page panel

`renderer/index.html`: inside `#running-page-panel`, when source type is
`server`, render a mini terminal block below the existing fields — a
scrollable `<pre id="running-page-log">` (styled like `#terminal`: same
monospace font stack, dark background) plus a single-line
`<input id="running-page-log-input">` + send button.

`renderer/app.js`:
- On panel render for a `server`-type project, fetch backlog via
  `window.api.getPreviewLog(projectPath)` and populate the box.
- Subscribe to `terminal:data`/`terminal:exit` (via `window.api.on`, the
  same mechanism already used for `preview:status` elsewhere), filter by
  `payload.key === watchdogKeyFor(projectPath)`, append stripped text,
  auto-scroll to bottom, cap displayed length client-side too (same ~300
  line cap, oldest lines dropped).
- Wire the input+send button to `window.api.writeTerminal(text + '\n', key)`.
- Start/Stop buttons unchanged in *what* they call
  (`syncPreviewRuntime`/`startPreviewRuntime`/`stopPreviewRuntime`) — only
  the backend behind those calls changes.

## Data flow (happy path)

1. User sets Server command to `npm run dev`, AI CLI already set to Claude
   in the AI Launch panel, clicks Start.
2. `startRuntime` → `DevServerWatchdog.start()` → builds the prompt →
   `TerminalManager.start('watchdog:<path>', ...)` → PTY launches
   `claude --dangerously-skip-permissions "<prompt>"`.
3. Claude reads the brief, runs `npm run dev` in its shell. Suppose it
   fails with `Cannot find module 'express'`. Claude sees this in its own
   terminal output, runs `npm install`, retries `npm run dev`, sees it
   succeed and print `Local: http://localhost:5173`.
4. That PTY output streams through existing SSE (`terminal:data`,
   key-tagged) to the mini terminal in Settings — user watches the whole
   diagnose-and-fix happen in real time.
5. `DevServerWatchdog`'s tap on the same stream extracts
   `http://localhost:5173` via `extractUrls()`, emits `preview:status` with
   `running: true, url: ...` — Running Page's existing status line and any
   preview-URL consumers update exactly as they do today.
6. If the user wants to redirect the agent ("actually use port 4000"),
   they type into the mini terminal's input box — goes straight to the
   agent's stdin via `writeTerminal`.

## Error handling

- Selected AI CLI binary not installed: `buildWatchdogStartupCommand`
  reuses the same `missing` messaging already defined per-CLI; the shell
  command echoes that message instead of exec'ing a missing binary
  (mirrors the existing `command -v ... || echo ...` guard pattern already
  used in `getStartupTerminalCommand`'s launcher construction).
- Agent process exits (crashes or user-quit): `terminal:exit` fires for
  the watchdog key → `DevServerWatchdog` emits `preview:status` with
  `running: false` → Running Page shows "Server stopped." No auto-restart
  (see Non-goals).
- Dev server itself crashing/failing is *not* handled by Pixelbox code at
  all in this design — that's the agent's job per its brief. This is the
  entire point of the feature.

## Testing

- Unit test `buildWatchdogStartupCommand` for each CLI in the definitions
  map: asserts exact shell string, correct quoting/escaping when
  `serverCommand` contains special characters (quotes, `&&`, etc).
- Unit test `DevServerWatchdog.start/stop/getLog` against a fake
  `terminalManager` (no real PTY) — verifies key namespacing, log
  buffering/capping, and `preview:status` payload shape.
- Extend the existing e2e pattern (`test/terminal.codex.e2e.test.js`
  already exercises a real CLI in a PTY) with a watchdog-specific e2e that
  runs a deliberately-broken npm project and asserts the agent's output
  eventually contains evidence of running `npm install` and the server
  coming up — gated the same way the existing e2e is (env-var-gated, not
  run by default in `npm test`).

## Migration

No persisted config schema change is required — `sourceType: 'server'`
already exists in the Running Page config; only what happens *behind* that
mode changes. Existing saved "Server command" values keep working as the
prompt's embedded command.
