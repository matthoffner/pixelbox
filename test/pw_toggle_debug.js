const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

async function main() {
  const cwd = process.cwd();
  const out = path.join(cwd, 'screenshots', 'visual-debug');
  await fs.mkdir(out, { recursive: true });
  const stamp = Date.now();

  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });

  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#running-page-panel', { timeout: 120000 });

    const overview = path.join(out, `layout-${stamp}-overview.png`);
    const preview = path.join(out, `layout-${stamp}-preview.png`);
    await w.screenshot({ path: overview, fullPage: true });
    await w.click('#running-page-type');
    await w.selectOption('#running-page-type', 'server');
    await w.waitForTimeout(200);
    await w.screenshot({ path: preview, fullPage: true });

    console.log(overview);
    console.log(preview);
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
