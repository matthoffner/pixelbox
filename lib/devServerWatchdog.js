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

const { extractUrls, stripAnsi } = require('./previewRuntimeManager');

const LOG_LINE_CAP = 300;

// Single source of truth for the terminal-key namespace used by the watchdog.
// `renderer/app.js` mirrors this literal in one local constant because the
// renderer cannot require() Node modules.
const WATCHDOG_KEY_PREFIX = 'watchdog:';

function watchdogKey(key) {
  return `${WATCHDOG_KEY_PREFIX}${key}`;
}

function isWatchdogKey(terminalKey) {
  return typeof terminalKey === 'string' && terminalKey.startsWith(WATCHDOG_KEY_PREFIX);
}

class DevServerWatchdog {
  constructor({ terminalManager, events, sendStatus }) {
    this.terminalManager = terminalManager;
    this.events = events;
    this.sendStatus = sendStatus;
    this.runtimes = new Map();
    this._onTerminalData = this._onTerminalData.bind(this);
    this._onTerminalExit = this._onTerminalExit.bind(this);
    this.events.on('terminal:data', this._onTerminalData);
    this.events.on('terminal:exit', this._onTerminalExit);
  }

  start(key, { cwd, aiCli, serverCommand }) {
    const startupCommand = buildWatchdogStartupCommand({ aiCli, serverCommand });
    const existing = this.runtimes.get(key);

    // NOTE: bridge/server.js's real terminalManager's createSession callback
    // (bridge/server.js:113-120) destructures `{ cwd, startupCommand }` — a
    // shell command *string* — and builds argv itself via
    // terminalSpawnArgs(shell, startupCommand). It does NOT accept an argv
    // array directly. Passing `{ cwd, argv: [...] }` here would silently
    // launch a bare interactive shell with the startup command dropped.
    const started = this.terminalManager.start(watchdogKey(key), {
      cwd,
      startupCommand,
    });

    if (started && started.created === false) {
      // TerminalManager.start() is a no-op when a session for this key already
      // exists, so the *old* agent is still the one executing.
      if (existing && existing.command === serverCommand) {
        // Same command — keep the live log buffer and detected URL intact.
        this.#emitStatus(key, { running: true, url: existing.url });
        return { ok: true, running: true };
      }
      // Different command — actually relaunch before resetting state.
      this.terminalManager.restart(watchdogKey(key), { cwd, startupCommand });
    }

    this.runtimes.set(key, { command: serverCommand, url: '', logLines: [] });
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
    if (!runtime || runtime.logLines.length === 0) return '';
    return runtime.logLines.join('\n') + '\n';
  }

  _onTerminalData({ key: terminalKey, data }) {
    const key = this.#keyForTerminalKey(terminalKey);
    if (!key) return;
    const runtime = this.runtimes.get(key);
    if (!runtime) return;

    // The watchdog agent is a full-screen TUI; strip ANSI/cursor escapes so the
    // plain-text mini terminal (both getLog() backlog and live output) is
    // readable. extractUrls() strips internally, so it still gets raw `data`.
    const lines = stripAnsi(String(data)).split(/\r?\n/).filter((line) => line.length > 0);
    runtime.logLines.push(...lines);
    if (runtime.logLines.length > LOG_LINE_CAP) {
      runtime.logLines = runtime.logLines.slice(runtime.logLines.length - LOG_LINE_CAP);
    }

    const urls = extractUrls(data);
    const nextUrl = urls.length > 0 ? urls[urls.length - 1] : runtime.url;
    if (nextUrl === runtime.url) {
      // Emitting on every PTY chunk makes the renderer clear and re-fetch the
      // whole mini terminal many times per second. Only announce real changes;
      // start() already emitted the initial `running: true`.
      return;
    }

    runtime.url = nextUrl;
    this.#emitStatus(key, { running: true, url: runtime.url });
  }

  _onTerminalExit({ key: terminalKey }) {
    const key = this.#keyForTerminalKey(terminalKey);
    if (!key) return;
    const runtime = this.runtimes.get(key);
    if (!runtime) return;

    // Keep the runtime entry (and its log buffer) so getLog() still returns the
    // history that explains why the agent exited. Only stop() clears it.
    this.#emitStatus(key, { running: false, url: runtime.url });
  }

  #keyForTerminalKey(terminalKey) {
    if (!isWatchdogKey(terminalKey)) return null;
    const key = terminalKey.slice(WATCHDOG_KEY_PREFIX.length);
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
  WATCHDOG_KEY_PREFIX,
  watchdogKey,
  isWatchdogKey,
};
