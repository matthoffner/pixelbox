const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron: electron } = require('playwright');

const workspaceRoot = process.cwd();

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

async function closeApp(app) {
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {}

  try {
    const proc = app.process();
    if (proc && !proc.killed) {
      proc.kill('SIGKILL');
    }
  } catch {}
}

async function launchApp(t) {
  return launchAppWithOptions(t, { disableAutoTui: true });
}

async function launchAppWithOptions(t, options = {}) {
  const { disableAutoTui = true, startupCommand = '' } = options;
  let app;
  try {
    app = await electron.launch({
      args: ['.'],
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        ...(disableAutoTui ? { PXCODE_DISABLE_AUTO_TUI: '1' } : {}),
        ...(startupCommand ? { PXCODE_TUI_COMMAND: startupCommand } : {}),
      },
    });
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#chat-panel.open');

    return { app, window };
  } catch (error) {
    if (app) {
      await app.close().catch(() => {});
    }
    t.skip(`Electron launch unavailable in this environment: ${error.message}`);
    return null;
  }
}

function openclawStartupCommandForWorkspace(sessionKey) {
  return [
    `openclaw config set agents.defaults.workspace ${shellEscape(workspaceRoot)} >/dev/null 2>&1`,
    `openclaw tui --session ${sessionKey}`,
  ].join('; ');
}

async function runInTerminal(window, command, doneMarker, timeoutMs = 180000) {
  await window.evaluate(async () => {
    await window.api.startTerminal('.');
    window.api.resizeTerminal(120, 30);
  });

  await window.evaluate((cmd) => {
    window.api.writeTerminal(`${cmd}\n`);
  }, command);

  await window.waitForFunction(
    ({ marker }) => {
      return typeof window.__pwTerminalOutput === 'string' && window.__pwTerminalOutput.includes(marker);
    },
    { marker: doneMarker },
    { timeout: timeoutMs }
  );
}

async function runShell(window, command, timeoutMs = 180000) {
  const marker = `__PW_DONE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wrapped = `${command}; __px_status=$?; printf "\\n${marker}:$__px_status\\n"`;
  await runInTerminal(window, wrapped, `${marker}:0`, timeoutMs);
}

async function runTypedInTerminal(window, command, doneMarker, timeoutMs = 180000) {
  await window.evaluate(async () => {
    await window.api.startTerminal('.');
    window.api.resizeTerminal(120, 30);
  });
  await window.click('#terminal');
  await window.keyboard.type(command, { delay: 2 });
  await window.keyboard.press('Enter');
  await window.waitForFunction(
    ({ marker }) => {
      const text = window.__pwTerminalOutput || '';
      return text.includes(marker);
    },
    { marker: doneMarker },
    { timeout: timeoutMs }
  );
}

async function waitForHttp(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw lastError || new Error('Timed out waiting for HTTP endpoint');
}

async function captureStepShot(window, dir, name) {
  await fs.mkdir(dir, { recursive: true });
  await window.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function runOpenclawPrompt(window, promptText, timeoutMs = 300000, options = {}) {
  const { shotDir = '', shotLabel = '' } = options;
  const beforeLength = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
  await window.click('#terminal');
  await window.evaluate((text) => {
    window.api.writeTerminal(text);
  }, promptText);
  await window.keyboard.press('Enter');

  try {
    await window.waitForFunction(
      ({ initialLength }) => {
        const text = window.__pwTerminalOutput || '';
        return text.length > initialLength + 10;
      },
      { initialLength: beforeLength },
      { timeout: 20000 }
    );

    await window.waitForFunction(
      () => {
        const text = (window.__pwTerminalOutput || '').toLowerCase();
        const tail = text.slice(-1200);
        return tail.includes('sending');
      },
      undefined,
      { timeout: 45000 }
    ).catch(() => {});

    await window.waitForFunction(
      () => {
        const text = (window.__pwTerminalOutput || '').toLowerCase();
        const tail = text.slice(-1200);
        return tail.includes('| idle') && !tail.includes('sending');
      },
      undefined,
      { timeout: timeoutMs }
    );

    if (shotDir && shotLabel) {
      await captureStepShot(window, shotDir, shotLabel);
      const rawTail = await window.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-120).join('\n'));
      const cleanedTail = stripAnsi(rawTail).replace(/\r/g, '').trim();
      console.log(`[openclaw:${shotLabel}] ${cleanedTail.slice(-2000)}`);
    }
  } catch (error) {
    const debugDir = path.join(workspaceRoot, 'screenshots', 'next-smoke');
    await captureStepShot(window, debugDir, `timeout-${Date.now()}`);
    const tail = await window.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-120).join('\n'));
    throw new Error(`Timed out waiting for openclaw response completion. Tail:\n${tail}\nOriginal: ${error.message}`);
  }
}

test('playwright: electron launches and terminal executes a command', { timeout: 120000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_E2E) {
    t.skip('Set RUN_PLAYWRIGHT_E2E=1 to run Electron Playwright tests');
    return;
  }

  const launched = await launchApp(t);
  if (!launched) return;

  const { app, window } = launched;

  try {
    const inputUiState = await window.evaluate(() => ({
      hasForm: Boolean(document.querySelector('#chat-input-form')),
      hasInput: Boolean(document.querySelector('#chat-input')),
      hasSendButton: Boolean(document.querySelector('#chat-send')),
    }));
    assert.equal(inputUiState.hasForm, false);
    assert.equal(inputUiState.hasInput, false);
    assert.equal(inputUiState.hasSendButton, false);

    const marker = '__PW_TERM_OK__';
    await runInTerminal(window, `echo "${marker}"`, marker, 30000);

    const terminalText = await window.evaluate(() => window.__pwTerminalOutput || '');
    assert.match(terminalText, new RegExp(marker));
  } finally {
    await closeApp(app);
  }
});

test('playwright: project history navigation restores per-project terminal sessions', { timeout: 180000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_E2E) {
    t.skip('Set RUN_PLAYWRIGHT_E2E=1 to run Electron Playwright tests');
    return;
  }

  const launched = await launchApp(t);
  if (!launched) return;

  const { app, window } = launched;

  try {
    await window.waitForSelector('.project-btn');
    const labels = (await window.locator('.project-btn').allTextContents())
      .map((s) => s.trim())
      .filter(Boolean);
    const target = labels.find((name) => name !== 'workspace');
    if (!target) {
      t.skip('No non-workspace project available to validate project history');
      return;
    }

    const markerA = `__PW_A_${Date.now()}__`;
    const markerW = `__PW_W_${Date.now()}__`;

    await window.locator(`.project-btn:has-text("${target}")`).first().click();
    await window.waitForFunction(
      (label) => {
        const el = document.getElementById('active-project');
        return Boolean(el && el.textContent && el.textContent.toLowerCase().includes(label.toLowerCase()));
      },
      target,
      { timeout: 30000 }
    );
    await runTypedInTerminal(window, `echo ${markerA}`, markerA, 30000);

    await window.locator('.project-btn:has-text("workspace")').first().click();
    await window.waitForFunction(() => {
      const el = document.getElementById('active-project');
      return Boolean(el && el.textContent && el.textContent.includes('workspace root'));
    }, undefined, { timeout: 30000 });
    await runTypedInTerminal(window, `echo ${markerW}`, markerW, 30000);

    await window.click('#preview-back');
    await window.waitForFunction(
      (label) => {
        const el = document.getElementById('active-project');
        return Boolean(el && el.textContent && el.textContent.toLowerCase().includes(label.toLowerCase()));
      },
      target,
      { timeout: 30000 }
    );

    const onBackText = await window.evaluate(() => window.__pwTerminalOutput || '');
    assert.match(onBackText, new RegExp(markerA));
    assert.doesNotMatch(onBackText, new RegExp(markerW));

    await window.click('#preview-forward');
    await window.waitForFunction(() => {
      const el = document.getElementById('active-project');
      return Boolean(el && el.textContent && el.textContent.includes('workspace root'));
    }, undefined, { timeout: 30000 });

    const onForwardText = await window.evaluate(() => window.__pwTerminalOutput || '');
    assert.match(onForwardText, new RegExp(markerW));
  } finally {
    await closeApp(app);
  }
});

test('playwright: codex edits renderer html and UI updates live', { timeout: 420000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_E2E) {
    t.skip('Set RUN_PLAYWRIGHT_E2E=1 to run Electron Playwright tests');
    return;
  }

  if (!process.env.RUN_CODEX_E2E) {
    t.skip('Set RUN_CODEX_E2E=1 to run Codex terminal generation test');
    return;
  }

  const targetRelPath = 'renderer/index.html';
  const targetAbsPath = path.join(workspaceRoot, targetRelPath);
  const originalHtml = await fs.readFile(targetAbsPath, 'utf8');
  const headlineMarker = `Realtime Codex Update ${Date.now()}`;

  const launched = await launchApp(t);
  if (!launched) return;

  const { app, window } = launched;

  try {
    const prompt = [
      `Edit only ${targetRelPath}.`,
      `Change the <h1> text to exactly: ${headlineMarker}.`,
      'Do not modify any other text or files.',
      'Return no markdown fences.',
    ].join(' ');

    const doneMarker = '__PW_CODEX_DONE__';
    const command = [
      'codex exec --skip-git-repo-check --sandbox workspace-write --color never',
      `-C ${shellEscape(workspaceRoot)}`,
      shellEscape(prompt),
      `; printf "\\n${doneMarker}:$?\\n"`,
    ].join(' ');

    await runInTerminal(window, command, `${doneMarker}:0`, 360000);

    const fileData = await window.evaluate(async ({ filePath }) => {
      return window.api.readFile(filePath);
    }, { filePath: targetRelPath });

    assert.ok(fileData.content.includes(headlineMarker));
    await window.waitForFunction(
      (marker) => {
        const h1 = document.querySelector('h1');
        return Boolean(h1 && h1.textContent && h1.textContent.includes(marker));
      },
      headlineMarker,
      { timeout: 30000 }
    );
  } finally {
    await fs.writeFile(targetAbsPath, originalHtml, 'utf8');
    // Allow the renderer watcher to pick up restore before process teardown.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await closeApp(app);
  }
});

test('playwright: codex usability via typed terminal input', { timeout: 240000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_E2E) {
    t.skip('Set RUN_PLAYWRIGHT_E2E=1 to run Electron Playwright tests');
    return;
  }

  if (!process.env.RUN_CODEX_USABILITY_E2E) {
    t.skip('Set RUN_CODEX_USABILITY_E2E=1 to run Codex usability test');
    return;
  }

  const launched = await launchApp(t);
  if (!launched) return;
  const { app, window } = launched;

  try {
    const marker = `__PW_CODEX_USABILITY_${Date.now()}__`;
    const prompt = `Reply with exactly: ${marker}`;
    const command = [
      'codex exec --skip-git-repo-check --sandbox workspace-write --color never',
      `-C ${shellEscape(workspaceRoot)}`,
      shellEscape(prompt),
      `; printf "\\n${marker}:$?\\n"`,
    ].join(' ');

    await runTypedInTerminal(window, command, `${marker}:0`, 180000);

    const terminalText = await window.evaluate(() => window.__pwTerminalOutput || '');
    assert.match(terminalText, new RegExp(`${marker}:0`));
    assert.match(terminalText, new RegExp(marker));
  } finally {
    await closeApp(app);
  }
});

test('playwright: openclaw tui prompt edits renderer html and UI updates live', { timeout: 420000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_E2E) {
    t.skip('Set RUN_PLAYWRIGHT_E2E=1 to run Electron Playwright tests');
    return;
  }

  if (!process.env.RUN_OPENCLAW_E2E) {
    t.skip('Set RUN_OPENCLAW_E2E=1 to run OpenClaw TUI live edit test');
    return;
  }

  const targetRelPath = 'renderer/index.html';
  const targetAbsPath = path.join(workspaceRoot, targetRelPath);
  const originalHtml = await fs.readFile(targetAbsPath, 'utf8');
  const headlineMarker = `Openclaw Live ${Date.now()}`;

  const launched = await launchAppWithOptions(t, {
    disableAutoTui: false,
    startupCommand: openclawStartupCommandForWorkspace(`pxcode-openclaw-e2e-${Date.now()}`),
  });
  if (!launched) return;

  const { app, window } = launched;

  try {
    await window.waitForFunction(
      () => {
        const text = window.__pwTerminalOutput || '';
        return text.includes('gateway connected') || text.includes('running');
      },
      undefined,
      { timeout: 120000 }
    );

    const prompt = [
      `In ${workspaceRoot}, edit only ${targetRelPath}.`,
      `Replace the existing <h1> text with exactly: ${headlineMarker}.`,
      'Do not touch any other file.',
    ].join(' ');

    await window.click('#terminal');
    await window.keyboard.type(prompt, { delay: 4 });
    await window.keyboard.press('Enter');

    await window.waitForFunction(
      ({ filePath, marker }) => window.api.readFile(filePath).then((f) => f.content.includes(marker)),
      { filePath: targetRelPath, marker: headlineMarker },
      { timeout: 300000 }
    );

    await window.waitForFunction(
      (marker) => {
        const h1 = document.querySelector('h1');
        return Boolean(h1 && h1.textContent && h1.textContent.includes(marker));
      },
      headlineMarker,
      { timeout: 30000 }
    );
  } finally {
    await fs.writeFile(targetAbsPath, originalHtml, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await closeApp(app);
  }
});

test('playwright: terminal creates a Next.js project and runs dev server', { timeout: 900000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_E2E) {
    t.skip('Set RUN_PLAYWRIGHT_E2E=1 to run Electron Playwright tests');
    return;
  }

  if (!process.env.RUN_NEXT_SMOKE) {
    t.skip('Set RUN_NEXT_SMOKE=1 to run Next.js terminal smoke test');
    return;
  }

  const launched = await launchAppWithOptions(t, {
    disableAutoTui: false,
    startupCommand: openclawStartupCommandForWorkspace(`pxcode-next-e2e-${Date.now()}`),
  });
  if (!launched) return;

  const { app, window } = launched;
  const projectDir = `projects/next-smoke-${Date.now()}`;
  let createdProjectPath = projectDir;
  let createdProjectName = path.basename(projectDir);
  const projectsAbsRoot = path.join(workspaceRoot, 'projects');
  const devPort = 4010;
  const helloMarker = `hello world from pxcode ${Date.now()}`;
  const step1TimeoutMs = 120000;
  const step2TimeoutMs = 180000;
  const shotDir = path.join(workspaceRoot, 'screenshots', 'next-smoke');
  const beforeProjectDirs = new Set(
    (await fs.readdir(projectsAbsRoot, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => `projects/${entry.name}`)
  );

  try {
    await window.waitForFunction(
      () => {
        const text = window.__pwTerminalOutput || '';
        return text.includes('gateway connected') || text.includes('running');
      },
      undefined,
      { timeout: 120000 }
    );
    await captureStepShot(window, shotDir, 'step-00-openclaw-ready');

    const step1Prompt =
      `Step 1 only: create a Next.js app in ${projectDir}. ` +
      `Use shell commands in this terminal.`;
    await runOpenclawPrompt(window, step1Prompt, step1TimeoutMs, {
      shotDir,
      shotLabel: 'step-01-openclaw-response',
    });
    await captureStepShot(window, shotDir, 'step-01-created-project');
    const afterProjectDirs = await (async () => {
      const deadline = Date.now() + step1TimeoutMs;
      while (Date.now() < deadline) {
        const entries = (await fs.readdir(projectsAbsRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => `projects/${entry.name}`);
        const newEntries = entries.filter((entry) => !beforeProjectDirs.has(entry));
        if (newEntries.length > 0) {
          return entries;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      return (await fs.readdir(projectsAbsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => `projects/${entry.name}`);
    })();
    const newProjectDirs = afterProjectDirs.filter((entry) => !beforeProjectDirs.has(entry));
    if (newProjectDirs.length === 0) {
      const tail = await window.evaluate(() => (window.__pwTerminalOutput || '').split('\n').slice(-120).join('\n'));
      assert.fail(`OpenClaw did not create a new project directory. Terminal tail:\n${tail}`);
    }
    createdProjectPath = newProjectDirs.find((entry) => entry.startsWith('projects/next-smoke-')) || newProjectDirs[0];
    createdProjectName = path.basename(createdProjectPath);
    await fs.access(path.join(workspaceRoot, createdProjectPath, 'package.json'));

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#chat-panel.open');
    const projectButton = window.locator(`button.project-btn:has-text("${createdProjectName}")`);
    await projectButton.waitFor({ state: 'visible', timeout: 30000 });
    await projectButton.click();
    await window.waitForFunction(
      (projectPath) => {
        const el = document.getElementById('active-project');
        return Boolean(el && el.textContent && el.textContent.includes(projectPath));
      },
      createdProjectPath,
      { timeout: 30000 }
    );
    await captureStepShot(window, shotDir, 'step-01b-selected-project');

    await window.waitForFunction(
      () => {
        const text = window.__pwTerminalOutput || '';
        return text.includes('gateway connected') || text.includes('running');
      },
      undefined,
      { timeout: 120000 }
    );

    const step2Prompt =
      `Step 2 only: in ${createdProjectPath}, update app/page.tsx so it renders exactly "${helloMarker}". ` +
      `Then start next dev on port ${devPort} in background and write a pid file. ` +
      `Use shell commands only.`;
    await runOpenclawPrompt(window, step2Prompt, step2TimeoutMs, {
      shotDir,
      shotLabel: 'step-02-openclaw-response',
    });
    await captureStepShot(window, shotDir, 'step-02-started-dev-server');

    const response = await waitForHttp(`http://127.0.0.1:${devPort}`, 120000);
    const html = await response.text();
    assert.equal(response.ok, true);
    assert.match(html.toLowerCase(), /hello world/);
    assert.match(html, new RegExp(helloMarker, 'i'));
    await captureStepShot(window, shotDir, 'step-03-http-verified');
  } finally {
    const step3Prompt =
      `Step 3 only: stop next dev in ${createdProjectPath} using the pid file if present. ` +
      `Use shell commands only.`;
    await runOpenclawPrompt(window, step3Prompt, 60000, {
      shotDir,
      shotLabel: 'step-04-openclaw-response',
    }).catch(() => {});
    await captureStepShot(window, shotDir, 'step-04-cleanup');
    await closeApp(app);
  }
});

test('playwright: switch project and run npm dev shows preview', { timeout: 240000 }, async (t) => {
  if (!process.env.RUN_PLAYWRIGHT_E2E) {
    t.skip('Set RUN_PLAYWRIGHT_E2E=1 to run Electron Playwright tests');
    return;
  }

  const projectName = `pixelbox-smoke-${Date.now()}`;
  const projectRel = `projects/${projectName}`;
  const projectAbs = path.join(workspaceRoot, projectRel);
  const port = 4123;
  const marker = `pixelbox smoke ${Date.now()}`;
  const packageJson = {
    name: projectName,
    private: true,
    version: '0.0.1',
    scripts: {
      dev: 'node dev-server.js',
    },
  };
  const serverJs = [
    "const http = require('node:http');",
    `const port = ${port};`,
    `const marker = ${JSON.stringify(marker)};`,
    'const server = http.createServer((_req, res) => {',
    "  res.setHeader('content-type', 'text/html; charset=utf-8');",
    "  res.end(`<html><body><h1>${marker}</h1></body></html>`);",
    '});',
    'server.listen(port, () => {',
    "  console.log(`http://127.0.0.1:${port}`);",
    '});',
    "process.on('SIGINT', () => server.close(() => process.exit(0)));",
  ].join('\n');

  await fs.mkdir(projectAbs, { recursive: true });
  await fs.writeFile(path.join(projectAbs, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(projectAbs, 'dev-server.js'), `${serverJs}\n`, 'utf8');

  const launched = await launchApp(t);
  if (!launched) return;
  const { app, window } = launched;

  try {
    const projectButton = window.locator(`button.project-btn:has-text("${projectName}")`);
    await projectButton.waitFor({ state: 'visible', timeout: 30000 });
    await projectButton.click();
    await window.waitForFunction(
      (projectPath) => {
        const el = document.getElementById('active-project');
        return Boolean(el && el.textContent && el.textContent.includes(projectPath));
      },
      projectRel,
      { timeout: 30000 }
    );

    await window.click('#terminal');
    const beforeScriptsCheck = await window.evaluate(() => (window.__pwTerminalOutput || '').length);
    await window.keyboard.type('npm run', { delay: 2 });
    await window.keyboard.press('Enter');
    await window.waitForFunction(
      ({ baseline }) => {
        const text = window.__pwTerminalOutput || '';
        if (text.length <= baseline) return false;
        const tail = text.slice(-4000).toLowerCase();
        return tail.includes('scripts available') && tail.includes('dev');
      },
      { baseline: beforeScriptsCheck },
      { timeout: 30000 }
    );

    await window.click('#terminal');
    await window.keyboard.type('npm run dev', { delay: 2 });
    await window.keyboard.press('Enter');

    const expectedUrl = `http://127.0.0.1:${port}`;
    await window.waitForFunction(
      (url) => {
        const label = document.getElementById('preview-url');
        return Boolean(label && label.textContent && label.textContent.includes(url));
      },
      expectedUrl,
      { timeout: 60000 }
    );

    await window.waitForFunction(
      (url) => {
        const frame = document.getElementById('preview-frame');
        return Boolean(frame && frame.getAttribute('src') && frame.getAttribute('src').includes(url));
      },
      expectedUrl,
      { timeout: 60000 }
    );

    const response = await waitForHttp(expectedUrl, 30000);
    const html = await response.text();
    assert.match(html, new RegExp(marker));
  } finally {
    await window.evaluate(() => {
      window.api.writeTerminal('\u0003');
    }).catch(() => {});
    await closeApp(app);
  }
});
