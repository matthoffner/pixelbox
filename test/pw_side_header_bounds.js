const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, PXCODE_DISABLE_AUTO_TUI: '1' } });
  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel.open');
    await w.click('#chat-dock-right');
    await w.waitForTimeout(300);

    // Drag resize handle right to force minimum width.
    const handle = await w.locator('#chat-resize-handle').boundingBox();
    if (handle) {
      await w.mouse.move(handle.x + 4, handle.y + 20);
      await w.mouse.down();
      await w.mouse.move(handle.x + 600, handle.y + 20, { steps: 10 });
      await w.mouse.up();
    }

    const result = await w.evaluate(() => {
      const panel = document.querySelector('#chat-panel');
      const buttons = [...document.querySelectorAll('.chat-header-actions .panel-icon-button')];
      const p = panel.getBoundingClientRect();
      const bounds = buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      const allInside = bounds.every((r) => r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom);
      return {
        panel: { left: p.left, right: p.right, width: p.width },
        buttonCount: bounds.length,
        allInside,
        body: document.body.className,
      };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close().catch(() => {});
  }
})();
