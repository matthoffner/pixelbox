const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const out = path.join(cwd, 'screenshots', 'dock-final');
  await fs.mkdir(out, { recursive: true });
  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, PXCODE_DISABLE_AUTO_TUI: '1' } });
  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel.open');
    await w.click('#chat-dock-right');
    await w.waitForTimeout(300);
    await w.screenshot({ path: path.join(out, '01_right.png'), fullPage: true });

    await w.click('#chat-dock-bottom');
    await w.waitForTimeout(300);
    await w.screenshot({ path: path.join(out, '02_bottom.png'), fullPage: true });

    // Drag header to undock/move
    const box = await w.locator('#chat-header').boundingBox();
    if (box) {
      await w.mouse.move(box.x + 50, box.y + 20);
      await w.mouse.down();
      await w.mouse.move(box.x - 220, box.y - 120, { steps: 10 });
      await w.mouse.up();
    }

    await w.waitForTimeout(300);
    await w.screenshot({ path: path.join(out, '03_drag_undock.png'), fullPage: true });

    const state = await w.evaluate(() => ({
      body: document.body.className,
      panelOpen: document.querySelector('#chat-panel')?.classList.contains('open') || false,
      panelRect: (() => {
        const r = document.querySelector('#chat-panel')?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      })(),
      previewRect: (() => {
        const r = document.querySelector('#preview-shell')?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      })(),
    }));
    console.log(JSON.stringify(state));
  } finally {
    await app.close().catch(() => {});
  }
})();
