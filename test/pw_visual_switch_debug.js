const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

async function main() {
  const cwd = process.cwd();
  const stamp = Date.now();
  const outDir = path.join(cwd, 'screenshots', 'visual-debug');
  await fs.mkdir(outDir, { recursive: true });

  let app;
  try {
    app = await electron.launch({
      args: ['.'],
      cwd,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
      },
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 120000 });
    await win.waitForSelector('#preview-shell', { timeout: 120000 });

    const beforeShot = path.join(outDir, `switch-${stamp}-01-before.png`);
    await win.screenshot({ path: beforeShot, fullPage: true });

    const buttons = await win.locator('.project-btn').allTextContents();
    const targets = buttons.map((label) => label.trim()).filter(Boolean).filter((label) => label !== 'workspace');
    const target = targets[0];

    if (!target) {
      console.log('[warn] no non-workspace project found to switch to');
      console.log(`[screenshot] ${beforeShot}`);
      return;
    }

    await win.locator(`.project-btn:has-text("${target}")`).first().click();
    await win.waitForFunction(
      (label) => {
        const el = document.getElementById('active-project');
        return Boolean(el && el.textContent && el.textContent.toLowerCase().includes(label.toLowerCase()));
      },
      target,
      { timeout: 30000 }
    );

    const switchedShot = path.join(outDir, `switch-${stamp}-02-switched.png`);
    await win.screenshot({ path: switchedShot, fullPage: true });

    await win.locator('.project-btn:has-text("workspace")').first().click();
    await win.waitForFunction(() => {
      const el = document.getElementById('active-project');
      return Boolean(el && el.textContent && el.textContent.includes('workspace root'));
    }, undefined, { timeout: 30000 });

    const backShot = path.join(outDir, `switch-${stamp}-03-back-workspace.png`);
    await win.screenshot({ path: backShot, fullPage: true });

    const active = await win.locator('#active-project').textContent();
    console.log(`[target] ${target}`);
    console.log(`[active] ${active}`);
    console.log(`[screenshot] ${beforeShot}`);
    console.log(`[screenshot] ${switchedShot}`);
    console.log(`[screenshot] ${backShot}`);
  } finally {
    if (app) await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

