const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PIXELBOX_VISUAL_LOOP_PORT || 33210);
const baseUrl = `http://127.0.0.1:${port}`;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = process.env.PIXELBOX_VISUAL_LOOP_ARTIFACT_DIR
  ? path.resolve(process.env.PIXELBOX_VISUAL_LOOP_ARTIFACT_DIR)
  : path.join(rootDir, 'screenshots', `visual-loop-e2e-${runId}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(pathname, body = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${pathname}`);
  }
  return payload;
}

async function waitForHealth(serverProcess) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Pixelbox backend exited early with code ${serverProcess.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

async function waitForCaptureRegion(predicate = () => true) {
  const startedAt = Date.now();
  let lastRegion = null;
  while (Date.now() - startedAt < 8000) {
    lastRegion = await postJson('/api/preview/getCaptureRegion');
    if (
      lastRegion.visible &&
      lastRegion.width > 0 &&
      lastRegion.height > 0 &&
      predicate(lastRegion)
    ) {
      return lastRegion;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for visible preview capture region. Last region: ${JSON.stringify(lastRegion)}`);
}

async function main() {
  if (process.env.PW_VISUAL_LOOP_VIDEO !== '1') {
    console.log('Skipping visual loop Playwright video probe. Set PW_VISUAL_LOOP_VIDEO=1 to run it.');
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });

  const serverProcess = spawn(process.execPath, ['bridge/server.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PIXELBOX_BACKEND_PORT: String(port),
      PXCODE_DISABLE_AUTO_TUI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLogs = [];
  serverProcess.stdout.on('data', (chunk) => serverLogs.push(chunk.toString()));
  serverProcess.stderr.on('data', (chunk) => serverLogs.push(chunk.toString()));

  let browser;
  let context;
  let videoPath = '';

  try {
    await waitForHealth(serverProcess);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      recordVideo: {
        dir: artifactDir,
        size: { width: 1280, height: 900 },
      },
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    await page.goto(`${baseUrl}/renderer/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#preview-viewport', { state: 'visible' });

    const baselineRegion = await waitForCaptureRegion();
    const baselinePath = path.join(artifactDir, 'visual-loop-01.png');
    await page.screenshot({ path: baselinePath, fullPage: false });

    await page.locator('#projects-minimize').click();
    await page.setViewportSize({ width: 1100, height: 760 });

    const changedRegion = await waitForCaptureRegion((region) => (
      region.updatedAt > baselineRegion.updatedAt &&
      (region.width !== baselineRegion.width || region.height !== baselineRegion.height)
    ));
    const changedPath = path.join(artifactDir, 'visual-loop-02.png');
    await page.screenshot({ path: changedPath, fullPage: false });

    if (pageErrors.length) {
      throw new Error(`Browser errors during visual loop probe:\n${pageErrors.join('\n')}`);
    }

    videoPath = await page.video().path();
    await context.close();
    context = null;
    await browser.close();
    browser = null;

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      artifactDir,
      baselineScreenshot: baselinePath,
      changedScreenshot: changedPath,
      video: videoPath,
      baselineRegion,
      changedRegion,
    }, null, 2));
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    serverProcess.kill('SIGTERM');
    await sleep(100);
    if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL');
  }

  if (!videoPath) {
    throw new Error(`Playwright did not produce a video. Server logs:\n${serverLogs.join('')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
