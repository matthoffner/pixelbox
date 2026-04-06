const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(3500);
    const backend = await win.evaluate(() => window.__terminalBackend || 'unknown');
    const tail = await win.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-40).join('\n'));
    console.log('BACKEND', backend);
    console.log('---TAIL---');
    console.log(tail);
    console.log('---END---');
  } finally {
    try { await app.close(); } catch {}
  }
})();
