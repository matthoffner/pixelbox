const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

(async () => {
  const cwd = process.cwd();
  const outDir = path.join(cwd, 'screenshots', `switch-check-${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const app = await electron.launch({ args: ['.'], cwd });
  try {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('#chat-panel.open', { timeout: 30000 });

    const panelHidden = await w.evaluate(() => document.body.classList.contains('projects-panel-hidden'));
    if (panelHidden) {
      await w.click('#projects-toggle');
      await w.waitForTimeout(300);
    }

    const buttons = w.locator('#projects-list .project-btn');
    const count = await buttons.count();
    if (count < 2) throw new Error(`Expected >=2 projects, got ${count}`);

    const snap = async (name) => {
      const state = await w.evaluate(() => ({
        active: document.getElementById('active-project')?.textContent || '',
        status: document.getElementById('running-page-status')?.textContent || '',
        source: document.getElementById('running-page-type')?.value || '',
        url: document.getElementById('preview-url')?.textContent || '',
        bodyClass: document.body.className,
      }));
      const shot = path.join(outDir, `${name}.png`);
      await w.screenshot({ path: shot, fullPage: true });
      return { ...state, screenshot: shot };
    };

    await buttons.nth(0).click();
    await w.waitForTimeout(1200);
    const first = await snap('first');

    await buttons.nth(1).click();
    await w.waitForTimeout(1800);
    const second = await snap('second');

    const payload = { outDir, first, second };
    await fs.writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await app.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
