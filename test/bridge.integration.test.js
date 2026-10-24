const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function request(port, options = {}) {
  const body = options.body == null
    ? null
    : typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
  const headers = {
    Host: options.host || `127.0.0.1:${port}`,
    ...(options.origin ? { Origin: options.origin } : {}),
    ...(body != null ? {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: options.path || '/health',
      method: options.method || 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function startBridge(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-bridge-'));
  const site = path.join(workspace, 'site');
  await fs.mkdir(site);
  await fs.writeFile(path.join(site, 'index.html'), '<h1>Isolated preview</h1>');
  await fs.writeFile(path.join(site, '.env'), 'SECRET=not-public');
  await fs.writeFile(path.join(workspace, 'sentinel.txt'), 'keep');
  const port = await reservePort();
  const child = spawn(process.execPath, ['bridge/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PIXELBOX_BACKEND_PORT: String(port),
      PIXELBOX_WORKSPACE_ROOT: workspace,
      PXCODE_DISABLE_AUTO_TUI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Bridge did not start:\n${output}`)), 5000);
    const check = () => {
      if (output.includes('Pixelbox backend ready')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on('data', check);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bridge exited early with ${code}:\n${output}`));
    });
    check();
  });
  t.after(async () => {
    if (child.exitCode == null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    await fs.rm(workspace, { recursive: true, force: true });
  });
  return { port, workspace };
}

test('bridge wiring enforces methods, origins, body limits, and isolated preview capabilities', async (t) => {
  const { port, workspace } = await startBridge(t);
  const primaryOrigin = `http://127.0.0.1:${port}`;
  const previewOrigin = `http://localhost:${port}`;

  assert.equal((await request(port)).status, 200);
  assert.equal((await request(port, { host: '127.0.0.1' })).status, 403);
  assert.equal((await request(port, { host: `evil.example:${port}` })).status, 403);

  const apiOptions = {
    method: 'POST',
    path: '/api/workspace/getRoot',
    body: {},
  };
  assert.equal((await request(port, { ...apiOptions, origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(port, { ...apiOptions, host: `localhost:${port}`, origin: previewOrigin })).status, 403);
  assert.equal((await request(port, { ...apiOptions, origin: primaryOrigin })).status, 200);

  assert.equal((await request(port, { path: '/api/fs/removeDir' })).status, 405);
  assert.equal((await request(port, {
    method: 'POST',
    path: '/api/fs/removeDir',
    origin: primaryOrigin,
    body: {},
  })).status, 500);
  assert.equal(await fs.readFile(path.join(workspace, 'sentinel.txt'), 'utf8'), 'keep');
  assert.equal((await request(port, { method: 'POST', path: '/health', body: {} })).status, 405);

  const preflight = await request(port, {
    method: 'OPTIONS',
    path: '/api/workspace/getRoot',
    origin: primaryOrigin,
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], primaryOrigin);

  const oversized = `{"value":"${'x'.repeat(1024 * 1024)}"}`;
  assert.equal((await request(port, {
    method: 'POST',
    path: '/api/workspace/getRoot',
    origin: primaryOrigin,
    body: oversized,
  })).status, 413);

  const resolved = await request(port, {
    method: 'POST',
    path: '/api/preview/resolveHtmlFile',
    origin: primaryOrigin,
    body: { path: 'site/index.html' },
  });
  assert.equal(resolved.status, 200);
  const capability = JSON.parse(resolved.body);
  const previewUrl = new URL(capability.url);
  assert.equal(previewUrl.hostname, 'localhost');
  const preview = await request(port, {
    path: `${previewUrl.pathname}`,
    host: `localhost:${port}`,
    origin: previewOrigin,
  });
  assert.equal(preview.status, 200);
  assert.match(preview.body, /Isolated preview/);
  assert.equal((await request(port, { path: previewUrl.pathname })).status, 403);
  const hidden = await request(port, {
    path: `${previewUrl.pathname.replace(/index\.html$/, '.env')}`,
    host: `localhost:${port}`,
    origin: previewOrigin,
  });
  assert.equal(hidden.status, 403);
});
