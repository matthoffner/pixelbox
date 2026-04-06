const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

const POLL_MS = 200;

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function stripAnsi(value) {
  return String(value)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/\r/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function extractResponse(cleanedText, prompt) {
  const lines = cleanedText.split('\n').map((line) => line.trim());
  const promptIndex = (() => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].includes(prompt)) return i;
    }
    return -1;
  })();

  const start = promptIndex >= 0 ? promptIndex + 1 : 0;
  const ignorePatterns = [
    /^$/,
    /^>_/,
    /^╭|^╰|^│/,
    /^model:/i,
    /^directory:/i,
    /^tip:/i,
    /^starting mcp/i,
    /^gpt-[\d.]/i,
    /context left/i,
    /workspace\/pxcode/i,
    /^, /,
    /^›/,
    /^\[terminal exited\]/i,
  ];

  const candidates = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (ignorePatterns.some((re) => re.test(line))) continue;
    candidates.push(line);
  }
  return candidates.slice(0, 8).join('\n').trim();
}

async function main() {
  const cwd = process.cwd();
  const stamp = Date.now();
  const outDir = path.join(cwd, 'logs', 'codex-trace');
  const shotDir = path.join(cwd, 'screenshots', 'codex-trace');
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(shotDir, { recursive: true });

  const prompt = process.env.CODEX_PROMPT || 'In one short sentence, what is 2+2?';
  const waitMs = Number(process.env.CODEX_WAIT_MS || 45000);
  const transcriptPath = path.join(outDir, `codex-turn-${stamp}.ndjson`);
  const screenshotPath = path.join(shotDir, `codex-turn-${stamp}.png`);
  const livePrefix = path.join(shotDir, `codex-turn-${stamp}-live`);

  const events = [];
  const logEvent = (direction, text) => {
    events.push({
      ts: nowIso(),
      direction,
      text,
    });
  };

  let app;
  try {
    app = await electron.launch({
      args: ['.'],
      cwd,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        PXCODE_DISABLE_AUTO_TUI: '1',
      },
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#chat-panel.open', { timeout: 120000 });

    await window.evaluate(async () => {
      await window.api.startOrRestartTerminal('.', false, { startupCommand: '' });
      window.api.resizeTerminal(120, 30);
    });

    await window.waitForFunction(
      () => {
        const t = (window.__pwTerminalOutput || '').toLowerCase();
        return t.includes('pxcode %') || t.includes('workspace/pxcode %') || t.includes('(base)');
      },
      undefined,
      { timeout: 120000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    const preflight = `__TRACE_SEND_OK_${Date.now()}__`;
    await window.evaluate((cmd) => {
      window.api.writeTerminal(`echo ${cmd}\n`);
    }, preflight);
    await window.waitForFunction(
      (marker) => (window.__pwTerminalOutput || '').includes(marker),
      preflight,
      { timeout: 8000 }
    );

    let cursor = 0;
    let stopCapture = false;
    const captureLoop = (async () => {
      while (!stopCapture) {
        try {
          const chunk = await window.evaluate((start) => {
            const t = window.__pwTerminalOutput || '';
            return { next: t.length, delta: t.slice(start) };
          }, cursor);
          cursor = chunk.next;
          if (chunk.delta) logEvent('out', chunk.delta);
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    })();

    let shotIndex = 0;
    const periodicShots = (async () => {
      while (!stopCapture) {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        if (stopCapture) break;
        try {
          const shot = `${livePrefix}-${String(shotIndex).padStart(2, '0')}.png`;
          shotIndex += 1;
          await window.screenshot({ path: shot, fullPage: true });
          const tail = await window.evaluate(() => {
            return (window.__pwTerminalOutput || '').split('\n').slice(-12).join('\n');
          });
          console.log(`[progress-shot] ${shot}`);
          console.log(`[progress-tail] ${stripAnsi(tail).slice(-300).replace(/\n/g, ' | ')}`);
        } catch {
          break;
        }
      }
    })();

    const marker = `__CODEX_ONE_OFF_${Date.now()}__`;
    const command =
      `unset npm_config_prefix; ` +
      `codex exec --skip-git-repo-check --sandbox workspace-write --color never ` +
      `-C ${shellEscape(cwd)} ${shellEscape(prompt)}; ` +
      `__s=$?; echo ${marker}:$__s`;

    await window.evaluate((cmd) => {
      window.api.writeTerminal(`${cmd}\n`);
    }, command);
    logEvent('in', `${command}\n`);

    const submitLen = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
    try {
      await window.waitForFunction(
        ({ baseline }) => (window.__pwTerminalOutput || '').length > baseline + 20,
        { baseline: submitLen },
        { timeout: 10000 }
      );
    } catch {
      await window.evaluate((cmd) => {
        window.api.writeTerminal(`${cmd}\n`);
      }, command);
      logEvent('in', '[retry-send]\n');
      await window.waitForFunction(
        ({ baseline }) => (window.__pwTerminalOutput || '').length > baseline + 20,
        { baseline: submitLen },
        { timeout: 10000 }
      );
    }

    let lastLen = submitLen;
    let lastChange = Date.now();
    let parsedResponse = '';
    let firstResponseAt = 0;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const fullOutput = await window.evaluate(() => window.__pwTerminalOutput || '');
      const len = fullOutput.length;
      if (len !== lastLen) {
        lastLen = len;
        lastChange = Date.now();
      }

      if (len > submitLen + 80) {
        const cleanedNow = stripAnsi(fullOutput);
        const candidate = extractResponse(cleanedNow, prompt);
        if (candidate) {
          if (!parsedResponse || parsedResponse !== candidate) {
            parsedResponse = candidate;
            firstResponseAt = Date.now();
          }
        }
        if (cleanedNow.includes(`${marker}:0`)) {
          break;
        }
      }

      const stableAfterResponse = parsedResponse && firstResponseAt && Date.now() - firstResponseAt > 1500;
      if (stableAfterResponse) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await window.screenshot({ path: screenshotPath, fullPage: true });
    stopCapture = true;
    await captureLoop;
    await periodicShots;

    const fullOutput = await window.evaluate(() => window.__pwTerminalOutput || '');
    const cleaned = stripAnsi(fullOutput);
    if (!parsedResponse) {
      parsedResponse = extractResponse(cleaned, prompt);
    }

    if (!cleaned.includes(`${marker}:0`)) {
      throw new Error(`No completion marker within ${waitMs}ms`);
    }

    await fs.writeFile(transcriptPath, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');

    console.log(`[screenshot] ${screenshotPath}`);
    console.log(`[transcript] ${transcriptPath}`);
    console.log('[parsed_response]');
    console.log(parsedResponse || '(no clear response extracted)');
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
