const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

async function main() {
  const cwd = process.cwd();
  const outDir = path.join(cwd, 'screenshots', 'codex-interaction');
  await fs.mkdir(outDir, { recursive: true });

  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#chat-panel.open', { timeout: 120000 });

    await window.waitForFunction(
      () => {
        const t = (window.__pwTerminalOutput || '').toLowerCase();
        return t.includes('openai codex') || t.includes('explain this codebase');
      },
      undefined,
      { timeout: 120000 }
    );

    const beforeLen = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
    const prompt = 'In one short sentence, what is 2+2?';
    await window.click('#terminal');
    await window.keyboard.type(prompt, { delay: 2 });
    await window.keyboard.press('Enter');

    await window.waitForFunction(
      ({ baseline }) => (window.__pwTerminalOutput || '').length > baseline + 80,
      { baseline: beforeLen },
      { timeout: 120000 }
    );
    await window.waitForTimeout(2500);

    const stamp = Date.now();
    const shotPath = path.join(outDir, `codex-once-${stamp}.png`);
    await window.screenshot({ path: shotPath, fullPage: true });

    const tail = await window.evaluate(() => {
      return (window.__pwTerminalOutput || '').split('\n').slice(-200).join('\n');
    });
    const cleaned = stripAnsi(tail);

    console.log(`[screenshot] ${shotPath}`);
    console.log('[response-tail]');
    console.log(cleaned.slice(-5000));
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
