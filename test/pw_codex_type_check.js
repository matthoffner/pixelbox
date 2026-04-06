const { _electron: electron } = require('playwright');

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: '/Users/matthoffner/workspace/pxcode', env: { ...process.env } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open');
    await win.waitForTimeout(5000);

    await win.click('#terminal');
    await win.keyboard.type('test input');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(3000);

    const tail = await win.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-160).join('\n'));
    console.log(tail.includes('The application panicked (crashed).') ? 'PANIC:YES' : 'PANIC:NO');
    console.log(tail.includes('stdin is not a terminal') ? 'STDIN:YES' : 'STDIN:NO');
    console.log('---TAIL---');
    console.log(tail);
  } finally {
    await app.close().catch(()=>{});
  }
})();
