const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { PreviewRuntimeManager, extractUrls } = require('../lib/previewRuntimeManager');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForCondition(predicate, { timeoutMs = 10000, intervalMs = 100, message = 'Timed out waiting' } = {}) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(message);
}

test('extractUrls finds localhost URLs in noisy terminal output', () => {
  const urls = extractUrls('\u001b[32mready\u001b[0m http://127.0.0.1:4123/path?x=1)\n');
  assert.deepEqual(urls, ['http://127.0.0.1:4123/path?x=1']);
});

test('PreviewRuntimeManager starts a server command and emits running/stopped status', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pxcode-preview-runtime-'));
  const port = await getFreePort();
  const statuses = [];
  const scriptPath = path.join(tmpDir, 'server.js');
  const manager = new PreviewRuntimeManager({
    shell: '/bin/zsh',
    sendStatus(payload) {
      statuses.push(payload);
    },
  });

  try {
    await fs.writeFile(
      scriptPath,
      [
        `console.log('http://127.0.0.1:${port}');`,
        "const timer = setInterval(() => {}, 1000);",
        "process.on('SIGTERM', () => {",
        '  clearInterval(timer);',
        '  process.exit(0);',
        '});',
      ].join('\n'),
      'utf8'
    );

    manager.start('project-a', {
      cwd: tmpDir,
      sourceType: 'server',
      command: `node ${JSON.stringify(scriptPath)}`,
      url: '',
    });

    await waitForCondition(() => statuses.some((entry) => entry.running && entry.url === `http://127.0.0.1:${port}`), {
      message: 'Timed out waiting for preview runtime to report URL',
    });

    manager.stop('project-a');

    await waitForCondition(() => statuses.some((entry) => entry.running === false), {
      timeoutMs: 5000,
      intervalMs: 50,
      message: 'Timed out waiting for preview runtime to stop',
    });
  } finally {
    manager.stopAll();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('PreviewRuntimeManager frees its own port before resolving an explicit restart', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pxcode-preview-runtime-restart-'));
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const scriptPath = path.join(tmpDir, 'server.js');
  const manager = new PreviewRuntimeManager({
    shell: '/bin/zsh',
    sendStatus() {},
  });

  try {
    await fs.writeFile(
      scriptPath,
      [
        "const http = require('node:http');",
        `const server = http.createServer((req, res) => res.end('running on ${port}'));`,
        `server.listen(${port}, '127.0.0.1', () => console.log('${url}'));`,
        "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join('\n'),
      'utf8'
    );

    manager.start('project-a', {
      cwd: tmpDir,
      sourceType: 'server',
      command: `node ${JSON.stringify(scriptPath)}`,
      url,
    });

    await waitForCondition(async () => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    }, {
      message: 'Timed out waiting for managed preview port',
    });

    await manager.stopAndWait('project-a');
    const resolved = await manager.resolveLaunchOptions('project-a', {
      cwd: tmpDir,
      sourceType: 'server',
      command: `node ${JSON.stringify(scriptPath)}`,
      url,
    });

    assert.equal(resolved.url, url);
  } finally {
    manager.stopAll();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
