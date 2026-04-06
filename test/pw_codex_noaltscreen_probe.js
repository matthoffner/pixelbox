const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
      PXCODE_TUI_COMMAND: 'codex --no-alt-screen',
    },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(5000);

    await win.click('#terminal');
    await win.keyboard.type('hello from embedded terminal');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(3000);

    const tail = await win.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-120).join('\n'));
    console.log('---NOALT_TAIL_START---');
    console.log(tail);
    console.log('---NOALT_TAIL_END---');
  } finally {
    await app.close().catch(() => {});
  }
})();
