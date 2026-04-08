const { _electron: electron } = require('playwright');
(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const app = await electron.launch({ args:['.'], cwd, env:{...process.env, PXCODE_DISABLE_AUTO_TUI:'1'} });
  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel', { timeout: 20000 });
    const state = await w.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
      };
      return {
        bodyClass: document.body.className,
        panelOpen: document.querySelector('#chat-panel')?.classList.contains('open') || false,
        previewShell: rect('#preview-shell'),
        previewViewport: rect('#preview-viewport'),
        chatPanel: rect('#chat-panel'),
        projectsPanel: rect('#projects-panel')
      };
    });
    console.log(JSON.stringify(state));
  } finally {
    await app.close().catch(()=>{});
  }
})();
