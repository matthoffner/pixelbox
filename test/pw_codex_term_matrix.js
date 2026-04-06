const { _electron: electron } = require('playwright');

async function run(term) {
  const app = await electron.launch({
    args: ['.'],
    cwd: '/Users/matthoffner/workspace/pxcode',
    env: { ...process.env, PXCODE_TERM: term },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });
    await win.waitForTimeout(5000);

    await win.click('#terminal');
    await win.keyboard.type('term test');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(2500);

    const tail = await win.evaluate(() => (window.__pwTerminalOutput || '').slice(-12000));
    const panic = tail.includes('The application panicked (crashed).');
    const stdinErr = tail.includes('stdin is not a terminal');
    console.log(`TERM=${term} PANIC=${panic} STDIN=${stdinErr}`);
  } finally {
    await app.close().catch(() => {});
  }
}

(async () => {
  for (const term of ['xterm-256color', 'xterm', 'screen', 'ansi', 'vt100', 'dumb']) {
    await run(term);
  }
})();
