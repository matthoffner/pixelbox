const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { PreviewRuntimeManager, extractUrls } = require('../lib/previewRuntimeManager');

test('extractUrls finds localhost URLs in noisy terminal output', () => {
  const urls = extractUrls('\u001b[32mready\u001b[0m http://127.0.0.1:4123/path?x=1)\n');
  assert.deepEqual(urls, ['http://127.0.0.1:4123/path?x=1']);
});

test('PreviewRuntimeManager starts a server command and emits running/stopped status', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pxcode-preview-runtime-'));
  const port = 43129;
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

    await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (statuses.some((entry) => entry.running && entry.url === `http://127.0.0.1:${port}`)) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error('Timed out waiting for preview runtime to report URL'));
        }
      }, 100);
    });

    manager.stop('project-a');

    await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (statuses.some((entry) => entry.running === false)) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > 5000) {
          clearInterval(timer);
          reject(new Error('Timed out waiting for preview runtime to stop'));
        }
      }, 50);
    });
  } finally {
    manager.stopAll();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
