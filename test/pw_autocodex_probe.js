const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(5000);

    const pre = await win.evaluate(() => ({
      backend: window.__terminalBackend,
      activeClass: document.activeElement ? document.activeElement.className : null,
      tail: (window.__pwTerminalOutput || '').split('\n').slice(-60).join('\n'),
    }));

    await win.click('#terminal');
    await win.keyboard.type('echo __AFTER_AUTO__');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(2000);

    const post = await win.evaluate(() => ({
      activeClass: document.activeElement ? document.activeElement.className : null,
      tail: (window.__pwTerminalOutput || '').split('\n').slice(-80).join('\n'),
    }));

    console.log('PRE', JSON.stringify(pre));
    console.log('POST', JSON.stringify(post));
  } finally {
    await app.close().catch(() => {});
  }
})();
