# Dev Server Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Running Page's raw `child_process` spawn for "Server command" mode with an AI-agent-managed PTY session (Codex or Claude) that runs the command, diagnoses and fixes failures, and keeps it alive — surfaced via a mini embedded terminal in Settings.

**Architecture:** A new `lib/devServerWatchdog.js` builds a per-CLI shell launch command (extracted CLI definitions shared with the existing AI Launch bootstrap), starts it as a normal keyed session on the existing `TerminalManager`, taps its output for URL extraction and a rolling log buffer, and emits the same `preview:status` shape Running Page already consumes. `bridge/server.js` routes `sourceType: 'server'` requests to it instead of `PreviewRuntimeManager`. The renderer gets a small scrolling log view + input box wired to the existing keyed terminal write/read plumbing.

**Tech Stack:** Node.js (CommonJS, `node:test` for unit tests), vanilla JS/HTML/CSS renderer (no framework), existing `node-pty`-backed `TerminalSession`/`TerminalManager`.

**Spec:** `docs/superpowers/specs/2026-08-24-dev-server-watchdog-design.md` (Part 1 only — Part 2 has its own plan)

## Global Constraints

- Only `codex` and `claude` support the watchdog's autonomous mode — these are the only two CLIs with a "bypass approvals/skip permissions" flag in this codebase (`aiCliSupportsDangerousBypass` in `renderer/app.js:275-277` already encodes this). `gemini`/`hermes`/`openclaw`/`custom` are rejected for "Server command" mode with a clear error, not silently degraded.
- The watchdog always runs in autonomous/bypass mode regardless of the user's `codexDangerouslyBypassPermissions` toggle (that toggle only affects the interactive AI Launch panel) — full autonomy for the watchdog was an explicit design decision.
- `native` and `html` Running Page source types are untouched — this plan only changes `sourceType: 'server'`.
- No persisted config schema changes — existing saved "Server command" values keep working as-is.
- Follow existing code style: CommonJS (`require`/`module.exports`), 2-space indentation, no semicolon-omission changes, `node:test` + `node:assert/strict` for new unit tests (see `test/terminalManager.test.js` for the house style).

---

### Task 1: Extract shared AI CLI definitions

**Files:**
- Create: `lib/aiCliDefinitions.js`
- Test: `test/aiCliDefinitions.test.js`
- Modify: `bridge/server.js:59-111` (use the new module; behavior must stay byte-identical)

**Interfaces:**
- Produces: `buildAiCliDefinitions({ codexDangerouslyBypassPermissions })` → object keyed by `codex`/`claude`/`gemini`/`hermes`/`openclaw`, each `{ binary: string, missing: string, command: string }`. Later tasks (Task 3) import this same function.

- [ ] **Step 1: Write the failing test**

Create `test/aiCliDefinitions.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAiCliDefinitions } = require('../lib/aiCliDefinitions');

test('buildAiCliDefinitions returns entries for all five CLIs', () => {
  const definitions = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: false });
  assert.deepEqual(Object.keys(definitions).sort(), ['claude', 'codex', 'gemini', 'hermes', 'openclaw']);
});

test('codex/claude commands switch on codexDangerouslyBypassPermissions', () => {
  const safe = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: false });
  assert.equal(safe.codex.command, 'env TERM=xterm-256color codex resume --last || env TERM=xterm-256color codex');
  assert.equal(safe.claude.command, 'env TERM=xterm-256color claude --continue || env TERM=xterm-256color claude');

  const bypass = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: true });
  assert.equal(bypass.codex.command, 'env TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox');
  assert.equal(bypass.claude.command, 'env TERM=xterm-256color claude --dangerously-skip-permissions');
});

test('gemini/hermes/openclaw commands are fixed regardless of the bypass flag', () => {
  const definitions = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: true });
  assert.equal(definitions.gemini.command, 'env TERM=xterm-256color gemini');
  assert.equal(definitions.hermes.command, 'env TERM=xterm-256color hermes');
  assert.equal(definitions.openclaw.command, 'env TERM=xterm-256color openclaw tui');
  assert.equal(definitions.gemini.missing, 'Gemini CLI not found in PATH.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aiCliDefinitions.test.js`
Expected: FAIL with `Cannot find module '../lib/aiCliDefinitions'`

- [ ] **Step 3: Write the implementation**

Create `lib/aiCliDefinitions.js`:

```js
function buildAiCliDefinitions({ codexDangerouslyBypassPermissions } = {}) {
  return {
    codex: {
      binary: 'codex',
      missing: 'Codex CLI not found in PATH.',
      command: codexDangerouslyBypassPermissions
        ? 'env TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox'
        : 'env TERM=xterm-256color codex resume --last || env TERM=xterm-256color codex',
    },
    claude: {
      binary: 'claude',
      missing: 'Claude CLI not found in PATH.',
      command: codexDangerouslyBypassPermissions
        ? 'env TERM=xterm-256color claude --dangerously-skip-permissions'
        : 'env TERM=xterm-256color claude --continue || env TERM=xterm-256color claude',
    },
    gemini: {
      binary: 'gemini',
      missing: 'Gemini CLI not found in PATH.',
      command: 'env TERM=xterm-256color gemini',
    },
    hermes: {
      binary: 'hermes',
      missing: 'Hermes CLI not found in PATH.',
      command: 'env TERM=xterm-256color hermes',
    },
    openclaw: {
      binary: 'openclaw',
      missing: 'OpenClaw CLI not found in PATH.',
      command: 'env TERM=xterm-256color openclaw tui',
    },
  };
}

module.exports = {
  buildAiCliDefinitions,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aiCliDefinitions.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Rewire `bridge/server.js` to use the shared module without changing behavior**

In `bridge/server.js`, add near the top with the other `require`s (after line 13's `codexMonitor` require):

```js
const { buildAiCliDefinitions } = require('../lib/aiCliDefinitions');
```

Replace `bridge/server.js:59-111` (the whole `getStartupTerminalCommand` function body from the `definitions` object down) so it reads:

```js
function getStartupTerminalCommand(options = {}) {
  if (process.env.PXCODE_DISABLE_AUTO_TUI === '1') {
    return '';
  }

  const preferred = process.env.PXCODE_TUI_COMMAND;
  if (preferred && preferred.trim()) {
    return preferred.trim();
  }

  const launcher = ['codex', 'claude', 'gemini', 'hermes', 'openclaw', 'custom'].includes(options.aiCli)
    ? options.aiCli
    : 'codex';

  if (launcher === 'custom') {
    return '';
  }

  const definitions = buildAiCliDefinitions({
    codexDangerouslyBypassPermissions: options.codexDangerouslyBypassPermissions,
  });
  const active = definitions[launcher];
  return `clear; if command -v ${active.binary} >/dev/null 2>&1; then ${active.command}; else echo "${active.missing}"; fi`;
}
```

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS (all existing tests, including the new `aiCliDefinitions.test.js`)

- [ ] **Step 7: Commit**

```bash
git add lib/aiCliDefinitions.js test/aiCliDefinitions.test.js bridge/server.js
git commit -m "refactor: extract AI CLI definitions into a shared module"
```

---

### Task 2: `buildWatchdogStartupCommand` — pure command builder

**Files:**
- Create: `lib/devServerWatchdog.js` (this task only adds the pure function; the class comes in Task 3)
- Test: `test/devServerWatchdog.test.js`

**Interfaces:**
- Consumes: `buildAiCliDefinitions` from `lib/aiCliDefinitions.js` (Task 1).
- Produces: `buildWatchdogStartupCommand({ aiCli, serverCommand })` → `string` (a full shell command). Throws `Error` if `aiCli` is not `'codex'` or `'claude'`. Task 3's `DevServerWatchdog` class imports this same function.

- [ ] **Step 1: Write the failing test**

Create `test/devServerWatchdog.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWatchdogStartupCommand } = require('../lib/devServerWatchdog');

test('buildWatchdogStartupCommand builds a claude launch command with the brief embedded', () => {
  const result = buildWatchdogStartupCommand({ aiCli: 'claude', serverCommand: 'npm run dev' });
  assert.match(result, /^clear; if command -v claude >\/dev\/null 2>&1; then env TERM=xterm-256color claude --dangerously-skip-permissions '/);
  assert.match(result, /npm run dev/);
  assert.match(result, /else echo "Claude CLI not found in PATH\."; fi$/);
});

test('buildWatchdogStartupCommand builds a codex launch command with the brief embedded', () => {
  const result = buildWatchdogStartupCommand({ aiCli: 'codex', serverCommand: 'npm run dev' });
  assert.match(result, /^clear; if command -v codex >\/dev\/null 2>&1; then env TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox '/);
  assert.match(result, /npm run dev/);
  assert.match(result, /else echo "Codex CLI not found in PATH\."; fi$/);
});

test('buildWatchdogStartupCommand single-quote-escapes a server command containing a single quote', () => {
  const result = buildWatchdogStartupCommand({ aiCli: 'claude', serverCommand: "npm run dev -- --name 'x'" });
  // The brief is wrapped in single quotes; any single quote inside the
  // interpolated serverCommand must be escaped as '\'' so the shell sees
  // one continuous argument.
  assert.ok(result.includes(`--name '\\''x'\\''`));
});

test('buildWatchdogStartupCommand rejects unsupported CLIs', () => {
  assert.throws(() => buildWatchdogStartupCommand({ aiCli: 'gemini', serverCommand: 'npm run dev' }), /only codex and claude/i);
  assert.throws(() => buildWatchdogStartupCommand({ aiCli: 'custom', serverCommand: 'npm run dev' }), /only codex and claude/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/devServerWatchdog.test.js`
Expected: FAIL with `Cannot find module '../lib/devServerWatchdog'`

- [ ] **Step 3: Write the implementation**

Create `lib/devServerWatchdog.js`:

```js
const { buildAiCliDefinitions } = require('./aiCliDefinitions');

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildWatchdogPrompt(serverCommand) {
  return (
    `You are supervising this project's dev server. Run: ${serverCommand}. ` +
    'If it fails, diagnose the cause (missing dependencies, port conflicts, ' +
    'missing env vars, etc.), fix it, and retry. Once it is running, keep ' +
    'monitoring it — restart it if it crashes, diagnosing any new failure ' +
    'first. Work autonomously; only stop and ask if you are blocked on ' +
    'something only the user can provide (e.g. credentials).'
  );
}

function buildWatchdogStartupCommand({ aiCli, serverCommand }) {
  if (aiCli !== 'codex' && aiCli !== 'claude') {
    throw new Error('Dev server watchdog supports only codex and claude.');
  }

  const definitions = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: true });
  const active = definitions[aiCli];
  const prompt = buildWatchdogPrompt(serverCommand);
  const quotedPrompt = shellSingleQuote(prompt);

  return `clear; if command -v ${active.binary} >/dev/null 2>&1; then ${active.command} ${quotedPrompt}; else echo "${active.missing}"; fi`;
}

module.exports = {
  buildWatchdogStartupCommand,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/devServerWatchdog.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/devServerWatchdog.js test/devServerWatchdog.test.js
git commit -m "feat: add pure watchdog startup command builder"
```

---

### Task 3: `DevServerWatchdog` class — lifecycle, log buffer, URL extraction

**Files:**
- Modify: `lib/devServerWatchdog.js` (add the class alongside the Task 2 function)
- Test: `test/devServerWatchdog.test.js` (add to the same file)

**Interfaces:**
- Consumes: `buildWatchdogStartupCommand` (Task 2, same file); a `terminalManager`-shaped object with `start(key, options)`, `write(data, key)`, `kill(key)` (matches `lib/terminalManager.js`'s real `TerminalManager`, `lib/terminalManager.js:1`); an `events`-shaped `EventEmitter` with `.on(name, handler)`/`.off(name, handler)` (matches Node's `EventEmitter`, used the same way `bridge/server.js`'s module-level `events` already is); `extractUrls` from `lib/previewRuntimeManager.js:281` (already exported).
- Produces: `class DevServerWatchdog` with:
  - `constructor({ terminalManager, events, sendStatus })`
  - `start(key, { cwd, aiCli, serverCommand }) → { ok: true, running: true }` (throws if `aiCli` unsupported, matching Task 2's `buildWatchdogStartupCommand`)
  - `stop(key) → void`
  - `getLog(key) → string`

  Task 4 (`bridge/server.js` wiring) constructs one instance of this class and calls exactly these three methods.

- [ ] **Step 1: Write the failing tests**

Append to `test/devServerWatchdog.test.js`:

```js
const { DevServerWatchdog } = require('../lib/devServerWatchdog');
const { EventEmitter } = require('node:events');

function createFakeTerminalManager() {
  return {
    startCalls: [],
    writeCalls: [],
    killCalls: [],
    start(key, options) {
      this.startCalls.push({ key, options });
      return { ok: true, created: true, hasPseudoTTY: true };
    },
    write(data, key) {
      this.writeCalls.push({ data, key });
    },
    kill(key) {
      this.killCalls.push(key);
    },
  };
}

test('DevServerWatchdog.start namespaces the terminal key and emits running status', () => {
  const terminalManager = createFakeTerminalManager();
  const events = new EventEmitter();
  const statuses = [];
  const watchdog = new DevServerWatchdog({
    terminalManager,
    events,
    sendStatus(payload) {
      statuses.push(payload);
    },
  });

  const result = watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });

  assert.equal(result.ok, true);
  assert.equal(result.running, true);
  assert.equal(terminalManager.startCalls.length, 1);
  assert.equal(terminalManager.startCalls[0].key, 'watchdog:project-a');
  assert.equal(terminalManager.startCalls[0].options.cwd, 'project-a');
  assert.match(terminalManager.startCalls[0].options.startupCommand, /claude --dangerously-skip-permissions/);
  assert.deepEqual(statuses, [
    { key: 'project-a', running: true, sourceType: 'server', command: 'npm run dev', url: '' },
  ]);
});

test('DevServerWatchdog extracts a URL from terminal output and buffers log lines', () => {
  const terminalManager = createFakeTerminalManager();
  const events = new EventEmitter();
  const statuses = [];
  const watchdog = new DevServerWatchdog({
    terminalManager,
    events,
    sendStatus(payload) {
      statuses.push(payload);
    },
  });

  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  events.emit('terminal:data', { key: 'watchdog:project-a', data: 'Local: http://localhost:5173\n' });
  events.emit('terminal:data', { key: 'some-other-key', data: 'ignored\n' });

  const last = statuses[statuses.length - 1];
  assert.equal(last.url, 'http://localhost:5173');
  assert.equal(last.running, true);
  assert.equal(watchdog.getLog('project-a'), 'Local: http://localhost:5173\n');
});

test('DevServerWatchdog.stop kills the namespaced terminal key', () => {
  const terminalManager = createFakeTerminalManager();
  const events = new EventEmitter();
  const watchdog = new DevServerWatchdog({
    terminalManager,
    events,
    sendStatus() {},
  });

  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  watchdog.stop('project-a');

  assert.deepEqual(terminalManager.killCalls, ['watchdog:project-a']);
});

test('DevServerWatchdog caps the log buffer to the last 300 lines', () => {
  const terminalManager = createFakeTerminalManager();
  const events = new EventEmitter();
  const watchdog = new DevServerWatchdog({
    terminalManager,
    events,
    sendStatus() {},
  });

  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  for (let i = 0; i < 400; i += 1) {
    events.emit('terminal:data', { key: 'watchdog:project-a', data: `line-${i}\n` });
  }

  const lines = watchdog.getLog('project-a').split('\n').filter(Boolean);
  assert.equal(lines.length, 300);
  assert.equal(lines[0], 'line-100');
  assert.equal(lines[299], 'line-399');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/devServerWatchdog.test.js`
Expected: FAIL with `DevServerWatchdog is not a constructor` (or "not exported")

- [ ] **Step 3: Write the implementation**

Append to `lib/devServerWatchdog.js` (after the existing `buildWatchdogStartupCommand` export, replace the final `module.exports` block):

```js
const { spawn } = require('node:child_process');
const { extractUrls } = require('./previewRuntimeManager');

const LOG_LINE_CAP = 300;

function watchdogKey(key) {
  return `watchdog:${key}`;
}

class DevServerWatchdog {
  constructor({ terminalManager, events, sendStatus }) {
    this.terminalManager = terminalManager;
    this.events = events;
    this.sendStatus = sendStatus;
    this.runtimes = new Map();
    this._onTerminalData = this._onTerminalData.bind(this);
    this.events.on('terminal:data', this._onTerminalData);
  }

  start(key, { cwd, aiCli, serverCommand }) {
    const startupCommand = buildWatchdogStartupCommand({ aiCli, serverCommand });
    this.runtimes.set(key, { command: serverCommand, url: '', logLines: [] });

    // NOTE: bridge/server.js's real terminalManager's createSession callback
    // (bridge/server.js:113-120) destructures `{ cwd, startupCommand }` — a
    // shell command *string* — and builds argv itself via
    // terminalSpawnArgs(shell, startupCommand). It does NOT accept an argv
    // array directly. Passing `{ cwd, argv: [...] }` here would silently
    // launch a bare interactive shell with the startup command dropped.
    this.terminalManager.start(watchdogKey(key), {
      cwd,
      startupCommand,
    });

    this.#emitStatus(key, { running: true, url: '' });
    return { ok: true, running: true };
  }

  stop(key) {
    this.terminalManager.kill(watchdogKey(key));
    this.runtimes.delete(key);
    this.#emitStatus(key, { running: false, url: '' });
  }

  getLog(key) {
    const runtime = this.runtimes.get(key);
    return runtime ? runtime.logLines.join('\n') : '';
  }

  _onTerminalData({ key: terminalKey, data }) {
    const key = this.#keyForTerminalKey(terminalKey);
    if (!key) return;
    const runtime = this.runtimes.get(key);
    if (!runtime) return;

    const lines = String(data).split(/\r?\n/).filter((line) => line.length > 0);
    runtime.logLines.push(...lines);
    if (runtime.logLines.length > LOG_LINE_CAP) {
      runtime.logLines = runtime.logLines.slice(runtime.logLines.length - LOG_LINE_CAP);
    }

    const urls = extractUrls(data);
    if (urls.length > 0) {
      runtime.url = urls[urls.length - 1];
    }

    this.#emitStatus(key, { running: true, url: runtime.url });
  }

  #keyForTerminalKey(terminalKey) {
    const prefix = 'watchdog:';
    if (!terminalKey || !terminalKey.startsWith(prefix)) return null;
    const key = terminalKey.slice(prefix.length);
    return this.runtimes.has(key) ? key : null;
  }

  #emitStatus(key, { running, url }) {
    const runtime = this.runtimes.get(key);
    this.sendStatus({
      key,
      running,
      sourceType: 'server',
      command: runtime ? runtime.command : '',
      url,
    });
  }
}

module.exports = {
  buildWatchdogStartupCommand,
  DevServerWatchdog,
};
```

Note: `spawn` is imported but unused by this class (the actual process is owned by `TerminalManager`/`TerminalSession`, not spawned here directly) — remove that `require('node:child_process')` line, it was left over from drafting. The final file must not import `child_process` at all in `lib/devServerWatchdog.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/devServerWatchdog.test.js`
Expected: PASS (8 tests total — 4 from Task 2, 4 new)

- [ ] **Step 5: Commit**

```bash
git add lib/devServerWatchdog.js test/devServerWatchdog.test.js
git commit -m "feat: add DevServerWatchdog lifecycle, log buffer, URL extraction"
```

---

### Task 4: Wire `bridge/server.js` — route "server" mode through the watchdog

**Files:**
- Modify: `bridge/server.js:1-13` (imports), `bridge/server.js:130-135` (manager instantiation), `bridge/server.js:357-385` (preview endpoints)
- Modify: `lib/previewRuntimeManager.js:61-87` (remove now-dead `server`-mode branches)
- Test: `test/previewRuntimeManager.test.js` (remove/adjust any test that exercises `server`-mode `start`/`syncProject` on `PreviewRuntimeManager` directly, since that mode moves out of this class — see Step 5)

**Interfaces:**
- Consumes: `DevServerWatchdog` (Task 3), `events` (existing module-level `EventEmitter` in `bridge/server.js:18`), `terminalManager` (existing instance, `bridge/server.js:113-128`).

- [ ] **Step 1: Add the import and instantiate the watchdog**

In `bridge/server.js`, add near the other `lib/` requires (after the `buildAiCliDefinitions` import added in Task 1):

```js
const { DevServerWatchdog } = require('../lib/devServerWatchdog');
```

Immediately after the existing `previewRuntimeManager` instantiation (`bridge/server.js:130-135`), add:

```js
const devServerWatchdog = new DevServerWatchdog({
  terminalManager,
  events,
  sendStatus(payload) {
    emit('preview:status', payload);
  },
});
```

- [ ] **Step 2: Route `/api/preview/syncRuntime` through the watchdog for `server` mode**

Replace the body of the `/api/preview/syncRuntime` handler (`bridge/server.js:357-369`) with:

```js
  if (pathname === '/api/preview/syncRuntime') {
    const projectPath = body.projectPath || '.';
    const options = body.options || {};
    const cwd = workspaceFs.resolveWorkspacePath(projectPath);
    if (options.sourceType === 'server') {
      if (options.autoStart === false) {
        devServerWatchdog.stop(projectPath);
        return sendJson(res, 200, { ok: true, running: false });
      }
      return sendJson(res, 200, devServerWatchdog.start(projectPath, {
        cwd,
        aiCli: options.aiCli,
        serverCommand: options.command,
      }));
    }
    const resolvedOptions = await previewRuntimeManager.resolveLaunchOptions(projectPath, {
      cwd,
      sourceType: options.sourceType,
      command: options.command,
      url: options.url,
      autoStart: options.autoStart,
    });
    return sendJson(res, 200, await previewRuntimeManager.syncProject(projectPath, resolvedOptions));
  }
```

- [ ] **Step 3: Route `/api/preview/startRuntime` and `/api/preview/stopRuntime`**

Replace `bridge/server.js:370-385` (the `startRuntime` and `stopRuntime` handlers) with:

```js
  if (pathname === '/api/preview/startRuntime') {
    const projectPath = body.projectPath || '.';
    const options = body.options || {};
    const cwd = workspaceFs.resolveWorkspacePath(projectPath);
    if ((options.sourceType || 'server') === 'server') {
      return sendJson(res, 200, devServerWatchdog.start(projectPath, {
        cwd,
        aiCli: options.aiCli,
        serverCommand: options.command,
      }));
    }
    const resolvedOptions = await previewRuntimeManager.resolveLaunchOptions(projectPath, {
      cwd,
      sourceType: options.sourceType || 'server',
      command: options.command,
      url: options.url,
    });
    return sendJson(res, 200, await previewRuntimeManager.start(projectPath, resolvedOptions));
  }
  if (pathname === '/api/preview/stopRuntime') {
    devServerWatchdog.stop(body.projectPath || '.');
    previewRuntimeManager.stop(body.projectPath || '.', { keepStoppedState: true });
    return sendJson(res, 200, { ok: true });
  }
```

(`stopRuntime` calls both — harmless no-op on whichever one wasn't actually running for that project, and avoids needing to track which mode a project was in just to route a stop correctly.)

- [ ] **Step 4: Add the `/api/preview/getLog` endpoint**

Immediately after the `stopRuntime` block from Step 3, add:

```js
  if (pathname === '/api/preview/getLog') {
    return sendJson(res, 200, { log: devServerWatchdog.getLog(body.projectPath || '.') });
  }
```

- [ ] **Step 5: Remove the now-dead `server`-mode branches from `PreviewRuntimeManager`**

In `lib/previewRuntimeManager.js`, `syncProject` (`lib/previewRuntimeManager.js:61-87`) currently branches on `sourceType === 'server' || sourceType === 'native'`. Since `server` mode is now routed to `DevServerWatchdog` before it ever reaches `previewRuntimeManager.syncProject`/`.start`, narrow this class to `native` only. Replace `lib/previewRuntimeManager.js:61-87`:

```js
  async syncProject(key, options = {}) {
    const sourceType = options.sourceType || 'none';
    const shouldManageProcess = sourceType === 'native' && options.command;
    if (!shouldManageProcess) {
      this.stop(key, { keepStoppedState: sourceType === 'native' });
      return { ok: true, running: false };
    }

    const current = this.processes.get(key);
    if (current && current.command === options.command && current.cwd === options.cwd) {
      this.#emitStatus(key, {
        running: true,
        sourceType,
        command: options.command,
        configuredUrl: options.url || '',
        url: current.url || options.url || '',
      });
      return { ok: true, running: true };
    }

    if (options.autoStart === false) {
      this.stop(key, { keepStoppedState: true });
      return { ok: true, running: false };
    }

    return this.start(key, options);
  }
```

And in `start()` (`lib/previewRuntimeManager.js:89-94`), change the default `sourceType` since `'server'` is no longer a caller of this method:

```js
  start(key, options = {}) {
    const { cwd, command, url = '', sourceType = 'native' } = options;
    if (!cwd || !command) {
      throw new Error('Preview runtime start requires cwd and command');
    }
```

- [ ] **Step 6: Update `test/previewRuntimeManager.test.js` for the narrowed scope**

Read `test/previewRuntimeManager.test.js` in full first — it has a test that starts a `server`-sourceType command directly against `PreviewRuntimeManager` (around the `manager.start('project-a', ...)` call seen at the bottom of the file). Since `server` mode no longer runs through this class, update that test to use `sourceType: 'native'` instead of `'server'` (the test's actual mechanics — spawning a script, waiting for the URL to appear, sending SIGTERM — don't otherwise change; only the `sourceType` string passed into `manager.start(...)` and any assertion checking `sourceType: 'server'` in the emitted status payload, which becomes `sourceType: 'native'`).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (all tests, including the updated `previewRuntimeManager.test.js` and the new `devServerWatchdog.test.js`)

- [ ] **Step 8: Run lint**

Run: `npm run lint`
Expected: PASS. If `lint` isn't a defined script, check `package.json` — this repo's `package.json` (read during planning) does not list a `lint` script, only `test`, `test:codex`, `test:pw:visual-loop`, `test:pw:visual-loop:codex`, `dev`, `dev:backend`, `dev:hot`, `build`, `build:mac`, `start`. If `npm run lint` errors with "missing script", skip this step — there is no lint step in this repo currently.

- [ ] **Step 9: Commit**

```bash
git add bridge/server.js lib/previewRuntimeManager.js test/previewRuntimeManager.test.js
git commit -m "feat: route Server command mode through DevServerWatchdog"
```

---

### Task 5: Renderer — mini terminal in Running Page settings

**Files:**
- Modify: `renderer/zero-api.js:45-70` (add `getPreviewLog`)
- Modify: `renderer/index.html:38-89` (`#running-page-panel` markup)
- Modify: `renderer/app.js` (multiple spots — see steps)
- Modify: `renderer/styles.css` (new rules for the mini terminal)

**Interfaces:**
- Consumes: `window.api.getPreviewLog(projectPath)` (new), `window.api.on('terminal:data'|'terminal:exit', cb)` (already exists, `renderer/zero-api.js:3-11` already lists both event names), `window.api.writeTerminal(data, key)` (already exists, `renderer/zero-api.js:69`), `aiCliSupportsDangerousBypass` (existing, `renderer/app.js:275-277`).

- [ ] **Step 1: Add `getPreviewLog` to the API bridge**

In `renderer/zero-api.js`, add this line next to the other `preview*` methods (after `stopPreviewRuntime`, `renderer/zero-api.js:59`):

```js
    getPreviewLog: (projectPath) => request('/api/preview/getLog', { projectPath }),
```

- [ ] **Step 2: Add the mini terminal markup**

`renderer/app.js:58` builds `previewFieldRows` as `[...document.querySelectorAll('[data-source]')]` — a static snapshot taken once at script load. `renderRunningPageFields(sourceType)` (`renderer/app.js:1253-1259`) hides every element in that list whose `data-source` doesn't match the current source type. So any element present in the initial HTML with `data-source="server"` is automatically shown/hidden correctly — no new show/hide logic needed, just matching markup.

In `renderer/index.html`, inside `#running-page-panel`, immediately before the closing `</section>` (after the `#running-page-actions` div, `renderer/index.html:84-88`), add:

```html
          <div id="running-page-log-panel" class="running-field" data-source="server">
            <pre id="running-page-log"></pre>
            <div id="running-page-log-input-row">
              <input id="running-page-log-input" type="text" placeholder="Type to the agent…" />
              <button id="running-page-log-send" type="button">Send</button>
            </div>
          </div>
```

(`class="running-field"` is for consistent spacing via the existing `.running-field { display: grid; gap: 6px; ... }` rule at `renderer/styles.css:510-516` — not required for the show/hide behavior, which is driven purely by the `data-source` attribute.)

- [ ] **Step 3: Declare the new element references**

In `renderer/app.js`, alongside the existing `runningPage*` element declarations (`renderer/app.js:41-49`), add:

```js
const runningPageLogEl = document.getElementById('running-page-log');
const runningPageLogInputEl = document.getElementById('running-page-log-input');
const runningPageLogSendEl = document.getElementById('running-page-log-send');
```

- [ ] **Step 4: Gate "Server command" mode on the AI CLI selection**

In `saveRunningPageConfig` (`renderer/app.js:1520-1527`) and `startConfiguredRuntime` (`renderer/app.js:1529-1537`), the watchdog only supports `codex`/`claude`. Update both to check this before calling `applyRuntimeConfig`. Replace `renderer/app.js:1520-1537`:

```js
async function saveRunningPageConfig() {
  const config = collectRuntimeConfigFromForm();
  if (config.sourceType === 'server' && !aiCliSupportsDangerousBypass(selectedAiCli)) {
    window.alert('Server command mode requires Codex or Claude selected in the AI Launch panel.');
    return;
  }
  try {
    await applyRuntimeConfig(selectedProjectPath, config);
  } catch (error) {
    window.alert(error.message);
  }
}

async function startConfiguredRuntime() {
  const config = collectRuntimeConfigFromForm();
  if (config.sourceType !== 'server') return;
  if (!aiCliSupportsDangerousBypass(selectedAiCli)) {
    window.alert('Server command mode requires Codex or Claude selected in the AI Launch panel.');
    return;
  }
  try {
    await applyRuntimeConfig(selectedProjectPath, config, { forceStart: true });
  } catch (error) {
    window.alert(error.message);
  }
}
```

- [ ] **Step 5: Pass `aiCli` into the runtime sync/start calls**

In `applyRuntimeConfig` (`renderer/app.js:1462-1499`), the `server`-mode branch calls `window.api.syncPreviewRuntime(projectPath, { sourceType: 'server', command, url, autoStart })` (`renderer/app.js:1491-1496`) without `aiCli`. Replace that call (`renderer/app.js:1491-1496`):

```js
    const syncResult = await window.api.syncPreviewRuntime(projectPath, {
      sourceType: 'server',
      command: config.serverCommand,
      url: config.serverUrl,
      autoStart: shouldAutoStart,
      aiCli: selectedAiCli,
    });
```

- [ ] **Step 6: Render the log panel visibility + fetch backlog on project/config render**

In `renderRuntimeConfig` (`renderer/app.js:1279-1288`), after the existing `renderRunningPageFields(config.sourceType)` call, add a call to a new function that loads the backlog when switching into `server` mode. Replace `renderer/app.js:1279-1288`:

```js
function renderRuntimeConfig(projectPath) {
  const config = projectRuntimeConfig.get(projectPath) || defaultRuntimeConfig();
  runningPageTypeEl.value = config.sourceType;
  runningPageHtmlEl.value = config.htmlPath || '';
  runningPageCommandEl.value = config.serverCommand || '';
  runningPageUrlInputEl.value = config.serverUrl || '';
  runningPageAutostartEl.checked = config.autoStart !== false;
  renderRunningPageFields(config.sourceType);
  renderRuntimeStatus(projectPath);
  if (config.sourceType === 'server') {
    loadRunningPageLog(projectPath);
  }
}
```

- [ ] **Step 7: Add the log-loading, live-append, and input-send functions**

Add these new functions near `renderRuntimeStatus` in `renderer/app.js` (right after it, `renderer/app.js:1277`):

```js
let runningPageLogProjectPath = null;

function appendRunningPageLog(text) {
  if (!runningPageLogEl) return;
  runningPageLogEl.textContent += text;
  const lines = runningPageLogEl.textContent.split('\n');
  if (lines.length > 300) {
    runningPageLogEl.textContent = lines.slice(lines.length - 300).join('\n');
  }
  runningPageLogEl.scrollTop = runningPageLogEl.scrollHeight;
}

async function loadRunningPageLog(projectPath) {
  runningPageLogProjectPath = projectPath;
  if (!runningPageLogEl) return;
  runningPageLogEl.textContent = '';
  try {
    const { log } = await window.api.getPreviewLog(projectPath);
    if (runningPageLogProjectPath === projectPath) {
      runningPageLogEl.textContent = log || '';
      runningPageLogEl.scrollTop = runningPageLogEl.scrollHeight;
    }
  } catch {
    // Backlog fetch is best-effort — live updates via terminal:data still work.
  }
}

function watchdogTerminalKeyFor(projectPath) {
  return `watchdog:${projectPath}`;
}

function sendRunningPageLogInput() {
  const text = runningPageLogInputEl.value;
  if (!text) return;
  window.api.writeTerminal(`${text}\n`, watchdogTerminalKeyFor(selectedProjectPath));
  runningPageLogInputEl.value = '';
}
```

- [ ] **Step 8: Subscribe to live terminal output for the current project's watchdog**

Near the other `window.api.on(...)` registrations (search for where `preview:status` or `preview:htmlChanged` listeners are registered in `renderer/app.js` — these exist even though this plan's earlier investigation found no *consumer* wired up yet for `preview:status`; register the new listener in the same place any existing `window.api.on` calls live, or if none exist yet, add this block near the bottom of the file where other one-time startup wiring happens, before the final initialization call), add:

```js
window.api.on('terminal:data', ({ key, data }) => {
  if (key === watchdogTerminalKeyFor(selectedProjectPath)) {
    appendRunningPageLog(data);
  }
});

window.api.on('terminal:exit', ({ key }) => {
  if (key === watchdogTerminalKeyFor(selectedProjectPath)) {
    appendRunningPageLog('\n[agent process exited]\n');
  }
});

runningPageLogSendEl.addEventListener('click', sendRunningPageLogInput);
runningPageLogInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendRunningPageLogInput();
  }
});
```

- [ ] **Step 9: Add CSS for the mini terminal**

In `renderer/styles.css`, add near the `#running-page-panel` rules (after the block at `renderer/styles.css:429-436`):

```css
#running-page-log-panel {
  display: grid;
  gap: 8px;
}

#running-page-log {
  min-height: 120px;
  max-height: 220px;
  margin: 0;
  padding: 10px;
  background: rgba(8, 14, 24, 0.55);
  color: rgba(245, 250, 255, 0.92);
  font: 12px/1.45 "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border), white 8%);
}

#running-page-log-input-row {
  display: flex;
  gap: 8px;
}

#running-page-log-input-row input {
  flex: 1;
}
```

- [ ] **Step 10: Manual verification**

This session is running locally (per project convention, do not run `npm run build` — only `npm test` and manual verification). Ask the user to reload Pixelbox (or use the `/run` skill's guidance for this repo — a native macOS app, relaunch via `zig build run`) and:
1. Set a project's Running Page to "Server command" with a command that will fail (e.g. `npm run dev` in a directory with no `node_modules`), select Claude or Codex in the AI Launch panel, click Start.
2. Confirm the mini terminal in Settings shows the agent's live output.
3. Confirm it eventually shows evidence of the agent running `npm install` and the command succeeding.
4. Type a line into the input box and confirm it reaches the agent (visible in its terminal output responding to it).

- [ ] **Step 11: Commit**

```bash
git add renderer/zero-api.js renderer/index.html renderer/app.js renderer/styles.css
git commit -m "feat: embed dev server watchdog mini terminal in Running Page settings"
```

---

### Task 6: End-to-end regression test (gated, matches existing e2e convention)

**Files:**
- Create: `test/devServerWatchdog.e2e.test.js`

**Interfaces:**
- Consumes: `DevServerWatchdog` (Task 3), a real `TerminalManager` + `TerminalSession` (existing, `lib/terminalManager.js`, `lib/terminalSession.js`), a real `claude` or `codex` binary in `PATH` (test skips itself if neither is gated-in, matching `test/terminal.codex.e2e.test.js`'s pattern of being gated behind an env var and not run by default in `npm test`).

- [ ] **Step 1: Read the existing e2e convention**

Read `test/terminal.codex.e2e.test.js` in full to match its exact gating pattern (the env var it checks, e.g. `RUN_CODEX_E2E`, and how it skips vs. fails when that var is unset — this repo's `package.json` `test:codex` script, `"RUN_CODEX_E2E=1 node --test test/terminal.codex.e2e.test.js"`, confirms the gating variable name).

- [ ] **Step 2: Write the gated e2e test**

Create `test/devServerWatchdog.e2e.test.js`, following the same gating convention discovered in Step 1 (substitute the exact skip mechanism used there — e.g. an early `return` inside the test body with a console note, or a `test.skip` guard, whichever `terminal.codex.e2e.test.js` uses):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { DevServerWatchdog } = require('../lib/devServerWatchdog');
const { TerminalManager } = require('../lib/terminalManager');
const { TerminalSession, defaultShell } = require('../lib/terminalSession');

test('DevServerWatchdog fixes a broken npm project end-to-end', { skip: process.env.RUN_CODEX_E2E !== '1' }, async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pxcode-watchdog-e2e-'));
  await fs.writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'broken-project',
      version: '1.0.0',
      scripts: { dev: 'node server.js' },
      dependencies: { express: '^4.18.0' },
    }),
    'utf8'
  );
  await fs.writeFile(
    path.join(tmpDir, 'server.js'),
    "const express = require('express'); const app = express(); app.listen(4321, () => console.log('http://localhost:4321'));",
    'utf8'
  );

  const events = new EventEmitter();
  const terminalManager = new TerminalManager({
    createSession({ cwd, startupCommand }) {
      const shell = defaultShell();
      const argv = startupCommand && startupCommand.trim() ? ['-ilc', startupCommand] : ['-il'];
      return new TerminalSession({ shell, argv, cwd });
    },
    sendData(data) {
      events.emit('terminal:data', data);
    },
    sendExit(payload) {
      events.emit('terminal:exit', payload);
    },
  });

  const statuses = [];
  const watchdog = new DevServerWatchdog({
    terminalManager,
    events,
    sendStatus(payload) {
      statuses.push(payload);
    },
  });

  watchdog.start('e2e-project', { cwd: tmpDir, aiCli: 'claude', serverCommand: 'npm run dev' });

  const deadlineMs = Date.now() + 120_000;
  while (Date.now() < deadlineMs) {
    const log = watchdog.getLog('e2e-project');
    if (log.includes('npm install') && statuses.some((s) => s.url)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const finalLog = watchdog.getLog('e2e-project');
  assert.match(finalLog, /npm install/);
  assert.ok(statuses.some((s) => s.url === 'http://localhost:4321'), 'expected the watchdog to detect the recovered server URL');

  watchdog.stop('e2e-project');
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add a new script next to `test:codex` (`package.json`'s `scripts` block):

```json
    "test:watchdog": "RUN_CODEX_E2E=1 node --test test/devServerWatchdog.e2e.test.js",
```

Per this repo's convention (`package.json` instructions: "remember to never increment package.json because CI does that for us" — this refers to the `version` field only; adding a script entry is not a version bump and is fine).

- [ ] **Step 4: Run it manually (not part of default `npm test`)**

Run: `npm run test:watchdog`
Expected: PASS if `claude` is installed and authenticated on this machine; if not, the test reports skipped (per Step 1's gating) rather than failing. This step requires a real `claude` CLI call and takes up to 2 minutes — do not run it as part of routine `npm test`.

- [ ] **Step 5: Commit**

```bash
git add test/devServerWatchdog.e2e.test.js package.json
git commit -m "test: add gated end-to-end coverage for DevServerWatchdog"
```
