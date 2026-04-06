const path = require('node:path');
const fs = require('node:fs/promises');
const net = require('node:net');
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

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function focusTerminal(window) {
  await window.click('#terminal', { position: { x: 36, y: 36 } });
  await window.waitForTimeout(120);
}

async function submitWithEnter(window) {
  await focusTerminal(window);
  await window.keyboard.press('Enter');
}

async function sendPrompt(window, prompt) {
  await focusTerminal(window);
  await window.keyboard.type(prompt, { delay: 10 });
  await submitWithEnter(window);
}

async function isPortOpen(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function main() {
  const cwd = process.cwd();
  const stamp = Date.now();
  const projectName = `next-ai-rsc-${stamp}`;
  const doneToken = `NEXT_AI_DONE:${projectName}`;
  const port = Number(process.env.NEXT_LONG_PORT || 4110);
  const waitMs = Number(process.env.NEXT_LONG_WAIT_MS || 420000);

  const outDir = path.join(cwd, 'logs', 'codex-next-long');
  const shotDir = path.join(cwd, 'screenshots', 'codex-next-long');
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(shotDir, { recursive: true });

  const transcriptPath = path.join(outDir, `codex-next-long-${stamp}.ndjson`);
  const summaryPath = path.join(outDir, `codex-next-long-${stamp}.summary.json`);
  const finalShotPath = path.join(shotDir, `codex-next-long-${stamp}.png`);
  const livePrefix = path.join(shotDir, `codex-next-long-${stamp}-live`);

  const prompt = `Create Next.js AI app in projects/${projectName} with App Router + TypeScript; keep app/page.tsx as server component (no use client); add components/ChatKitWidget.tsx client widget with input/list/send button; add app/api/chat/route.ts with simple streaming or chunked response; start next dev on port ${port} in background writing .next-dev.pid and .next-dev.log; when fully complete print exactly ${doneToken} on its own line; execute directly with shell commands and file edits.`;

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

    logEvent('in', `${prompt}\n`);
    await sendPrompt(window, prompt);

    let shotIndex = 0;
    const waitForDone = async (msBudget) => {
      const deadline = Date.now() + msBudget;
      while (Date.now() < deadline) {
        const full = await window.evaluate(() => window.__pwTerminalOutput || '');
        const cleaned = stripAnsi(full);
        const doneLine = cleaned
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line === doneToken);
        if (doneLine) return true;

        const shot = `${livePrefix}-${String(shotIndex).padStart(2, '0')}.png`;
        shotIndex += 1;
        await window.screenshot({ path: shot, fullPage: true });
        const tail = cleaned.split('\n').slice(-12).join(' | ');
        console.log(`[progress-shot] ${shot}`);
        console.log(`[progress-tail] ${tail.slice(-360)}`);
        await new Promise((r) => setTimeout(r, 10000));
      }
      return false;
    };

    let foundDone = await waitForDone(waitMs);
    if (!foundDone) {
      const followup = `Finish all remaining steps for ${projectName}, ensure next dev is running on ${port}, then print exactly ${doneToken} on its own line.`;
      logEvent('in', `${followup}\n`);
      await sendPrompt(window, followup);
      foundDone = await waitForDone(180000);
    }

    await window.screenshot({ path: finalShotPath, fullPage: true });
    stop = true;
    await capture;

    await fs.writeFile(transcriptPath, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');

    const projectRoot = path.join(cwd, 'projects', projectName);
    const pagePath = path.join(projectRoot, 'app', 'page.tsx');
    const widgetPath = path.join(projectRoot, 'components', 'ChatKitWidget.tsx');
    const routePath = path.join(projectRoot, 'app', 'api', 'chat', 'route.ts');
    const devLogPath = path.join(projectRoot, '.next-dev.log');
    const pidPath = path.join(projectRoot, '.next-dev.pid');

    const pageText = await readText(pagePath);
    const widgetText = await readText(widgetPath);
    const routeText = await readText(routePath);
    const devLogText = await readText(devLogPath);
    const devPortOpen = await isPortOpen(port);

    const summary = {
      doneToken,
      foundDone,
      projectRoot,
      checks: {
        projectDirExists: await exists(projectRoot),
        pageExists: await exists(pagePath),
        pageIsServerComponent: !pageText.includes('"use client"') && !pageText.includes("'use client'"),
        widgetExists: await exists(widgetPath),
        widgetLooksChatLike: /message|input|send/i.test(widgetText),
        routeExists: await exists(routePath),
        routeLooksChatApi: /POST|ReadableStream|chat|stream/i.test(routeText),
        devPidExists: await exists(pidPath),
        devLogExists: await exists(devLogPath),
        devLogLooksRunning: /ready|started server|localhost/i.test(devLogText),
        devPortOpen,
      },
      artifacts: {
        screenshot: finalShotPath,
        transcript: transcriptPath,
      },
    };

    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`[screenshot] ${finalShotPath}`);
    console.log(`[transcript] ${transcriptPath}`);
    console.log(`[summary] ${summaryPath}`);

    if (!foundDone) {
      throw new Error(`Completion token not found: ${doneToken}`);
    }
  } finally {
    if (app) await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
