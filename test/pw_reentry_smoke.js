const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

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

async function waitForOutput(child, outputRef, pattern, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pattern.test(outputRef.value)) return;
    if (child.exitCode != null) throw new Error(`Bridge exited early:\n${outputRef.value}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for bridge:\n${outputRef.value}`);
}

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-reentry-smoke-'));
  const port = await reservePort();
  const primaryOrigin = `http://127.0.0.1:${port}`;
  const previewOrigin = `http://localhost:${port}`;
  const indexPath = path.join(workspace, 'index.html');
  await fs.writeFile(indexPath, `<!doctype html>
<html><body><h1>Reentry smoke</h1><script>
window.attackResult = { parentBlocked: false, apiBlocked: false, done: false };
try { void parent.document.body; } catch { window.attackResult.parentBlocked = true; }
fetch('${primaryOrigin}/api/workspace/getRoot', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
}).then(() => { window.attackResult.done = true; }).catch(() => {
  window.attackResult.apiBlocked = true;
  window.attackResult.done = true;
});
</script></body></html>`);

  const output = { value: '' };
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
  child.stdout.on('data', (chunk) => { output.value += chunk; });
  child.stderr.on('data', (chunk) => { output.value += chunk; });

  let browser;
  try {
    await waitForOutput(child, output, /Pixelbox backend ready/);
    console.log(`${primaryOrigin}/renderer/index.html`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${primaryOrigin}/renderer/index.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.__smokeWorkspaceChanges = [];
      const events = new EventSource(`${window.location.origin}/api/events`);
      events.addEventListener('workspace:changed', (event) => {
        window.__smokeWorkspaceChanges.push(JSON.parse(event.data || '{}'));
      });
      window.__smokeEventSource = events;
    });
    await page.waitForFunction((origin) => {
      const frame = document.querySelector('#preview-frame');
      return frame && frame.src.startsWith(origin);
    }, previewOrigin, { timeout: 12000 });

    const previewFrame = page.frames().find((frame) => frame.url().startsWith(previewOrigin));
    assert.ok(previewFrame, 'isolated static preview frame loaded');
    await previewFrame.waitForFunction(() => window.attackResult?.done);
    const attackResult = await previewFrame.evaluate(() => window.attackResult);
    assert.equal(attackResult.parentBlocked, true);
    assert.equal(attackResult.apiBlocked, true);

    await page.waitForSelector('#proof-verify:not([disabled])', { timeout: 12000 });
    await page.click('#proof-verify');
    try {
      await page.waitForFunction(() => document.querySelector('#proof-status')?.textContent.startsWith('Ready'), null, {
        timeout: 30000,
      });
    } catch (error) {
      console.error(await page.evaluate(() => ({
        status: document.querySelector('#proof-status')?.textContent,
        check: document.querySelector('#proof-check-status')?.textContent,
        action: document.querySelector('#proof-copy-status')?.textContent,
        proof: window.__pwProofSnapshot,
      })));
      console.error(pageErrors);
      console.error(output.value);
      throw error;
    }
    const readyStatus = await page.textContent('#proof-status');
    assert.match(readyStatus, /^Ready/);
    await page.waitForTimeout(750);
    const stableStatus = await page.textContent('#proof-status');
    if (!/^Ready/.test(stableStatus)) {
      console.error(await page.evaluate(() => window.__smokeWorkspaceChanges));
    }
    assert.match(stableStatus, /^Ready/);

    await fs.writeFile(indexPath, '<!doctype html><html><body><h1>Changed after Verify</h1></body></html>');
    await page.waitForFunction(() => document.querySelector('#proof-status')?.textContent.startsWith('Proof stale'), null, {
      timeout: 8000,
    });
    const staleStatus = await page.textContent('#proof-status');
    assert.match(staleStatus, /^Proof stale/);
    assert.deepEqual(pageErrors, []);
    console.log(`Reentry smoke passed: ${readyStatus} -> ${staleStatus}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
