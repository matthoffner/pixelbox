const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
      FORCE_STDIO_TERMINAL: '1',
    },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(7000);
    const output = await win.evaluate(() => window.__pwTerminalOutput || '');
    console.log('---TTY_ISSUE_START---');
    console.log(output.split('\n').slice(-120).join('\n'));
    console.log('---TTY_ISSUE_END---');
  } finally {
    try { await app.close(); } catch {}
  }
})();
