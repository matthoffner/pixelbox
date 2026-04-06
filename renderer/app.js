const term = new Terminal({
  fontSize: 13,
  cursorBlink: true,
  disableStdin: false,
  theme: {
    background: '#0f1e33',
    foreground: '#e4eeff',
  },
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));

const panel = document.getElementById('chat-panel');
const toggle = document.getElementById('chat-toggle');
const minimize = document.getElementById('chat-minimize');
const primaryAction = document.getElementById('primary-action');
const terminalEl = document.getElementById('terminal');
const projectsListEl = document.getElementById('projects-list');
const activeProjectEl = document.getElementById('active-project');
const newProjectBtn = document.getElementById('new-project');
const projectsToggleEl = document.getElementById('projects-toggle');
const projectsMinimizeEl = document.getElementById('projects-minimize');
const headlineEl = document.getElementById('headline');
const previewFrameHostEl = document.getElementById('preview-frame-host');
const previewBackEl = document.getElementById('preview-back');
const previewForwardEl = document.getElementById('preview-forward');
const previewReloadEl = document.getElementById('preview-reload');
const previewEmptyStateEl = document.getElementById('preview-empty-state');
const runningPageTypeEl = document.getElementById('running-page-type');
const runningPageHtmlEl = document.getElementById('running-page-html');
const runningPageCommandEl = document.getElementById('running-page-command');
const runningPageUrlInputEl = document.getElementById('running-page-url-input');
const runningPageAutostartEl = document.getElementById('running-page-autostart');
const runningPageSaveEl = document.getElementById('running-page-save');
const runningPageStartEl = document.getElementById('running-page-start');
const runningPageStopEl = document.getElementById('running-page-stop');
const runningPageStatusEl = document.getElementById('running-page-status');

const previewFieldRows = [...document.querySelectorAll('[data-source]')];

window.__pwTerminalOutput = '';
let reloadTimer;
let selectedProjectPath = '.';
let startResult;
let projectsPanelHidden = true;
const projectPreviewState = new Map();
const projectRuntimeConfig = new Map();
const projectRuntimeStatus = new Map();
const projectTerminalOutput = new Map();
const projectSessionBootstrapped = new Set();
const projectSessionExited = new Set();
const projectSelectionHistory = ['.'];
let projectSelectionIndex = 0;
const PIXELBOX_CONTEXT_START = '<!-- PIXELBOX_CONTEXT_START -->';
const PIXELBOX_CONTEXT_END = '<!-- PIXELBOX_CONTEXT_END -->';

const previewFrameEl = document.createElement('webview');
previewFrameEl.id = 'preview-frame';
previewFrameEl.setAttribute('allowpopups', 'true');
previewFrameHostEl.appendChild(previewFrameEl);

function defaultRuntimeConfig() {
  return {
    sourceType: 'none',
    htmlPath: '',
    serverCommand: '',
    serverUrl: '',
    autoStart: true,
  };
}

function configPathForProject(projectPath) {
  return projectPath === '.' ? '.pxcode/workspace-preview.json' : `${projectPath}/.pxcode/preview.json`;
}

function stripAnsi(input) {
  if (!input) return '';
  return input
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-ntqry=><~]|(?:[^\u001B]*\u001B\\))/g, '');
}

function sanitizePreviewUrl(rawUrl) {
  return stripAnsi(rawUrl)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/[),.;]+$/, '');
}

function sanitizeProjectName(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function pixelboxContextBlock() {
  return [
    PIXELBOX_CONTEXT_START,
    '# Pixelbox Project Context',
    '',
    'This project is being edited and run inside Pixelbox.',
    '',
    '## Working Rules',
    '- Keep the main app visually clean and full-bleed where possible.',
    '- Prefer deterministic local dev servers and print the live URL on its own line when ready.',
    '- Use localhost/127.0.0.1 URLs that can be embedded in an Electron webview.',
    '- Avoid interactive shell prompts in automation flows; prefer explicit non-interactive commands.',
    '- If adding scripts, ensure `npm run dev` works without extra manual steps.',
    '',
    '## Fast Output Contract',
    '- After completing a task, summarize changed files and exact run commands.',
    '- If a server is started, include the exact URL and port in plain text.',
    '',
    '## Dual-Agent Coordination',
    '- Agent lane A (editor): code changes, refactors, UI updates.',
    '- Agent lane B (runtime): start/stop servers, logs, runtime health.',
    '- Write concise handoffs to `.pixelbox/handoff.md` so both lanes stay synced.',
    '- Before acting, read latest handoff entry to avoid stepping on active work.',
    PIXELBOX_CONTEXT_END,
    '',
  ].join('\n');
}

async function ensureAgentHandoffFile(projectPath) {
  const handoffPath = projectPath === '.'
    ? '.pixelbox/handoff.md'
    : `${projectPath}/.pixelbox/handoff.md`;
  const { content } = await window.api.readFile(handoffPath);
  if ((content || '').trim()) return;
  const seed = [
    '# Pixelbox Agent Handoff',
    '',
    'Use this file to coordinate between editor/runtime lanes.',
    '',
    '## Latest',
    '- lane: setup',
    '- status: initialized',
    '- next: choose editor/runtime owner for current task',
    '',
  ].join('\n');
  await window.api.writeFile(handoffPath, `${seed}\n`);
}

async function ensurePixelboxProjectContext(projectPath) {
  const targetPath = projectPath === '.' ? 'AGENTS.md' : `${projectPath}/AGENTS.md`;
  const { content } = await window.api.readFile(targetPath);
  const existing = content || '';
  if (existing.includes(PIXELBOX_CONTEXT_START) && existing.includes(PIXELBOX_CONTEXT_END)) return;
  const block = pixelboxContextBlock();
  const nextContent = existing.trim()
    ? `${existing.trimEnd()}\n\n${block}`
    : block;
  await window.api.writeFile(targetPath, nextContent);
}

function applyLayoutVariant(index) {
  document.body.classList.remove('layout-0', 'layout-1', 'layout-2');
  document.body.classList.add(`layout-${index % 3}`);
}

function ensurePreviewState(projectPath) {
  if (!projectPreviewState.has(projectPath)) {
    projectPreviewState.set(projectPath, { history: [], index: -1 });
  }
  return projectPreviewState.get(projectPath);
}

function replacePreviewHistory(projectPath, history = [], index = -1) {
  const filtered = history
    .map((value) => sanitizePreviewUrl(value))
    .filter((value) => /^https?:\/\//i.test(value) || value.startsWith('file://'));
  const state = ensurePreviewState(projectPath);
  state.history = filtered;
  state.index = filtered.length === 0 ? -1 : Math.min(Math.max(index, 0), filtered.length - 1);
  return state;
}

function currentPreviewUrl(state) {
  if (state.index < 0 || state.index >= state.history.length) return '';
  return state.history[state.index] || '';
}

function updateProjectNavigationControls() {
  if (previewBackEl) previewBackEl.disabled = projectSelectionIndex <= 0;
  if (previewForwardEl) previewForwardEl.disabled = projectSelectionIndex >= projectSelectionHistory.length - 1;
}

function updatePreviewControls(state) {
  if (previewReloadEl) previewReloadEl.disabled = state.index < 0;
  updateProjectNavigationControls();
}

function renderProjectsPanelVisibility() {
  document.body.classList.toggle('projects-panel-hidden', projectsPanelHidden);
}

function renderPreviewForProject(projectPath) {
  const state = ensurePreviewState(projectPath);
  const url = currentPreviewUrl(state);
  if (!url) {
    previewFrameEl.src = 'about:blank';
    previewEmptyStateEl.style.display = 'grid';
    updatePreviewControls(state);
    return;
  }

  previewEmptyStateEl.style.display = 'none';
  if (previewFrameEl.src !== url) {
    previewFrameEl.src = url;
  }
  updatePreviewControls(state);
}

async function persistPreviewState(projectPath) {
  const config = {
    ...(projectRuntimeConfig.get(projectPath) || defaultRuntimeConfig()),
  };
  const state = ensurePreviewState(projectPath);
  const payload = {
    ...config,
    history: state.history,
    index: state.index,
  };
  await window.api.writeFile(configPathForProject(projectPath), `${JSON.stringify(payload, null, 2)}\n`);
}

async function pushPreviewUrl(projectPath, rawUrl, options = {}) {
  const url = sanitizePreviewUrl(rawUrl);
  if (!/^https?:\/\//i.test(url) && !url.startsWith('file://')) return;
  const state = ensurePreviewState(projectPath);
  const current = currentPreviewUrl(state);
  if (current === url) return;
  state.history = state.history.slice(0, state.index + 1);
  state.history.push(url);
  state.index = state.history.length - 1;

  if (!options.skipPersist) {
    await persistPreviewState(projectPath);
  }
  if (projectPath === selectedProjectPath) renderPreviewForProject(projectPath);
}

function appendTerminalOutput(projectPath, data) {
  const next = `${projectTerminalOutput.get(projectPath) || ''}${data}`;
  projectTerminalOutput.set(projectPath, next);
  if (projectPath === selectedProjectPath) {
    window.__pwTerminalOutput = next;
  }
}

function syncTerminalSize() {
  fitAddon.fit();

  if (term.cols < 20 || term.rows < 5) {
    const width = terminalEl.clientWidth || panel.clientWidth || 800;
    const height = terminalEl.clientHeight || panel.clientHeight || 420;
    const fallbackCols = Math.max(80, Math.floor(width / 8));
    const fallbackRows = Math.max(24, Math.floor(height / 18));
    term.resize(fallbackCols, fallbackRows);
  }

  window.api.resizeTerminal(term.cols, term.rows);
}

function focusTerminal() {
  term.focus();
}

function openPanel() {
  panel.classList.add('open');
  toggle.style.display = 'none';
  document.body.classList.add('terminal-active');
  requestAnimationFrame(() => {
    syncTerminalSize();
    focusTerminal();
  });
}

function closePanel() {
  panel.classList.remove('open');
  toggle.style.display = 'inline-flex';
  document.body.classList.remove('terminal-active');
}

function projectButton(label, relPath, active, clickHandler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `project-btn${active ? ' active' : ''}`;
  btn.textContent = label;
  btn.addEventListener('click', () => clickHandler(relPath));
  return btn;
}

function renderRunningPageFields(sourceType) {
  for (const row of previewFieldRows) {
    row.hidden = row.dataset.source !== sourceType;
  }
  runningPageStartEl.disabled = sourceType !== 'server';
  runningPageStopEl.disabled = sourceType !== 'server';
}

function renderRuntimeStatus(projectPath) {
  const config = projectRuntimeConfig.get(projectPath) || defaultRuntimeConfig();
  const status = projectRuntimeStatus.get(projectPath) || { running: false };
  if (config.sourceType === 'none') {
    runningPageStatusEl.textContent = 'Not configured';
    return;
  }
  if (config.sourceType === 'html') {
    runningPageStatusEl.textContent = config.htmlPath ? `HTML: ${config.htmlPath}` : 'HTML file missing';
    return;
  }
  if (status.running) {
    runningPageStatusEl.textContent = 'Server live';
    return;
  }
  runningPageStatusEl.textContent = 'Server stopped';
}

function renderRuntimeConfig(projectPath) {
  const config = projectRuntimeConfig.get(projectPath) || defaultRuntimeConfig();
  runningPageTypeEl.value = config.sourceType;
  runningPageHtmlEl.value = config.htmlPath || '';
  runningPageCommandEl.value = config.serverCommand || '';
  runningPageUrlInputEl.value = config.serverUrl || '';
  runningPageAutostartEl.checked = config.autoStart !== false;
  renderRunningPageFields(config.sourceType);
  renderRuntimeStatus(projectPath);
}

async function loadRuntimeConfig(projectPath) {
  try {
    const { content } = await window.api.readFile(configPathForProject(projectPath));
    const parsed = JSON.parse(content);
    const config = {
      ...defaultRuntimeConfig(),
      ...parsed,
    };
    projectRuntimeConfig.set(projectPath, config);
    replacePreviewHistory(projectPath, parsed.history || [], Number.isInteger(parsed.index) ? parsed.index : -1);
    return config;
  } catch {
    const config = defaultRuntimeConfig();
    projectRuntimeConfig.set(projectPath, config);
    replacePreviewHistory(projectPath, [], -1);
    return config;
  }
}

function collectRuntimeConfigFromForm() {
  return {
    sourceType: runningPageTypeEl.value,
    htmlPath: runningPageHtmlEl.value.trim(),
    serverCommand: runningPageCommandEl.value.trim(),
    serverUrl: runningPageUrlInputEl.value.trim(),
    autoStart: runningPageAutostartEl.checked,
  };
}

async function applyRuntimeConfig(projectPath, config, options = {}) {
  projectRuntimeConfig.set(projectPath, config);

  if (config.sourceType === 'html') {
    if (!config.htmlPath) {
      throw new Error('HTML file path is required');
    }
    const basePath = projectPath === '.' ? config.htmlPath : `${projectPath}/${config.htmlPath}`;
    const resolved = await window.api.resolvePreviewHtmlFile(basePath);
    replacePreviewHistory(projectPath, [resolved.url], 0);
    projectRuntimeStatus.set(projectPath, { running: false, sourceType: 'html', url: resolved.url });
    await window.api.stopPreviewRuntime(projectPath);
  } else if (config.sourceType === 'server') {
    if (!config.serverCommand) {
      throw new Error('Server command is required');
    }
    const explicitUrls = config.serverUrl ? [config.serverUrl] : [];
    const currentState = ensurePreviewState(projectPath);
    const history = currentState.history.length > 0 ? currentState.history : explicitUrls;
    replacePreviewHistory(projectPath, history, history.length > 0 ? Math.max(currentState.index, 0) : -1);
    projectRuntimeStatus.set(projectPath, {
      running: false,
      sourceType: 'server',
      url: config.serverUrl,
    });
    await window.api.syncPreviewRuntime(projectPath, {
      sourceType: 'server',
      command: config.serverCommand,
      url: config.serverUrl,
      autoStart: options.forceStart ? true : config.autoStart,
    });
  } else {
    replacePreviewHistory(projectPath, [], -1);
    projectRuntimeStatus.set(projectPath, { running: false, sourceType: 'none', url: '' });
    await window.api.stopPreviewRuntime(projectPath);
  }

  await persistPreviewState(projectPath);

  if (projectPath === selectedProjectPath) {
    renderRuntimeConfig(projectPath);
    renderPreviewForProject(projectPath);
  }
}

async function saveRunningPageConfig() {
  const config = collectRuntimeConfigFromForm();
  try {
    await applyRuntimeConfig(selectedProjectPath, config);
  } catch (error) {
    window.alert(error.message);
  }
}

async function startConfiguredRuntime() {
  const config = collectRuntimeConfigFromForm();
  if (config.sourceType !== 'server') return;
  try {
    await applyRuntimeConfig(selectedProjectPath, config, { forceStart: true });
  } catch (error) {
    window.alert(error.message);
  }
}

async function stopConfiguredRuntime() {
  const config = {
    ...(projectRuntimeConfig.get(selectedProjectPath) || defaultRuntimeConfig()),
  };
  await window.api.stopPreviewRuntime(selectedProjectPath);
  projectRuntimeStatus.set(selectedProjectPath, {
    running: false,
    sourceType: config.sourceType,
    url: config.serverUrl || currentPreviewUrl(ensurePreviewState(selectedProjectPath)) || '',
  });
  renderRuntimeStatus(selectedProjectPath);
}

async function bootTerminalForPath(relPath, shouldRunStartup = false, forceStartup = false) {
  const shouldBootstrapProject = shouldRunStartup && (forceStartup || !projectSessionBootstrapped.has(relPath));
  const startupCommand = shouldBootstrapProject
    ? await window.api.getStartupTerminalCommand({
      hasPseudoTTY: Boolean(startResult && startResult.hasPseudoTTY),
      cwd: relPath,
    })
    : '';
  const result = await window.api.startTerminal(relPath, { startupCommand });
  startResult = result;
  projectSessionBootstrapped.add(relPath);
  projectSessionExited.delete(relPath);

  window.__pwTerminalOutput = projectTerminalOutput.get(relPath) || '';
  term.reset();
  if (window.__pwTerminalOutput) {
    term.write(window.__pwTerminalOutput);
  }

  requestAnimationFrame(() => {
    syncTerminalSize();
    focusTerminal();
  });
}

function recordProjectSelection(relPath) {
  if (projectSelectionHistory[projectSelectionIndex] === relPath) {
    updateProjectNavigationControls();
    return;
  }
  projectSelectionHistory.splice(projectSelectionIndex + 1);
  projectSelectionHistory.push(relPath);
  projectSelectionIndex = projectSelectionHistory.length - 1;
  updateProjectNavigationControls();
}

async function renderProjects() {
  await window.api.mkdir('projects');
  const entries = await window.api.listDir('projects');
  const projects = entries.filter((entry) => entry.type === 'directory');

  projectsListEl.innerHTML = '';
  projectsListEl.appendChild(projectButton('workspace', '.', selectedProjectPath === '.', selectProject));

  for (const project of projects) {
    projectsListEl.appendChild(
      projectButton(project.name, project.path, selectedProjectPath === project.path, selectProject)
    );
  }

  const activeLabel = selectedProjectPath === '.' ? 'workspace root' : selectedProjectPath;
  activeProjectEl.textContent = `Active: ${activeLabel}`;
  headlineEl.textContent = selectedProjectPath === '.' ? 'Build Directly From The App' : `Project: ${activeLabel}`;

  applyLayoutVariant(0);
}

async function selectProject(relPath, options = {}) {
  const { recordHistory = true } = options;
  selectedProjectPath = relPath;
  if (recordHistory) {
    recordProjectSelection(relPath);
  } else {
    updateProjectNavigationControls();
  }

  await renderProjects();
  await ensurePixelboxProjectContext(selectedProjectPath);
  await ensureAgentHandoffFile(selectedProjectPath);
  await bootTerminalForPath(selectedProjectPath, true, projectSessionExited.has(selectedProjectPath));
  const config = await loadRuntimeConfig(selectedProjectPath);
  renderRuntimeConfig(selectedProjectPath);
  try {
    await applyRuntimeConfig(selectedProjectPath, config);
  } catch (error) {
    runningPageStatusEl.textContent = error.message;
    renderPreviewForProject(selectedProjectPath);
  }
}

async function createProject() {
  const value = window.prompt('Project name');
  if (!value) return;
  const projectName = sanitizeProjectName(value);
  if (!projectName) {
    window.alert('Use letters, numbers, dashes, or underscores.');
    return;
  }

  const relPath = `projects/${projectName}`;
  await window.api.mkdir(relPath);
  await window.api.writeFile(`${relPath}/README.md`, `# ${projectName}\n\nCreated from Pixelbox.\n`);
  await ensurePixelboxProjectContext(relPath);
  await ensureAgentHandoffFile(relPath);
  await selectProject(relPath, { recordHistory: true });
}

window.api.onTerminalData(({ key, data }) => {
  appendTerminalOutput(key, data);
  if (key === selectedProjectPath) {
    term.write(data);
  }

  const cleanData = stripAnsi(data);
  const matches = cleanData.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}[^\s"'<>)\]]*/gi) || [];
  for (const match of matches) {
    pushPreviewUrl(key, match).catch(() => {});
  }
});

window.api.onPreviewStatus(({ key, running, url, configuredUrl, sourceType }) => {
  projectRuntimeStatus.set(key, {
    running,
    sourceType,
    url: url || configuredUrl || '',
  });

  if (url) {
    pushPreviewUrl(key, url).catch(() => {});
  } else if (configuredUrl && sourceType === 'server') {
    pushPreviewUrl(key, configuredUrl).catch(() => {});
  }

  if (key === selectedProjectPath) {
    renderRuntimeStatus(key);
  }
});

term.onData((data) => {
  if (projectSessionExited.has(selectedProjectPath)) {
    bootTerminalForPath(selectedProjectPath, true, true)
      .then(() => {
        window.api.writeTerminal(data);
      })
      .catch(() => {});
    return;
  }
  window.api.writeTerminal(data);
});

window.api.onTerminalExit(({ key }) => {
  if (!key) return;
  projectSessionExited.add(key);
  appendTerminalOutput(key, '\r\n[terminal exited]');
  if (key === selectedProjectPath) {
    term.writeln('\r\n[terminal exited]');
  }
});

window.api.onRendererChanged(() => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    window.location.reload();
  }, 120);
});

toggle.addEventListener('click', openPanel);
primaryAction.addEventListener('click', openPanel);
minimize.addEventListener('click', closePanel);
newProjectBtn.addEventListener('click', createProject);
projectsToggleEl.addEventListener('click', () => {
  projectsPanelHidden = false;
  renderProjectsPanelVisibility();
});
projectsMinimizeEl.addEventListener('click', () => {
  projectsPanelHidden = true;
  renderProjectsPanelVisibility();
});
terminalEl.addEventListener('mousedown', focusTerminal);
panel.addEventListener('mousedown', focusTerminal);
runningPageTypeEl.addEventListener('change', () => renderRunningPageFields(runningPageTypeEl.value));
runningPageSaveEl.addEventListener('click', () => {
  saveRunningPageConfig().catch(() => {});
});
runningPageStartEl.addEventListener('click', () => {
  startConfiguredRuntime().catch(() => {});
});
runningPageStopEl.addEventListener('click', () => {
  stopConfiguredRuntime().catch(() => {});
});
if (previewBackEl) {
  previewBackEl.addEventListener('click', () => {
    if (projectSelectionIndex <= 0) return;
    projectSelectionIndex -= 1;
    selectProject(projectSelectionHistory[projectSelectionIndex], { recordHistory: false }).catch(() => {});
  });
}
if (previewForwardEl) {
  previewForwardEl.addEventListener('click', () => {
    if (projectSelectionIndex >= projectSelectionHistory.length - 1) return;
    projectSelectionIndex += 1;
    selectProject(projectSelectionHistory[projectSelectionIndex], { recordHistory: false }).catch(() => {});
  });
}

function reloadActivePreview() {
  const state = ensurePreviewState(selectedProjectPath);
  const url = currentPreviewUrl(state);
  if (!url) return;
  if (typeof previewFrameEl.reload === 'function') {
    previewFrameEl.reload();
    return;
  }
  previewFrameEl.src = url;
}

if (previewReloadEl) {
  previewReloadEl.addEventListener('click', reloadActivePreview);
}
window.api.onAppRefreshShortcut(() => {
  reloadActivePreview();
});

window.addEventListener('resize', () => {
  if (!panel.classList.contains('open')) return;
  syncTerminalSize();
});

(async () => {
  await window.api.startRendererWatch();
  openPanel();
  await renderProjects();
  await bootTerminalForPath(selectedProjectPath, true);
  await loadRuntimeConfig(selectedProjectPath);
  renderRuntimeConfig(selectedProjectPath);
  try {
    await applyRuntimeConfig(selectedProjectPath, projectRuntimeConfig.get(selectedProjectPath) || defaultRuntimeConfig());
  } catch (error) {
    runningPageStatusEl.textContent = error.message;
    renderPreviewForProject(selectedProjectPath);
  }
  updateProjectNavigationControls();
  renderProjectsPanelVisibility();
})();
