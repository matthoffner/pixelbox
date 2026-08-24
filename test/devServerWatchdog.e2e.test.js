const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { EventEmitter } = require('node:events');

const { DevServerWatchdog } = require('../lib/devServerWatchdog');
const { TerminalManager } = require('../lib/terminalManager');
const { TerminalSession, defaultShell } = require('../lib/terminalSession');

const execFileAsync = promisify(execFile);

test('DevServerWatchdog fixes a broken npm project end-to-end', { timeout: 130000 }, async (t) => {
  if (!process.env.RUN_CODEX_E2E) {
    t.skip('Set RUN_CODEX_E2E=1 to run DevServerWatchdog end-to-end test');
    return;
  }

  try {
    await execFileAsync('claude', ['--version']);
  } catch {
    t.skip('claude CLI is not available in PATH');
    return;
  }

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

  try {
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
  } finally {
    watchdog.stop('e2e-project');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
