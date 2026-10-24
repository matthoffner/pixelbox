const { chromium } = require('playwright');

function json(route, value, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  });
}

async function main() {
  if (process.env.PW_MUNDER_TERMINAL_ROUTING !== '1') {
    console.log('Skipping Office terminal routing probe. Set PW_MUNDER_TERMINAL_ROUTING=1 to run it.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    window.localStorage.setItem('pixelbox.lastSelectedProject', '.');
    window.localStorage.setItem('pixelbox.workspaceView', 'project');
    const listeners = new Map();
    window.__nativeInvokes = [];
    window.zero = {
      invoke: async (command, payload) => {
        window.__nativeInvokes.push({ command, payload });
        if (command === 'pixelbox.terminal.setPanelState') {
          const callbacks = listeners.get('pixelbox.terminal.sessions') || [];
          const inventory = {
            sessions: [
              { owner: 'native', key: 'projects/fixture-a', tty: '/dev/ttys101', foregroundPid: 1111 },
              { owner: 'native', key: 'projects/fixture-b', tty: '/dev/ttys202', foregroundPid: 2222 },
            ],
          };
          for (const callback of callbacks) callback(inventory);
        }
        return { ok: true };
      },
      on: (name, callback) => {
        const callbacks = listeners.get(name) || [];
        callbacks.push(callback);
        listeners.set(name, callbacks);
        return () => {};
      },
      off() {},
      _complete() {},
      _emit() {},
    };
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    const pathname = new URL(request.url()).pathname;
    const body = request.postDataJSON() || {};
    if (pathname === '/api/codexMonitor/list') {
      await json(route, [
        { pid: 1111, ppid: 100, cpu: 1.2, mem: 0.1, elapsed: '00:10', cli: 'codex', kind: 'ui', command: 'codex' },
        { pid: 2222, ppid: 200, cpu: 2.3, mem: 0.2, elapsed: '00:20', cli: 'claude', kind: 'agent', command: 'claude' },
        { pid: 3333, ppid: 300, cpu: 0.1, mem: 0.1, elapsed: '00:30', cli: 'gemini', kind: 'agent', command: 'gemini' },
        { pid: 4444, ppid: 400, cpu: 0.4, mem: 0.1, elapsed: '00:40', cli: 'openclaw', kind: 'agent', command: 'openclaw' },
      ]);
      return;
    }
    if (pathname === '/api/codexMonitor/details') {
      const cwdByPid = {
        1111: '/tmp/pixelbox-fixture/projects/fixture-a',
        2222: '/tmp/pixelbox-fixture/projects/fixture-b',
        3333: '/tmp/external-agent',
        4444: '/tmp/pixelbox-fixture/projects/fixture-a',
      };
      await json(route, { cwd: cwdByPid[body.pid] || '/tmp/pixelbox-fixture' });
      return;
    }
    if (pathname === '/api/terminal/resolveForPid') {
      if (body.pid === 4444) {
        await json(route, {
          pid: 4444,
          ppid: 400,
          pgid: 4444,
          tty: 'ttys404',
          ancestors: [4444, 400],
          target: { owner: 'bridge', key: 'watchdog:projects/fixture-a', kind: 'watchdog' },
        });
        return;
      }
      const ttyByPid = { 1111: 'ttys101', 2222: 'ttys202', 3333: 'ttys999' };
      await json(route, {
        pid: body.pid,
        ppid: body.pid - 1,
        pgid: body.pid,
        tty: ttyByPid[body.pid] || null,
        ancestors: [body.pid],
        target: null,
      });
      return;
    }
    if (pathname === '/api/fs/listDir' && body.path === 'projects') {
      await json(route, [
        { name: 'fixture-a', path: 'projects/fixture-a', type: 'directory' },
        { name: 'fixture-b', path: 'projects/fixture-b', type: 'directory' },
      ]);
      return;
    }
    if (pathname === '/api/workspace/resolvePath') {
      const suffix = body.path === '.' ? '' : `/${body.path}`;
      await json(route, `/tmp/pixelbox-fixture${suffix}`);
      return;
    }
    if (pathname === '/api/workspace/listExternalProjects') {
      await json(route, []);
      return;
    }
    if (pathname === '/api/fs/readFile') {
      await json(route, '{}');
      return;
    }
    if (pathname === '/api/preview/getLog') {
      await json(route, { log: '' });
      return;
    }
    if (pathname === '/api/terminal/getStartupCommand') {
      await json(route, '');
      return;
    }
    if (pathname === '/api/supervisor/getPreferredCli') {
      await json(route, { cli: 'codex' });
      return;
    }
    await json(route, { ok: true, running: false, sourceType: 'none' });
  });

  await page.goto('http://127.0.0.1:3210/renderer/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#munder-view-toggle').click();
  const office = page.frameLocator('#munder-frame');
  await office.getByRole('button', { name: /Inspect Claude 2222/ }).click();
  const openButton = office.locator('#open-terminal');
  await openButton.waitFor({ state: 'visible' });
  if (await openButton.isDisabled()) throw new Error('Expected the selected managed agent terminal to be available.');
  await openButton.click();

  await page.waitForFunction(() => window.localStorage.getItem('pixelbox.lastSelectedProject') === 'projects/fixture-b');
  await page.waitForFunction(() => {
    const panelCalls = (window.__nativeInvokes || []).filter(
      (entry) => entry.command === 'pixelbox.terminal.setPanelState' && entry.payload?.visible
    );
    return panelCalls.some((entry) => entry.payload.projectPath === 'projects/fixture-b');
  });
  const routedPanelPayload = await page.evaluate(() => {
    const panelCalls = (window.__nativeInvokes || []).filter(
      (entry) =>
        entry.command === 'pixelbox.terminal.setPanelState' &&
        entry.payload?.visible &&
        entry.payload?.projectPath === 'projects/fixture-b'
    );
    return panelCalls[panelCalls.length - 1]?.payload || null;
  });
  if (routedPanelPayload?.startupCommand) {
    throw new Error('Routing to an existing agent terminal must not replace it with a new startup command.');
  }

  await page.locator('#chat-minimize').evaluate((button) => button.click());
  await office.getByRole('button', { name: /Inspect Gemini 3333/ }).click();
  if (!(await openButton.isDisabled())) {
    throw new Error('Expected an external agent terminal to remain unavailable instead of falling back.');
  }
  const unavailable = await office.locator('#terminal-status').textContent();
  if (!/outside a Pixelbox-managed terminal/i.test(unavailable || '')) {
    throw new Error(`Expected an unmanaged-terminal explanation, got: ${unavailable}`);
  }

  await office.getByRole('button', { name: /Inspect OpenClaw 4444/ }).click();
  if (await openButton.isDisabled()) throw new Error('Expected the watchdog terminal to be available.');
  await openButton.click();
  await page.waitForFunction(() => {
    return (
      window.localStorage.getItem('pixelbox.lastSelectedProject') === 'projects/fixture-a' &&
      document.body.dataset.workspaceView === 'project' &&
      !document.getElementById('chat-panel')?.classList.contains('open')
    );
  });
  if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join('; ')}`);

  await browser.close();
  console.log('Office terminal routing probe passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
