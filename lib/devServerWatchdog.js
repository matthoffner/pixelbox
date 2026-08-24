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
    if (!runtime || runtime.logLines.length === 0) return '';
    return runtime.logLines.join('\n') + '\n';
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
