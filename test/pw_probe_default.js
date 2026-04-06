const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
    },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(5000);

    const output = await win.evaluate(() => window.__pwTerminalOutput || '');
    const tail = output.split('\n').slice(-60).join('\n');
    console.log('---DEFAULT_TUI_TAIL_START---');
    console.log(tail);
    console.log('---DEFAULT_TUI_TAIL_END---');
  } finally {
    try { await app.close(); } catch {}
  }
})();
