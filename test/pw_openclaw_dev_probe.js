const { _electron: electron } = require('playwright');

(async () => {
  const app = await electron.launch({
    args: ['.'],
    cwd: '/Users/matthoffner/workspace/pxcode',
    env: { ...process.env, PXCODE_TUI_COMMAND: 'openclaw --dev tui' },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(6000);

    const marker = '__DEV_TUI_MARK__';
    await win.evaluate((text) => window.api.writeTerminal(`${text}\n`), `run shell command: echo ${marker}`);
    await win.waitForTimeout(20000);

    const tail = await win.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-120).join('\n'));
    console.log(tail.includes(marker) ? 'MARKER:YES' : 'MARKER:NO');
    console.log('---TAIL---');
    console.log(tail);
  } finally {
    await app.close().catch(() => {});
  }
})();
