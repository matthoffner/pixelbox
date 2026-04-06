const { _electron: electron } = require('playwright');
const path = require('node:path');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const shotsDir = path.join(cwd, 'screenshots');
  const fs = require('node:fs/promises');
  await fs.mkdir(shotsDir, { recursive: true });

  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });

    await win.screenshot({ path: path.join(shotsDir, 'view-01-initial.png'), fullPage: true });

    await win.waitForTimeout(4000);
    await win.screenshot({ path: path.join(shotsDir, 'view-02-after-autostart.png'), fullPage: true });

    await win.click('#terminal');
    await win.keyboard.type('echo __SCREEN_TEST__');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(2000);

    await win.screenshot({ path: path.join(shotsDir, 'view-03-after-typing.png'), fullPage: true });

    const tail = await win.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-120).join('\n'));
    const backend = await win.evaluate(() => window.__terminalBackend || 'unknown');
    console.log('BACKEND', backend);
    console.log('---TAIL_START---');
    console.log(tail);
    console.log('---TAIL_END---');
    console.log('SHOTS', shotsDir);
  } finally {
    await app.close().catch(() => {});
  }
})();
