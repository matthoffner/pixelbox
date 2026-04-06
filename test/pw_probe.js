const { _electron: electron } = require('playwright');
const path = require('node:path');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
      PXCODE_TUI_COMMAND: 'echo __AUTO_TUI_OK__',
    },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 20000 });

    const run = async (cmd, marker, timeout = 30000) => {
      await win.fill('#chat-input', `${cmd}; echo ${marker}`);
      await win.press('#chat-input', 'Enter');
      await win.waitForFunction(
        (m) => (window.__pwTerminalOutput || '').includes(m),
        marker,
        { timeout }
      );
    };

    await win.waitForFunction(() => (window.__pwTerminalOutput || '').includes('__AUTO_TUI_OK__'), undefined, { timeout: 20000 });
    await run('pwd', '__MARK_PWD__');
    await run('ls -1 | head -n 8', '__MARK_LS__');
    await run('command -v openclaw || true', '__MARK_OPENCLAW__');
    await run('command -v codex || true', '__MARK_CODEX__');

    const output = await win.evaluate(() => window.__pwTerminalOutput || '');
    const tail = output.split('\n').slice(-100).join('\n');

    const screenshotPath = path.join(cwd, 'playwright-interaction.png');
    await win.screenshot({ path: screenshotPath, fullPage: true });

    console.log('---TERMINAL_TAIL_START---');
    console.log(tail);
    console.log('---TERMINAL_TAIL_END---');
    console.log('SCREENSHOT', screenshotPath);
  } finally {
    await app.close().catch(() => {});
    const p = app.process();
    if (p && !p.killed) p.kill('SIGKILL');
  }
})();
