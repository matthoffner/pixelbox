const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
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

function defaultPrompts() {
  return [
    'Inspect renderer/index.html and renderer/styles.css. Make one small UI polish improvement and summarize what changed.',
    'Make one additional visual improvement focused on spacing or typography. Keep behavior unchanged and summarize.',
    'Run a quick frontend QA pass for small viewports and patch CSS if needed. Then summarize the change.',
  ];
}

function parsePromptsFromEnv() {
  const raw = process.env.CODEX_LOOP_PROMPTS;
  if (!raw) return defaultPrompts();
  const prompts = raw
    .split('||')
    .map((p) => p.trim())
    .filter(Boolean);
  return prompts.length > 0 ? prompts : defaultPrompts();
}

function parseResponseSnippet(cleaned, prompt) {
  const lines = cleaned.split('\n').map((line) => line.trimEnd());
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].includes(prompt)) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return '';

  const stopPatterns = [
    /Find and fix a bug in @filename/i,
    /^gpt-[\d.]+\s+/i,
  ];
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (stopPatterns.some((re) => re.test(line))) break;
    if (/^model:/i.test(line)) continue;
    if (/^directory:/i.test(line)) continue;
    if (/^tip:/i.test(line)) continue;
    if (/^\[terminal exited\]/i.test(line)) continue;
    out.push(line);
    if (out.length >= 14) break;
  }
  return out.join('\n').trim();
}

async function focusTerminal(window) {
  await window.click('#terminal', { position: { x: 40, y: 40 } });
  await window.waitForTimeout(120);
}

async function writeLine(window, text) {
  await focusTerminal(window);
  await window.keyboard.type(text, { delay: 12 });
  await window.keyboard.press('Enter');
}

async function sendPromptWithVerification(window, prompt, logEvent) {
  const attempts = [
    async () => {
      await writeLine(window, prompt);
      logEvent('in', `${prompt}\n`);
    },
    async () => {
      await focusTerminal(window);
      await window.keyboard.press('Enter');
      await window.waitForTimeout(150);
      await window.keyboard.type(prompt, { delay: 8 });
      await window.keyboard.press('Enter');
      logEvent('in', `[retry:key-enter] ${prompt}\n`);
    },
    async () => {
      await window.evaluate((p) => window.api.writeTerminal(`${p}\r`), prompt);
      logEvent('in', `[retry:raw-cr] ${prompt}\n`);
    },
    async () => {
      await focusTerminal(window);
      await window.keyboard.press('Control+j');
      await window.waitForTimeout(100);
      await window.keyboard.type(prompt, { delay: 8 });
      await window.keyboard.press('Control+j');
      logEvent('in', `[retry:ctrl-j] ${prompt}\n`);
    },
  ];

  for (let i = 0; i < attempts.length; i += 1) {
    await attempts[i]();
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      const cleaned = stripAnsi(await terminalOutput(window));
      if (cleaned.includes(prompt)) return true;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return false;
}

async function terminalOutput(window) {
  return window.evaluate(() => window.__pwTerminalOutput || '');
}

async function maybeScreenshot(window, shotDir, runId, turnIndex, tickRef) {
  const now = Date.now();
  if (now - tickRef.lastShotAt < 10000) return;
  const file = path.join(
    shotDir,
    `codex-loop-${runId}-turn${String(turnIndex + 1).padStart(2, '0')}-live-${String(tickRef.count).padStart(2, '0')}.png`
  );
  tickRef.lastShotAt = now;
  tickRef.count += 1;
  await window.screenshot({ path: file, fullPage: true });
  const tail = stripAnsi((await terminalOutput(window)).split('\n').slice(-10).join(' | '));
  console.log(`[progress-shot] ${file}`);
  console.log(`[progress-tail] ${tail.slice(-320)}`);
}

function rendererDiff() {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--', 'renderer'], { encoding: 'utf8' }).trim();
    if (!out) return [];
    return out.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function waitForResponseCycle(window, prompt, maxMs, shotDir, runId, turnIndex, tickRef) {
  const start = Date.now();
  let started = false;
  let lastLen = (await terminalOutput(window)).length;
  let lastGrowthAt = Date.now();
  const doneHint = /Find and fix a bug in @filename|Implement \{feature\}|Run \/review on my current changes/i;

  while (Date.now() - start < maxMs) {
    await maybeScreenshot(window, shotDir, runId, turnIndex, tickRef);
    const full = await terminalOutput(window);
    const cleaned = stripAnsi(full);
    if (full.length > lastLen + 40) {
      started = true;
      lastGrowthAt = Date.now();
      lastLen = full.length;
    }
    if (started && doneHint.test(cleaned) && Date.now() - lastGrowthAt > 2500) {
      return { ok: true, full: cleaned };
    }
    if (!started && Date.now() - start > 14000) {
      await focusTerminal(window);
      await window.keyboard.press('Enter');
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  return { ok: false, full: stripAnsi(await terminalOutput(window)) };
}

async function main() {
  const cwd = process.cwd();
  const runId = Date.now();
  const prompts = parsePromptsFromEnv();
  const turnTimeoutMs = Number(process.env.CODEX_TURN_TIMEOUT_MS || 150000);
  const outDir = path.join(cwd, 'logs', 'codex-debug-loop');
  const shotDir = path.join(cwd, 'screenshots', 'codex-debug-loop');
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(shotDir, { recursive: true });

  const transcriptPath = path.join(outDir, `codex-loop-${runId}.ndjson`);
  const summaryPath = path.join(outDir, `codex-loop-${runId}.summary.json`);
  const events = [];
  const summary = [];
  const logEvent = (direction, text) => events.push({ ts: nowIso(), direction, text });

  let app;
  try {
    app = await electron.launch({
      args: ['.'],
      cwd,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
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
    let stopCapture = false;
    const capture = (async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    })();

    const tickRef = { count: 0, lastShotAt: 0 };

    for (let i = 0; i < prompts.length; i += 1) {
      const prompt = prompts[i];
      const sent = await sendPromptWithVerification(window, prompt, logEvent);
      if (!sent) {
        const shot = path.join(
          shotDir,
          `codex-loop-${runId}-turn${String(i + 1).padStart(2, '0')}-send-failed.png`
        );
        await window.screenshot({ path: shot, fullPage: true });
        summary.push({
          turn: i + 1,
          prompt,
          ok: false,
          responseSnippet: '(prompt send verification failed)',
          screenshot: shot,
          rendererChangedFiles: rendererDiff(),
        });
        console.log(`[turn ${i + 1}] send-failed screenshot=${shot}`);
        continue;
      }
      console.log(`[turn ${i + 1}] sent`);

      const res = await waitForResponseCycle(window, prompt, turnTimeoutMs, shotDir, runId, i, tickRef);
      const snippet = parseResponseSnippet(res.full, prompt);
      const shot = path.join(
        shotDir,
        `codex-loop-${runId}-turn${String(i + 1).padStart(2, '0')}-final.png`
      );
      await window.screenshot({ path: shot, fullPage: true });
      const changed = rendererDiff();
      summary.push({
        turn: i + 1,
        prompt,
        ok: res.ok,
        responseSnippet: snippet,
        screenshot: shot,
        rendererChangedFiles: changed,
      });

      console.log(`[turn ${i + 1}] ok=${res.ok} changed=${changed.join(', ') || '(none)'}`);
      console.log(`[turn ${i + 1}] screenshot=${shot}`);
      console.log(`[turn ${i + 1}] response=${snippet || '(none extracted)'}`);
    }

    stopCapture = true;
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
