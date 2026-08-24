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

const {
  DevServerWatchdog,
  WATCHDOG_KEY_PREFIX,
  watchdogKey,
  isWatchdogKey,
} = require('../lib/devServerWatchdog');
const { EventEmitter } = require('node:events');

function createFakeTerminalManager({ createdOnStart = true } = {}) {
  return {
    startCalls: [],
    restartCalls: [],
    writeCalls: [],
    killCalls: [],
    createdOnStart,
    start(key, options) {
      this.startCalls.push({ key, options });
      return { ok: true, created: this.createdOnStart, hasPseudoTTY: true };
    },
    restart(key, options) {
      this.restartCalls.push({ key, options });
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

function createWatchdog(terminalManager, statuses) {
  const events = new EventEmitter();
  const watchdog = new DevServerWatchdog({
    terminalManager,
    events,
    sendStatus(payload) {
      if (statuses) statuses.push(payload);
    },
  });
  return { events, watchdog };
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

test('DevServerWatchdog only emits preview status when the detected URL changes', () => {
  const terminalManager = createFakeTerminalManager();
  const statuses = [];
  const { events, watchdog } = createWatchdog(terminalManager, statuses);

  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  assert.equal(statuses.length, 1);

  // Chatty TUI output with no URL must not re-emit — the renderer refetches the
  // whole mini terminal log on every preview:status.
  for (let i = 0; i < 50; i += 1) {
    events.emit('terminal:data', { key: 'watchdog:project-a', data: `working ${i}\n` });
  }
  assert.equal(statuses.length, 1);

  events.emit('terminal:data', { key: 'watchdog:project-a', data: 'Local: http://localhost:5173\n' });
  assert.equal(statuses.length, 2);

  // Repeating the same URL is not a change.
  events.emit('terminal:data', { key: 'watchdog:project-a', data: 'still http://localhost:5173\n' });
  assert.equal(statuses.length, 2);

  events.emit('terminal:data', { key: 'watchdog:project-a', data: 'moved to http://localhost:5174\n' });
  assert.equal(statuses.length, 3);
  assert.equal(statuses[2].url, 'http://localhost:5174');
});

test('DevServerWatchdog emits running:false when the agent terminal exits and keeps the log', () => {
  const terminalManager = createFakeTerminalManager();
  const statuses = [];
  const { events, watchdog } = createWatchdog(terminalManager, statuses);

  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  events.emit('terminal:data', { key: 'watchdog:project-a', data: 'Local: http://localhost:5173\n' });
  events.emit('terminal:exit', { key: 'some-other-key' });
  events.emit('terminal:exit', { key: 'watchdog:project-a' });

  const last = statuses[statuses.length - 1];
  assert.equal(last.running, false);
  assert.equal(last.url, 'http://localhost:5173');
  assert.equal(last.sourceType, 'server');
  // Log history survives an exit so the user can diagnose the failure.
  assert.equal(watchdog.getLog('project-a'), 'Local: http://localhost:5173\n');
});

test('DevServerWatchdog.start keeps existing state when the same command is already running', () => {
  const terminalManager = createFakeTerminalManager({ createdOnStart: false });
  const statuses = [];
  const { events, watchdog } = createWatchdog(terminalManager, statuses);

  terminalManager.createdOnStart = true;
  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  events.emit('terminal:data', { key: 'watchdog:project-a', data: 'Local: http://localhost:5173\n' });

  terminalManager.createdOnStart = false;
  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });

  assert.equal(terminalManager.restartCalls.length, 0);
  assert.equal(watchdog.getLog('project-a'), 'Local: http://localhost:5173\n');
  const last = statuses[statuses.length - 1];
  assert.equal(last.running, true);
  assert.equal(last.url, 'http://localhost:5173');
});

test('DevServerWatchdog.start restarts the session when the server command changed', () => {
  const terminalManager = createFakeTerminalManager();
  const statuses = [];
  const { events, watchdog } = createWatchdog(terminalManager, statuses);

  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  events.emit('terminal:data', { key: 'watchdog:project-a', data: 'Local: http://localhost:5173\n' });

  terminalManager.createdOnStart = false;
  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm start' });

  assert.equal(terminalManager.restartCalls.length, 1);
  assert.equal(terminalManager.restartCalls[0].key, 'watchdog:project-a');
  assert.match(terminalManager.restartCalls[0].options.startupCommand, /npm start/);
  // Fresh session — stale log buffer and URL are dropped.
  assert.equal(watchdog.getLog('project-a'), '');
  const last = statuses[statuses.length - 1];
  assert.equal(last.command, 'npm start');
  assert.equal(last.url, '');
});

test('DevServerWatchdog strips ANSI escapes from the buffered log', () => {
  const terminalManager = createFakeTerminalManager();
  const { events, watchdog } = createWatchdog(terminalManager, []);

  watchdog.start('project-a', { cwd: 'project-a', aiCli: 'claude', serverCommand: 'npm run dev' });
  events.emit('terminal:data', {
    key: 'watchdog:project-a',
    data: '\u001B[2J\u001B[1;32mready\u001B[0m http://localhost:5173\n',
  });

  assert.equal(watchdog.getLog('project-a'), 'ready http://localhost:5173\n');
});

test('watchdog key helpers share one prefix', () => {
  assert.equal(WATCHDOG_KEY_PREFIX, 'watchdog:');
  assert.equal(watchdogKey('projects/demo'), 'watchdog:projects/demo');
  assert.equal(isWatchdogKey('watchdog:projects/demo'), true);
  assert.equal(isWatchdogKey('projects/demo'), false);
  assert.equal(isWatchdogKey(undefined), false);
});
