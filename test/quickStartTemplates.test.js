const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  QUICK_SERVER_STARTER_PORT,
  htmlStarterDocument,
  packageNameForProject,
  serverStarterDocument,
  starterPackageJson,
} = require('../renderer/quick-start-templates');

test('starter package preserves existing metadata and installs dev script', () => {
  const existing = JSON.stringify({
    name: 'custom-name',
    version: '2.0.0',
    scripts: {
      test: 'node --test',
    },
  });

  assert.deepEqual(starterPackageJson(existing, 'projects/My App'), {
    name: 'custom-name',
    version: '2.0.0',
    scripts: {
      test: 'node --test',
      dev: 'node server.js',
    },
  });
});

test('starter package derives safe fallback names', () => {
  assert.equal(packageNameForProject('.'), 'pixelbox-starter');
  assert.equal(packageNameForProject('projects/My Cool App!'), 'my-cool-app');
});

test('HTML starter escapes project-derived titles', () => {
  const html = htmlStarterDocument('projects/<script>alert("x")</script>');
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt; script&gt; Starter/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('server starter is syntactically valid and honors injected PORT', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pxcode-server-template-'));
  const serverPath = path.join(tmpDir, 'server.js');
  const port = QUICK_SERVER_STARTER_PORT + 73;

  try {
    await fs.writeFile(serverPath, serverStarterDocument('projects/demo'), 'utf8');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--check', serverPath], { stdio: 'pipe' });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`server.js syntax check exited ${code}`));
      });
      child.on('error', reject);
    });

    const child = spawn(process.execPath, [serverPath], {
      cwd: tmpDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not print URL')), 5000);
        child.stdout.on('data', (chunk) => {
          if (chunk.toString('utf8').includes(`http://127.0.0.1:${port}`)) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          reject(new Error(`server exited before ready: ${code}`));
        });
      });

      const response = await fetch(`http://127.0.0.1:${port}`);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.match(body, /demo Server/);
      assert.match(body, /Edit <code>server\.js<\/code>/);
    } finally {
      child.kill();
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('surprise starter includes the launch board surface', () => {
  const source = serverStarterDocument('projects/alpha', 'surprise');
  assert.match(source, /alpha Launch Board/);
  assert.match(source, /Pixelbox generated/);
  assert.match(source, /metric-grid/);
  assert.match(source, /new Date\(\)\.toLocaleTimeString/);
});
