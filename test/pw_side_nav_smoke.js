const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const outDir = path.join(cwd, 'screenshots', 'side-nav-smoke');
  await fs.mkdir(outDir, { recursive: true });

  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: { ...process.env, PXCODE_DISABLE_AUTO_TUI: '1' },
  });

  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel.open', { timeout: 30000 });

    await w.click('#chat-dock-right');
    await w.waitForTimeout(500);

    // Terminal smoke
    await w.click('#terminal');
    await w.keyboard.type('echo __SIDE_DOCK_OK__', { delay: 5 });
    await w.keyboard.press('Enter');
    await w.waitForFunction(() => (window.__pwTerminalOutput || '').includes('__SIDE_DOCK_OK__'), undefined, { timeout: 20000 });

    const state = await w.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
      };
      const bodyClass = document.body.className;
      const previewRect = rect('#preview-shell');
      const viewportRect = rect('#preview-viewport');
      const panelRect = rect('#chat-panel');
      const projectsRect = rect('#projects-panel');
      const terminalTail = (window.__pwTerminalOutput || '').split('\n').slice(-20).join('\n');
      return { bodyClass, previewRect, viewportRect, panelRect, projectsRect, terminalTail };
    });

    const shot = path.join(outDir, 'dock-right-smoke.png');
    await w.screenshot({ path: shot, fullPage: true });

    console.log(JSON.stringify({
      screenshot: shot,
      ...state,
      terminalOk: state.terminalTail.includes('__SIDE_DOCK_OK__'),
      previewPositiveSize: Boolean(state.previewRect && state.previewRect.w > 0 && state.previewRect.h > 0),
      viewportPositiveSize: Boolean(state.viewportRect && state.viewportRect.w > 0 && state.viewportRect.h > 0),
    }, null, 2));
  } finally {
    await app.close().catch(() => {});
  }
})();
