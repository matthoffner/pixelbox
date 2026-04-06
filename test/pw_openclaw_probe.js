const { _electron: electron } = require('playwright');

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: '/Users/matthoffner/workspace/pxcode', env: { ...process.env } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(7000);

    await win.click('#terminal');
    await win.keyboard.type('hello openclaw');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(2500);

    const tail = await win.evaluate(() => (window.__pwTerminalOutput || '').slice(-20000));
    const panic = tail.includes('The application panicked (crashed).');
    console.log('PANIC', panic);
    console.log('---TAIL---');
    console.log(tail.split('\n').slice(-100).join('\n'));
  } finally {
    await app.close().catch(()=>{});
  }
})();
