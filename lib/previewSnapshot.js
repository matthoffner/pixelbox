const fs = require('node:fs/promises');
const path = require('node:path');

function validateSnapshotUrl(rawUrl) {
  const url = new URL(String(rawUrl || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Preview Snapshot only supports HTTP and HTTPS URLs.');
  }
  return url.toString();
}

function sanitizePathPart(value, fallback = 'workspace') {
  const cleaned = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function snapshotTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-');
}

function snapshotRelativePath(projectPath = '.', date = new Date()) {
  const filename = `proof-${snapshotTimestamp(date)}.png`;
  if (!projectPath || projectPath === '.') {
    return path.posix.join('.pixelbox', 'proof-snapshots', filename);
  }
  return path.posix.join(projectPath.replace(/\\/g, '/'), '.pixelbox', 'proof-snapshots', filename);
}

function clampViewport(value, fallback, min, max) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

async function capturePreviewSnapshot(rawUrl, options = {}) {
  const url = validateSnapshotUrl(rawUrl);
  if (!options.outputPath) {
    throw new Error('Preview Snapshot output path is required.');
  }
  const outputPath = path.resolve(options.outputPath || '');
  const width = clampViewport(options.width, 1280, 320, 1920);
  const height = clampViewport(options.height, 720, 240, 1600);
  const timeoutMs = clampViewport(options.timeoutMs, 8000, 1000, 30000);
  const waitAfterLoadMs = clampViewport(options.waitAfterLoadMs, 250, 0, 3000);

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Preview Snapshot requires the Playwright package to be installed.');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (waitAfterLoadMs > 0) {
      await page.waitForTimeout(waitAfterLoadMs);
    }
    await page.screenshot({ path: outputPath, type: 'png', fullPage: false });
    const stat = await fs.stat(outputPath);
    return {
      ok: true,
      url: page.url() || url,
      path: options.relativePath || outputPath,
      bytes: stat.size,
      width,
      height,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  capturePreviewSnapshot,
  sanitizePathPart,
  snapshotRelativePath,
  snapshotTimestamp,
  validateSnapshotUrl,
};
