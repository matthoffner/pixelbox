const { chromium } = require('playwright');

async function main() {
  if (process.env.PW_NATIVE_TERMINAL_PROBE !== '1') {
    console.log('Skipping native terminal Playwright probe. Set PW_NATIVE_TERMINAL_PROBE=1 to run it.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const invokes = [];
  await page.addInitScript(() => {
    const calls = [];
    window.__nativeInvokes = calls;
    window.zero = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return { ok: true };
      },
      _complete() {},
      _emit() {},
    };
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[page:${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto('http://127.0.0.1:3210/renderer/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const invocations = window.__nativeInvokes || [];
    const panelCalls = invocations.filter((entry) => entry.command === 'pixelbox.terminal.setPanelState');
    const visiblePanelCalls = panelCalls.filter((entry) => entry?.payload?.visible);
    const lastPanelCall = panelCalls[panelCalls.length - 1] || null;
    return {
      title: document.title,
      activeProject: document.getElementById('active-project')?.textContent?.trim() || '',
      headline: document.getElementById('headline')?.textContent?.trim() || '',
      panelCallCount: panelCalls.length,
      visiblePanelCalls,
      lastPanelCall,
    };
  });

  console.log(JSON.stringify(state, null, 2));

  const failures = [];
  if (!state.activeProject.toLowerCase().includes('workspace root')) {
    failures.push(`expected active project to include "workspace root", got: ${state.activeProject}`);
  }
  if (state.panelCallCount < 1) {
    failures.push('expected at least one native terminal panel bridge call');
  }
  if (state.visiblePanelCalls.length < 1) {
    failures.push('expected at least one visible native terminal panel bridge call');
  }
  if (state.visiblePanelCalls.some((entry) => !(entry?.payload?.startupCommand || '').trim())) {
    failures.push('expected every visible native terminal payload to include a startupCommand');
  }
  if (!state.lastPanelCall?.payload?.projectPath) {
    failures.push('expected native terminal payload to include a projectPath');
  }
  if (typeof state.lastPanelCall?.payload?.startupCommand !== 'string') {
    failures.push('expected native terminal payload to include startupCommand');
  }

  await browser.close();

  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
