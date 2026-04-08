const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  const value = Number.parseInt(raw || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

(async () => {
  const cwd = '/Users/matthoffner/workspace/pxcode';
  const intervalMs = intFromEnv('PW_INTERVAL_MS', 10000);
  const cycles = intFromEnv('PW_CYCLES', 6);
  const outDir = path.join(cwd, 'screenshots', `live-cycle-${Date.now()}`);

  await fs.mkdir(outDir, { recursive: true });

  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
      PXCODE_DISABLE_AUTO_TUI: '1',
    },
  });

  const trace = [];

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#chat-panel.open', { timeout: 30000 });

    // Smoke-check terminal input path once so we fail fast.
    const marker = `__LIVE_CYCLE_OK_${Date.now()}__`;
    await win.click('#terminal');
    await win.keyboard.type(`echo ${marker}`, { delay: 5 });
    await win.keyboard.press('Enter');

    let markerSeen = false;
    try {
      await win.waitForFunction(
        (m) => (window.__pwTerminalOutput || '').includes(m),
        marker,
        { timeout: 8000 },
      );
      markerSeen = true;
    } catch {}

    if (!markerSeen) {
      const activeKey = await win.evaluate(async (m) => {
        const activeLabel = (document.getElementById('active-project')?.textContent || '').trim();
        const selected = activeLabel === 'Active: workspace root'
          ? '.'
          : activeLabel.replace(/^Active:\s*/, '') || '.';
        await window.api.startTerminal(selected, { startupCommand: '' });
        await window.api.writeTerminal(`echo ${m}\n`, selected);
        return selected;
      }, marker);

      await win.waitForFunction(
        (m) => (window.__pwTerminalOutput || '').includes(m),
        marker,
        { timeout: 15000 },
      );
      markerSeen = true;
      trace.push({
        step: 'bootstrap',
        at: ts(),
        note: `terminal marker delivered via api.writeTerminal for key=${activeKey}`,
      });
    }

    for (let i = 0; i < cycles; i += 1) {
      const step = i + 1;
      const shotPath = path.join(outDir, `step-${String(step).padStart(2, '0')}.png`);
      await win.screenshot({ path: shotPath, fullPage: true });

      const state = await win.evaluate(() => {
        const rect = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        };

        return {
          title: document.title,
          bodyClass: document.body.className,
          panelRect: rect('#chat-panel'),
          previewRect: rect('#preview-shell'),
          projectsRect: rect('#projects-panel'),
          terminalTail: (window.__pwTerminalOutput || '').split('\n').slice(-12).join('\n'),
        };
      });

      trace.push({
        step,
        at: ts(),
        screenshot: shotPath,
        markerSeen,
        ...state,
      });

      if (step < cycles) {
        await win.waitForTimeout(intervalMs);
      }
    }

    const tracePath = path.join(outDir, 'trace.json');
    await fs.writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify({
      ok: true,
      outDir,
      tracePath,
      cycles,
      intervalMs,
      last: trace[trace.length - 1] || null,
    }, null, 2));
  } catch (error) {
    const failShot = path.join(outDir, 'failure.png');
    try {
      const win = await app.firstWindow();
      await win.screenshot({ path: failShot, fullPage: true });
    } catch {}
    console.error('LIVE_CYCLE_FAIL');
    console.error(error && error.stack ? error.stack : error);
    console.error(`failure_screenshot=${failShot}`);
    process.exitCode = 1;
  } finally {
    await app.close().catch(() => {});
  }
})();
