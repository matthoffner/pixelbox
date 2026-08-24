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
