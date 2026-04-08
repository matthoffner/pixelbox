const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const workspaceRoot = '/Users/matthoffner/workspace/pxcode';
const packagedAsarPath = path.join(
  workspaceRoot,
  'dist',
  'mac-arm64',
  'Pixelbox.app',
  'Contents',
  'Resources',
  'app.asar'
);
const electronExecutable = path.join(
  workspaceRoot,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron'
);

async function closeApp(app) {
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {}
}

test('playwright packaged: launches and terminal executes a command', { timeout: 180000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_PACKAGED) {
    t.skip('Set RUN_PLAYWRIGHT_PACKAGED=1 to run packaged Electron Playwright smoke test');
    return;
  }

  let app;
  try {
    app = await electron.launch({
      executablePath: electronExecutable,
      args: [packagedAsarPath],
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        PXCODE_DISABLE_AUTO_TUI: '1',
      },
    });
  } catch (error) {
    t.skip(`Unable to launch packaged app: ${error.message}`);
    return;
  }

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#chat-panel.open', { timeout: 30000 });
    await window.waitForSelector('#terminal', { timeout: 30000 });
    const appPath = await app.evaluate(async ({ app }) => app.getAppPath());
    assert.match(appPath, /dist\/mac-arm64\/Pixelbox\.app\/Contents\/Resources\/app\.asar$/);

    await window.screenshot({
      path: path.join(workspaceRoot, 'screenshots', 'packaged-smoke-initial.png'),
      fullPage: true,
    });

    await window.evaluate(async () => {
      await window.api.startTerminal('.');
      window.api.resizeTerminal(120, 30);
      window.api.writeTerminal('echo __PACKAGED_SMOKE_OK__\\n');
    });

    await window.waitForFunction(
      () => (window.__pwTerminalOutput || '').includes('__PACKAGED_SMOKE_OK__'),
      undefined,
      { timeout: 60000 }
    );

    const terminalTail = await window.evaluate(() =>
      (window.__pwTerminalOutput || '')
        .split('\n')
        .slice(-50)
        .join('\n')
    );

    await window.screenshot({
      path: path.join(workspaceRoot, 'screenshots', 'packaged-smoke-terminal.png'),
      fullPage: true,
    });

    assert.match(terminalTail, /__PACKAGED_SMOKE_OK__/);
  } finally {
    await closeApp(app);
  }
});
