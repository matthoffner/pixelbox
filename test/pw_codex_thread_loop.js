const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
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

function parsePrompts() {
  const raw = process.env.CODEX_LOOP_PROMPTS;
  if (!raw) {
    return [
      'Make exactly one small visual polish edit in renderer/styles.css, then summarize in 2 lines and end with token LOOP_DONE_1.',
      'Make one additional polish edit in renderer/index.html or renderer/styles.css, then summarize in 2 lines and end with token LOOP_DONE_2.',
    ];
  }
  return raw.split('||').map((s) => s.trim()).filter(Boolean);
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
    if (out.length >= 14) break;
  }
  return out.join('\n').trim();
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
    cleaned.includes('working') ||
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
  const promptProbe = prompt.trim().slice(0, 28).toLowerCase();
  const quickDeadline = Date.now() + 12000;
  while (Date.now() < quickDeadline) {
    const full = await window.evaluate(() => window.__pwTerminalOutput || '');
    const cleaned = stripAnsi(full).toLowerCase();
    if (cleaned.includes('messages to be submitted after next tool call') && cleaned.includes(promptProbe)) {
      return true;
    }
    if (cleaned.includes(promptProbe)) return true;
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
    const cleaned = stripAnsi(full).toLowerCase();
    if (cleaned.includes('messages to be submitted after next tool call') && cleaned.includes(promptProbe)) {
      return true;
    }
    if (cleaned.includes(promptProbe)) return true;
    if (full.length > baselineLength + 80 && outputLooksActive(full, prompt)) return true;
  }
  return false;
}

function hashText(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

async function readMaybe(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function rendererSnapshot(root) {
  const targets = [
    'renderer/index.html',
    'renderer/styles.css',
    'renderer/app.js',
  ];
  const snap = {};
  for (const rel of targets) {
    const content = await readMaybe(path.join(root, rel));
    snap[rel] = hashText(content);
  }
  return snap;
}

function changedRendererFiles(before, after) {
  const out = [];
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) out.push(key);
  }
  return out;
}

function isBusyOutput(cleaned) {
  return /esc to interrupt/i.test(cleaned);
}

function isIdleHint(cleaned) {
  return /Run \/review on my current changes|Find and fix a bug in @filename|Implement \{feature\}/i.test(cleaned);
}

function outputTail(cleaned, lines = 40) {
  return cleaned.split('\n').slice(-lines).join('\n');
}

async function waitForIdlePrompt(window, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cleaned = stripAnsi(await window.evaluate(() => window.__pwTerminalOutput || ''));
    const tail = outputTail(cleaned, 40);
    if (isIdleHint(tail) && !isBusyOutput(tail)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const cwd = process.cwd();
  const stamp = Date.now();
  const prompts = parsePrompts();
  const turnWaitMs = Number(process.env.CODEX_TURN_WAIT_MS || 120000);
  const outDir = path.join(cwd, 'logs', 'codex-thread-loop');
  const shotDir = path.join(cwd, 'screenshots', 'codex-thread-loop');
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(shotDir, { recursive: true });

  const transcriptPath = path.join(outDir, `codex-thread-${stamp}.ndjson`);
  const summaryPath = path.join(outDir, `codex-thread-${stamp}.summary.json`);
  const events = [];
  const summary = [];
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

    for (let turn = 0; turn < prompts.length; turn += 1) {
      await waitForIdlePrompt(window, 30000);
      const prompt = prompts[turn];
      const beforeSnap = await rendererSnapshot(cwd);
      await typeAndSendPrompt(window, prompt, logEvent);

      const startLen = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
      let sent = await ensurePromptSubmitted(window, prompt, logEvent, startLen);
      if (!sent) {
        await new Promise((r) => setTimeout(r, 7000));
        await typeAndSendPrompt(window, prompt, logEvent);
        const retryLen = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
        sent = await ensurePromptSubmitted(window, prompt, logEvent, retryLen);
      }
      if (!sent) {
        const failShot = path.join(shotDir, `codex-thread-${stamp}-turn${turn + 1}-send-failed.png`);
        await window.screenshot({ path: failShot, fullPage: true });
        summary.push({
          turn: turn + 1,
          prompt,
          ok: false,
          response: '(send failed)',
          screenshot: failShot,
          rendererChangedFiles: [],
        });
        console.log(`[turn ${turn + 1}] send failed`);
        continue;
      }

      const deadline = Date.now() + turnWaitMs;
      let parsed = '';
      let parsedAt = 0;
      let shotIdx = 0;
      let lastShotAt = 0;
      const doneToken = `LOOP_DONE_${turn + 1}`;
      while (Date.now() < deadline) {
        if (Date.now() - lastShotAt > 10000) {
          const liveShot = path.join(shotDir, `codex-thread-${stamp}-turn${turn + 1}-live-${String(shotIdx).padStart(2, '0')}.png`);
          await window.screenshot({ path: liveShot, fullPage: true });
          const tail = await window.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-10).join(' | '));
          console.log(`[progress-shot] ${liveShot}`);
          console.log(`[progress-tail] ${stripAnsi(tail).slice(-320)}`);
          shotIdx += 1;
          lastShotAt = Date.now();
        }

        const full = await window.evaluate(() => window.__pwTerminalOutput || '');
        const cleaned = stripAnsi(full);
        if (cleaned.includes(doneToken)) {
          parsed = parseTuiResponse(cleaned, prompt) || doneToken;
          parsedAt = Date.now();
        }
        if (full.length > startLen + 80) {
          const candidate = parseTuiResponse(cleaned, prompt);
          if (candidate) {
            if (!parsed || parsed !== candidate) {
              parsed = candidate;
              parsedAt = Date.now();
            }
            const tail = outputTail(cleaned, 40);
            if (isIdleHint(tail) && !isBusyOutput(tail) && Date.now() - parsedAt > 1500) {
              break;
            }
          }
        }
        if (parsed && Date.now() - parsedAt > 1500) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      const finalShot = path.join(shotDir, `codex-thread-${stamp}-turn${turn + 1}-final.png`);
      await window.screenshot({ path: finalShot, fullPage: true });
      const afterSnap = await rendererSnapshot(cwd);
      const changed = changedRendererFiles(beforeSnap, afterSnap);
      summary.push({
        turn: turn + 1,
        prompt,
        ok: Boolean(parsed),
        response: parsed || '(no clear response extracted)',
        screenshot: finalShot,
        rendererChangedFiles: changed,
      });
      console.log(`[turn ${turn + 1}] ok=${Boolean(parsed)} changed=${changed.join(', ') || '(none)'}`);
      console.log(`[turn ${turn + 1}] response=${parsed || '(none)'}`);
    }

    stop = true;
    await capture;
    await fs.writeFile(transcriptPath, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`[transcript] ${transcriptPath}`);
    console.log(`[summary] ${summaryPath}`);
  } finally {
    if (app) await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
