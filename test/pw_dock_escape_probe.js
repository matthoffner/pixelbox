const { _electron: electron } = require('playwright');
const path = require('node:path');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, PXCODE_DISABLE_AUTO_TUI: '1' } });
  const outDir = path.join(cwd, 'screenshots', 'dock-escape');

  const fs = require('node:fs/promises');
  await fs.mkdir(outDir, { recursive: true });

  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel.open', { timeout: 20000 });

    const snap = async (name) => {
      const state = await w.evaluate(() => ({
        body: document.body.className,
        panelOpen: document.querySelector('#chat-panel')?.classList.contains('open') || false,
        panelRect: (() => {
          const el = document.querySelector('#chat-panel');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })(),
        previewRect: (() => {
          const el = document.querySelector('#preview-shell');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })(),
      }));
      console.log(name, JSON.stringify(state));
      await w.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    };

    await snap('01_initial');

    await w.click('#chat-dock-right');
    await w.waitForTimeout(300);
    await snap('02_dock_right');

    await w.click('#chat-dock-float');
    await w.waitForTimeout(300);
    await snap('03_back_to_float');

    await w.click('#chat-dock-bottom');
    await w.waitForTimeout(300);
    await snap('04_dock_bottom');

    await w.click('#chat-minimize');
    await w.waitForTimeout(300);
    await snap('05_minimized');

    await w.click('#chat-toggle');
    await w.waitForTimeout(300);
    await snap('06_reopened');

    // input test in current mode
    await w.click('#terminal');
    await w.keyboard.type('echo __DOCK_ESCAPE_OK__', { delay: 5 });
    await w.keyboard.press('Enter');
    await w.waitForFunction(() => (window.__pwTerminalOutput || '').includes('__DOCK_ESCAPE_OK__'), undefined, { timeout: 15000 });
    await snap('07_terminal_input_ok');

  } finally {
    await app.close().catch(()=>{});
  }
})();
