const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PIXELBOX_VISUAL_LOOP_PORT || 33210);
const baseUrl = `http://127.0.0.1:${port}`;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = process.env.PIXELBOX_VISUAL_LOOP_ARTIFACT_DIR
  ? path.resolve(process.env.PIXELBOX_VISUAL_LOOP_ARTIFACT_DIR)
  : path.join(rootDir, 'screenshots', `visual-loop-e2e-${runId}`);
const workspaceDir = path.join(rootDir, '.tmp', `visual-loop-workspace-${runId}`);
const previewRelPath = 'generated/live-preview.html';
const previewAbsPath = path.join(workspaceDir, previewRelPath);
const useRealCodex = process.env.PW_VISUAL_LOOP_REAL_CODEX === '1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function postJson(pathname, body = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${pathname}`);
  }
  return payload;
}

async function waitForHealth(serverProcess) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Pixelbox backend exited early with code ${serverProcess.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

async function commandExists(command, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function createTerminalEventCollector() {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`Could not subscribe to Pixelbox events: ${response.status}`);
  }

  let buffer = '';
  let terminalOutput = '';
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const pump = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let splitIndex = buffer.indexOf('\n\n');
        while (splitIndex >= 0) {
          const rawEvent = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);
          splitIndex = buffer.indexOf('\n\n');
          const lines = rawEvent.split('\n');
          const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7).trim();
          const dataLine = lines.find((line) => line.startsWith('data: '));
          if (eventName === 'terminal:data' && dataLine) {
            try {
              terminalOutput += JSON.parse(dataLine.slice(6)).data || '';
            } catch {}
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();

  return {
    output: () => terminalOutput,
    close: async () => {
      controller.abort();
      await pump.catch(() => {});
    },
  };
}

async function waitForCaptureRegion(predicate = () => true) {
  const startedAt = Date.now();
  let lastRegion = null;
  while (Date.now() - startedAt < 8000) {
    lastRegion = await postJson('/api/preview/getCaptureRegion');
    if (
      lastRegion.visible &&
      lastRegion.width > 0 &&
      lastRegion.height > 0 &&
      predicate(lastRegion)
    ) {
      return lastRegion;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for visible preview capture region. Last region: ${JSON.stringify(lastRegion)}`);
}

function htmlForStep({ label, title, detail, background, accent }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color: #f8fbff;
        background: ${background};
        font-family: "Space Grotesk", "Avenir Next", sans-serif;
      }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 15%, color-mix(in srgb, ${accent} 32%, transparent), transparent 34%),
          linear-gradient(135deg, ${background}, #07111f 70%);
      }
      main {
        width: min(720px, calc(100vw - 96px));
        border: 1px solid color-mix(in srgb, ${accent} 65%, white 10%);
        border-radius: 34px;
        padding: 48px;
        background: color-mix(in srgb, ${background} 72%, transparent);
        box-shadow: 0 24px 90px color-mix(in srgb, ${accent} 28%, transparent);
      }
      .label {
        color: ${accent};
        font: 700 13px/1.1 "IBM Plex Mono", monospace;
        letter-spacing: .22em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 14px;
        font-size: clamp(44px, 8vw, 88px);
        line-height: .88;
      }
      p {
        max-width: 54ch;
        color: rgba(248, 251, 255, .78);
        font-size: 20px;
        line-height: 1.55;
      }
    </style>
  </head>
  <body>
    <main data-testid="visual-stage" data-step="${label}">
      <div class="label">${label}</div>
      <h1>${title}</h1>
      <p>${detail}</p>
    </main>
  </body>
</html>
`;
}

async function writePreviewStep(step) {
  await fs.mkdir(path.dirname(previewAbsPath), { recursive: true });
  await fs.writeFile(previewAbsPath, htmlForStep(step), 'utf8');
}

async function waitForPreviewStep(page, label) {
  const frame = page.frameLocator('#preview-frame');
  await frame.locator(`[data-testid="visual-stage"][data-step="${label}"]`).waitFor({ state: 'visible', timeout: 8000 });
  return frame.locator('[data-testid="visual-stage"]').textContent();
}

async function waitForTerminalOutput(collector, needle, timeoutMs = 240000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const output = collector.output();
    if (output.includes(needle)) return output;
    await sleep(250);
  }
  const tail = collector.output().slice(-4000);
  throw new Error(`Timed out waiting for terminal output "${needle}". Tail:\n${tail}`);
}

async function typeTerminalCommand(page, command) {
  await page.locator('#terminal').click();
  await page.keyboard.type(command, { delay: 4 });
  await page.keyboard.press('Enter');
}

async function runCodexEditThroughPixelboxTerminal(page, collector, step, marker, index) {
  const html = htmlForStep(step);
  const prompt = [
    `Overwrite ${previewRelPath} with the exact HTML below.`,
    'Do not modify any other file.',
    `The final file must contain data-step="${step.label}" and the heading "${step.title}".`,
    '',
    html,
  ].join('\n');
  const pixelboxDir = path.join(workspaceDir, '.pixelbox');
  const promptRelPath = `.pixelbox/visual-loop-codex-prompt-${index}.txt`;
  const scriptRelPath = `.pixelbox/run-visual-loop-codex-${index}.sh`;
  const promptPath = path.join(workspaceDir, promptRelPath);
  const scriptPath = path.join(workspaceDir, scriptRelPath);
  await fs.mkdir(pixelboxDir, { recursive: true });
  await fs.writeFile(promptPath, prompt, 'utf8');
  await fs.writeFile(scriptPath, `#!/usr/bin/env bash
set -u
printf "\\n${marker}:START\\n"
codex exec --skip-git-repo-check --sandbox workspace-write --color never -C ${shellEscape(workspaceDir)} "$(cat ${shellEscape(promptRelPath)})"
code=$?
printf "\\n${marker}:$code\\n"
exit "$code"
`, 'utf8');
  await fs.chmod(scriptPath, 0o755);

  await postJson('/api/terminal/start', { cwd: '.', options: {} });
  await sleep(500);
  if (!collector.output().includes('__PIXELBOX_TERMINAL_READY__')) {
    await typeTerminalCommand(page, 'printf "__PIXELBOX_TERMINAL_READY__\\n"');
    await waitForTerminalOutput(collector, '__PIXELBOX_TERMINAL_READY__', 10000);
  }
  await typeTerminalCommand(page, `bash ${shellEscape(scriptRelPath)}`);
  await waitForTerminalOutput(collector, `${marker}:START`, 10000);
  await waitForTerminalOutput(collector, `${marker}:0`);
}

async function applyPreviewEdit(page, collector, step, marker, index) {
  if (useRealCodex) {
    await runCodexEditThroughPixelboxTerminal(page, collector, step, marker, index);
    return;
  }
  await writePreviewStep(step);
}

async function main() {
  if (process.env.PW_VISUAL_LOOP_VIDEO !== '1') {
    console.log('Skipping visual loop Playwright video probe. Set PW_VISUAL_LOOP_VIDEO=1 to run it.');
    return;
  }
  if (useRealCodex && !(await commandExists('codex'))) {
    throw new Error('PW_VISUAL_LOOP_REAL_CODEX=1 requires the codex CLI to be available in PATH.');
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await writePreviewStep({
    label: 'BASELINE',
    title: 'Initial preview',
    detail: useRealCodex
      ? 'This is the first rendered state before the real Codex terminal edit lands.'
      : 'This is the first rendered state before the simulated file edit lands.',
    background: '#0d1726',
    accent: '#62b0ff',
  });

  const serverProcess = spawn(process.execPath, ['bridge/server.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PIXELBOX_BACKEND_PORT: String(port),
      PIXELBOX_WORKSPACE_ROOT: workspaceDir,
      PXCODE_DISABLE_AUTO_TUI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLogs = [];
  serverProcess.stdout.on('data', (chunk) => serverLogs.push(chunk.toString()));
  serverProcess.stderr.on('data', (chunk) => serverLogs.push(chunk.toString()));

  let browser;
  let context;
  let terminalCollector;
  let videoPath = '';

  try {
    await waitForHealth(serverProcess);
    terminalCollector = await createTerminalEventCollector();

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      recordVideo: {
        dir: artifactDir,
        size: { width: 1280, height: 900 },
      },
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !text.includes('Failed to load resource')) {
        pageErrors.push(text);
      }
    });

    await page.goto(`${baseUrl}/renderer/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#preview-viewport', { state: 'visible' });

    await page.selectOption('#running-page-type', 'html');
    await page.fill('#running-page-html', previewRelPath);
    await page.click('#running-page-save');
    await waitForPreviewStep(page, 'BASELINE');
    await page.locator('#projects-minimize').click();
    if (!useRealCodex) {
      await page.locator('#chat-minimize').click();
    }
    await page.waitForTimeout(600);

    const baselineRegion = await waitForCaptureRegion();
    const baselinePath = path.join(artifactDir, 'visual-loop-01-baseline.png');
    await page.locator('#preview-viewport').screenshot({ path: baselinePath });

    const firstStep = {
      label: useRealCodex ? 'REAL CODEX EDIT 01' : 'SIMULATED EDIT 01',
      title: useRealCodex ? 'Codex changed this' : 'Hero changed',
      detail: useRealCodex
        ? 'Codex ran through the Pixelbox terminal and rewrote the watched HTML preview file.'
        : 'The watched HTML file changed and Pixelbox reloaded the embedded preview without a manual refresh.',
      background: '#10284f',
      accent: '#7bdcff',
    };
    await applyPreviewEdit(page, terminalCollector, firstStep, '__PIXELBOX_CODEX_EDIT_01_DONE__', 1);
    await waitForPreviewStep(page, firstStep.label);
    await page.waitForTimeout(800);
    const firstEditRegion = await waitForCaptureRegion((region) => region.updatedAt >= baselineRegion.updatedAt);
    const firstEditPath = path.join(artifactDir, 'visual-loop-02-codex-edit.png');
    await page.locator('#preview-viewport').screenshot({ path: firstEditPath });

    const secondStep = {
      label: useRealCodex ? 'REAL CODEX EDIT 02' : 'SIMULATED EDIT 02',
      title: 'Second pass',
      detail: useRealCodex
        ? 'A second real Codex terminal command proves Pixelbox can observe multiple UI updates over time.'
        : 'A second simulated file edit proves the visual loop can observe multiple UI updates over time.',
      background: '#163d2f',
      accent: '#8ff2b0',
    };
    await applyPreviewEdit(page, terminalCollector, secondStep, '__PIXELBOX_CODEX_EDIT_02_DONE__', 2);
    await waitForPreviewStep(page, secondStep.label);
    await page.waitForTimeout(900);
    const secondEditRegion = await waitForCaptureRegion((region) => region.updatedAt >= firstEditRegion.updatedAt);
    const secondEditPath = path.join(artifactDir, 'visual-loop-03-second-edit.png');
    await page.locator('#preview-viewport').screenshot({ path: secondEditPath });

    const finalStep = await page.frameLocator('#preview-frame')
      .locator('[data-testid="visual-stage"]')
      .getAttribute('data-step');
    if (finalStep !== secondStep.label) {
      throw new Error(`Expected final preview step ${secondStep.label}, got ${finalStep}`);
    }

    if (pageErrors.length) {
      throw new Error(`Browser errors during visual loop probe:\n${pageErrors.join('\n')}`);
    }

    videoPath = await page.video().path();
    await context.close();
    context = null;
    await browser.close();
    browser = null;

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      artifactDir,
      mode: useRealCodex ? 'real-codex-terminal' : 'simulated-file-edits',
      baselineScreenshot: baselinePath,
      firstEditScreenshot: firstEditPath,
      secondEditScreenshot: secondEditPath,
      video: videoPath,
      baselineRegion,
      firstEditRegion,
      secondEditRegion,
      terminalOutputTail: useRealCodex ? terminalCollector.output().slice(-1200) : undefined,
    }, null, 2));
  } finally {
    if (terminalCollector) await terminalCollector.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    serverProcess.kill('SIGTERM');
    await sleep(100);
    if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL');
  }

  if (!videoPath) {
    throw new Error(`Playwright did not produce a video. Server logs:\n${serverLogs.join('')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
