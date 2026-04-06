const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

function stripAnsi(value) {
  return String(value)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/\r/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function parseTuiResponse(cleaned, prompt) {
  const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
  const idx = (() => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].includes(prompt)) return i;
    }
    return -1;
  })();
  const start = idx >= 0 ? idx + 1 : 0;
  const ignore = [
    /^>_/,
    /^╭|^╰|^│/,
    /^model:/i,
    /^directory:/i,
    /^tip:/i,
    /^starting mcp/i,
    /^gpt-[\d.]/i,
    /context left/i,
    /workspace\/pxcode/i,
    /^›/,
    /^user$/i,
    /^\[terminal exited\]/i,
  ];
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (ignore.some((re) => re.test(line))) continue;
    out.push(line);
  }
  return out.slice(0, 12).join('\n').trim();
}

async function getTail(window) {
  const raw = await window.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-24).join('\n'));
  return stripAnsi(raw);
}

async function focusTerminal(window) {
  await window.click('#terminal', { position: { x: 36, y: 36 } });
  await window.waitForTimeout(120);
}

async function submitWithEnter(window, logEvent, tag = 'enter') {
  await focusTerminal(window);
  await window.keyboard.press('Enter');
  logEvent('in', `[send-attempt:${tag}]\n`);
}

async function typeAndSendPrompt(window, prompt, logEvent) {
  await focusTerminal(window);
  await window.keyboard.type(prompt, { delay: 12 });
  logEvent('in', `${prompt}\n`);
  await submitWithEnter(window, logEvent, 'type+enter');
}

function outputLooksActive(full, prompt) {
  const cleaned = stripAnsi(full).toLowerCase();
  if (!cleaned.includes(prompt.toLowerCase())) return false;
  return (
    cleaned.includes('thinking') ||
    cleaned.includes('ran ') ||
    cleaned.includes('explored') ||
    cleaned.includes('updated plan') ||
    cleaned.includes('openai codex') ||
    cleaned.includes('assistant') ||
    cleaned.includes('considering')
  );
}

async function ensurePromptSubmitted(window, prompt, logEvent, baselineLength) {
  const quickDeadline = Date.now() + 12000;
  while (Date.now() < quickDeadline) {
    const full = await window.evaluate(() => window.__pwTerminalOutput || '');
    if (full.length > baselineLength + 60 && outputLooksActive(full, prompt)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }

  const retries = [
    { name: 'retry-enter', run: async () => submitWithEnter(window, logEvent, 'retry-enter') },
    { name: 'retry-ctrl-j', run: async () => { await focusTerminal(window); await window.keyboard.press('Control+j'); logEvent('in', '[send-attempt:retry-ctrl-j]\n'); } },
    { name: 'retry-raw-cr', run: async () => { await window.evaluate(() => window.api.writeTerminal('\r')); logEvent('in', '[send-attempt:retry-raw-cr]\n'); } },
  ];

  for (const retry of retries) {
    await retry.run();
    await new Promise((r) => setTimeout(r, 1800));
    const full = await window.evaluate(() => window.__pwTerminalOutput || '');
    if (full.length > baselineLength + 80 && outputLooksActive(full, prompt)) return true;
  }
  return false;
}

async function main() {
  const cwd = process.cwd();
  const stamp = Date.now();
  const prompt = process.env.CODEX_PROMPT || 'In one short sentence, what is 2+2?';
  const waitMs = Number(process.env.CODEX_WAIT_MS || 90000);
  const outDir = path.join(cwd, 'logs', 'codex-tui-trace');
  const shotDir = path.join(cwd, 'screenshots', 'codex-tui-trace');
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(shotDir, { recursive: true });

  const transcriptPath = path.join(outDir, `codex-tui-${stamp}.ndjson`);
  const finalShotPath = path.join(shotDir, `codex-tui-${stamp}.png`);
  const livePrefix = path.join(shotDir, `codex-tui-${stamp}-live`);

  const events = [];
  const logEvent = (direction, text) => events.push({ ts: nowIso(), direction, text });

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

    let cursor = 0;
    let stop = false;
    const capture = (async () => {
      while (!stop) {
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
        await new Promise((r) => setTimeout(r, 200));
      }
    })();

    let shotIndex = 0;
    const periodic = (async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 10000));
        if (stop) break;
        try {
          const shot = `${livePrefix}-${String(shotIndex).padStart(2, '0')}.png`;
          shotIndex += 1;
          await window.screenshot({ path: shot, fullPage: true });
          const tail = await window.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-12).join('\n'));
          console.log(`[progress-shot] ${shot}`);
          console.log(`[progress-tail] ${stripAnsi(tail).slice(-300).replace(/\n/g, ' | ')}`);
        } catch {
          break;
        }
      }
    })();

    await typeAndSendPrompt(window, prompt, logEvent);

    const startLen = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
    const sent = await ensurePromptSubmitted(window, prompt, logEvent, startLen);
    if (!sent) {
      const tail = await getTail(window);
      throw new Error(`Prompt appears unsent after retries.\nTail:\n${tail}`);
    }

    const deadline = Date.now() + waitMs;
    let parsed = '';
    let parsedAt = 0;
    let idleLoops = 0;
    while (Date.now() < deadline) {
      const full = await window.evaluate(() => window.__pwTerminalOutput || '');
      if (full.length > startLen + 80) {
        const candidate = parseTuiResponse(stripAnsi(full), prompt);
        if (candidate) {
          if (!parsed || parsed !== candidate) {
            parsed = candidate;
            parsedAt = Date.now();
          }
        }
        idleLoops = 0;
      } else {
        idleLoops += 1;
      }
      if (idleLoops > 20) {
        await submitWithEnter(window, logEvent, 'nudge-enter');
        idleLoops = 0;
      }
      if (parsed && Date.now() - parsedAt > 1500) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    await window.screenshot({ path: finalShotPath, fullPage: true });
    stop = true;
    await capture;
    await periodic;

    await fs.writeFile(transcriptPath, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
    console.log(`[screenshot] ${finalShotPath}`);
    console.log(`[transcript] ${transcriptPath}`);
    console.log('[parsed_response]');
    console.log(parsed || '(no clear response extracted)');
  } finally {
    if (app) await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
