const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

(async () => {
  const cwd = process.cwd();
  const outDir = path.join(cwd, 'screenshots', `rapid-switch-${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const app = await electron.launch({ args: ['.'], cwd });
  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel.open', { timeout: 30000 });

    const hidden = await w.evaluate(() => document.body.classList.contains('projects-panel-hidden'));
    if (hidden) {
      await w.click('#projects-toggle');
      await w.waitForTimeout(200);
    }

    const buttons = w.locator('#projects-list .project-btn');
    const count = await buttons.count();
    if (count < 2) throw new Error(`need >=2 projects, got ${count}`);

    for (let i = 0; i < 6; i += 1) {
      await buttons.nth(i % 2).click();
      await w.waitForTimeout(500);
    }

    const state = await w.evaluate(() => ({
      active: document.getElementById('active-project')?.textContent || '',
      source: document.getElementById('running-page-type')?.value || '',
      status: document.getElementById('running-page-status')?.textContent || '',
      url: document.getElementById('preview-url')?.textContent || '',
      bodyClass: document.body.className,
      tailLen: (window.__pwTerminalOutput || '').length,
    }));

    const shot = path.join(outDir, 'final.png');
    await w.screenshot({ path: shot, fullPage: true });
    console.log(JSON.stringify({ outDir, shot, state }, null, 2));
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
