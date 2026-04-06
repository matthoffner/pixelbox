const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

async function main() {
  const cwd = process.cwd();
  const outDir = path.join(cwd, 'screenshots', 'live-capture');
  await fs.mkdir(outDir, { recursive: true });

  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 120000 });
    await win.screenshot({ path: path.join(outDir, 'live-01-open.png'), fullPage: true });
    await win.waitForTimeout(3000);
    await win.screenshot({ path: path.join(outDir, 'live-02-after-3s.png'), fullPage: true });
    console.log(path.join(outDir, 'live-01-open.png'));
    console.log(path.join(outDir, 'live-02-after-3s.png'));
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
