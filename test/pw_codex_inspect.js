const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

const workspaceRoot = process.cwd();
const shotDir = path.join(workspaceRoot, 'screenshots', 'codex-inspect');

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function shot(window, name) {
  await fs.mkdir(shotDir, { recursive: true });
  await window.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
}

async function terminalTail(window, lines = 80) {
  const raw = await window.evaluate((n) => (window.__pwTerminalOutput || '').split('\n').slice(-n).join('\n'), lines);
  return raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

async function typeAndRun(window, text) {
  await window.click('#terminal');
  await window.keyboard.type(text, { delay: 3 });
  await window.keyboard.press('Enter');
}

async function waitForOutputGrowth(window, previousLength, timeoutMs = 45000) {
  await window.waitForFunction(
    ({ baseline }) => (window.__pwTerminalOutput || '').length > baseline + 20,
    { baseline: previousLength },
    { timeout: timeoutMs }
  );
}

async function main() {
  let app;
  try {
    app = await electron.launch({
      args: ['.'],
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        PXCODE_DISABLE_AUTO_TUI: '1',
      },
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#chat-panel.open');
    await shot(window, '01-open');

    await window.evaluate(async () => {
      await window.api.startOrRestartTerminal('.', true);
      window.api.resizeTerminal(120, 30);
    });
    await shot(window, '02-terminal-started');

    let baseline = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
    await typeAndRun(window, 'codex --help');
    await waitForOutputGrowth(window, baseline, 45000);
    await shot(window, '03-codex-help');
    const helpTail = await terminalTail(window, 120);

    const marker = `PW_CODEX_INSPECT_${Date.now()}`;
    const prompt = `Reply with exactly: ${marker}`;
    const command = [
      'codex exec --skip-git-repo-check --sandbox workspace-write --color never',
      `-C ${shellEscape(workspaceRoot)}`,
      shellEscape(prompt),
      `; echo __PW_EXIT__$?`,
    ].join(' ');

    baseline = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
    await typeAndRun(window, command);
    await waitForOutputGrowth(window, baseline, 90000);
    await window.waitForFunction(
      () => {
        const t = window.__pwTerminalOutput || '';
        return t.includes('__PW_EXIT__');
      },
      undefined,
      { timeout: 180000 }
    );
    await shot(window, '04-codex-exec');
    const execTail = await terminalTail(window, 160);

    console.log('--- CODEX HELP TAIL ---');
    console.log(helpTail);
    console.log('--- CODEX EXEC TAIL ---');
    console.log(execTail);
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
