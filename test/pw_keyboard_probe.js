const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, PXCODE_DISABLE_AUTO_TUI: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(1000);

    const before = await win.evaluate(() => ({
      activeTag: document.activeElement ? document.activeElement.tagName : null,
      activeClass: document.activeElement ? document.activeElement.className : null,
      helperCount: document.querySelectorAll('.xterm-helper-textarea').length,
      terminalBackend: window.__terminalBackend,
    }));

    await win.click('#terminal');
    await win.keyboard.type('echo __KEYBOARD_OK__');
    await win.keyboard.press('Enter');

    await win.waitForFunction(() => (window.__pwTerminalOutput || '').includes('__KEYBOARD_OK__'), undefined, { timeout: 15000 });

    const after = await win.evaluate(() => ({
      activeTag: document.activeElement ? document.activeElement.tagName : null,
      activeClass: document.activeElement ? document.activeElement.className : null,
      tail: (window.__pwTerminalOutput || '').split('\n').slice(-25).join('\n'),
    }));

    console.log('BEFORE', JSON.stringify(before));
    console.log('AFTER', JSON.stringify(after));
  } finally {
    await app.close().catch(() => {});
  }
})();
