const { _electron: electron } = require('playwright');
const path = require('node:path');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, PXCODE_DISABLE_AUTO_TUI: '1' } });
  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel.open');
    await w.click('#chat-dock-right');
    await w.waitForTimeout(700);
    await w.click('#terminal');
    await w.keyboard.type('echo __DOCK_RIGHT_OK__', { delay: 5 });
    await w.keyboard.press('Enter');
    let ok = false;
    try {
      await w.waitForFunction(() => (window.__pwTerminalOutput || '').includes('__DOCK_RIGHT_OK__'), undefined, { timeout: 15000 });
      ok = true;
    } catch {}
    await w.screenshot({ path: path.join(cwd, 'screenshots', 'dock-right-probe.png'), fullPage: true });
    const tail = await w.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-30).join('\n'));
    console.log('DOCK_RIGHT_OK', ok);
    console.log('TAIL_START');
    console.log(tail);
    console.log('TAIL_END');
  } finally {
    await app.close().catch(()=>{});
  }
})();
