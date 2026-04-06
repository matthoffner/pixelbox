const { _electron: electron } = require('playwright');

(async () => {
  const app = await electron.launch({ args: ['.'], cwd: '/Users/matthoffner/workspace/pxcode', env: { ...process.env } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(9000);

    const before = await win.evaluate(() => (window.__pwTerminalOutput || '').slice(-20000));
    const codexUi = before.includes('chatgpt.com/codex') || before.includes('[>7u') || before.includes('\u001b[>7u');

    await win.click('#terminal');
    await win.keyboard.type('typing check');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(3500);

    const after = await win.evaluate(() => (window.__pwTerminalOutput || '').slice(-20000));
    const panic = after.includes('The application panicked (crashed).');

    console.log('CODEX_UI', codexUi);
    console.log('PANIC', panic);
    console.log('---TAIL---');
    console.log(after.split('\n').slice(-120).join('\n'));
  } finally {
    await app.close().catch(()=>{});
  }
})();
