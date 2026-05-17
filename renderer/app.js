const panel = document.getElementById('chat-panel');
const chatHeaderEl = document.getElementById('chat-header');
const projectsPanelEl = document.getElementById('projects-panel');
const projectsHeaderEl = document.querySelector('.projects-header');
const toggle = document.getElementById('chat-toggle');
const minimize = document.getElementById('chat-minimize');
const chatDockFloatEl = document.getElementById('chat-dock-float');
const chatDockRightEl = document.getElementById('chat-dock-right');
const chatDockBottomEl = document.getElementById('chat-dock-bottom');
const chatResizeHandleEls = [...document.querySelectorAll('.chat-resize-handle')];
const primaryAction = document.getElementById('primary-action');
const terminalEl = document.getElementById('terminal');
const projectsListEl = document.getElementById('projects-list');
const activeProjectEl = document.getElementById('active-project');
const newProjectBtn = document.getElementById('new-project');
const newProjectFormEl = document.getElementById('new-project-form');
const newProjectNameEl = document.getElementById('new-project-name');
const newProjectCreateEl = document.getElementById('new-project-create');
const newProjectCancelEl = document.getElementById('new-project-cancel');
const projectsToggleEl = document.getElementById('projects-toggle');
const projectsMinimizeEl = document.getElementById('projects-minimize');
const hiddenProjectsToggleEl = document.getElementById('hidden-projects-toggle');
const hiddenProjectsListEl = document.getElementById('hidden-projects-list');
const headlineEl = document.getElementById('headline');
const previewFrameHostEl = document.getElementById('preview-frame-host');
const previewViewportEl = document.getElementById('preview-viewport');
const previewBackEl = document.getElementById('preview-back');
const previewForwardEl = document.getElementById('preview-forward');
const previewReloadEl = document.getElementById('preview-reload');
const previewSubtitleEl = document.getElementById('preview-subtitle');
const previewUrlEl = document.getElementById('preview-url');
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
const agentMonitorRefreshEl = document.getElementById('agent-monitor-refresh');
const agentMonitorStatusEl = document.getElementById('agent-monitor-status');
const agentMonitorListEl = document.getElementById('agent-monitor-list');
const aiCliSelectEl = document.getElementById('ai-cli-select');
const codexDangerousToggleEl = document.getElementById('codex-dangerous-toggle');
const codexLaunchStatusEl = document.getElementById('codex-launch-status');
const codexLaunchNoteEl = document.getElementById('codex-launch-note');

const previewFieldRows = [...document.querySelectorAll('[data-source]')];
const prefersVibrantWindow = navigator.platform.toLowerCase().includes('mac');

if (prefersVibrantWindow) {
  document.body.classList.add('vibrant-window');
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    schedulePreviewCaptureRegionPublish();
  });
}

if (typeof ResizeObserver !== 'undefined' && previewViewportEl) {
  const previewViewportObserver = new ResizeObserver(() => {
    schedulePreviewCaptureRegionPublish();
  });
  previewViewportObserver.observe(previewViewportEl);
}

window.__pwTerminalOutput = '';
let reloadTimer;
let selectedProjectPath = '.';
let startResult;
let projectsPanelHidden = false;
let hiddenProjectsExpanded = false;
let openProjectActionsPath = null;
const hiddenProjects = new Set();
const projectPreviewState = new Map();
const projectRuntimeConfig = new Map();
const projectRuntimeStatus = new Map();
const projectTerminalOutput = new Map();
const projectNativeStartupCommand = new Map();
const projectSessionBootstrapped = new Set();
const projectSessionExited = new Set();
const projectSelectionHistory = ['.'];
let projectSelectionIndex = 0;
let nativeTerminalPanelSyncRaf = 0;
let terminalResizePointer = null;
let terminalDragPointer = null;
let terminalMouseDrag = null;
let projectsDragPointer = null;
let projectsMouseDrag = null;
let agentMonitorPollTimer = null;
let previewCaptureRegionRaf = 0;
const agentMonitorStoppingPids = new Set();
let selectedAiCli = 'codex';
let codexDangerouslyBypassPermissions = false;
let lastProjectSwitchShortcut = { direction: 0, at: 0 };
const terminalLayoutState = {
  mode: 'float',
  width: 680,
  height: 520,
};
const projectsPanelState = {
  left: 16,
  top: 100,
};
const PIXELBOX_CONTEXT_START = '<!-- PIXELBOX_CONTEXT_START -->';
const PIXELBOX_CONTEXT_END = '<!-- PIXELBOX_CONTEXT_END -->';
const TERMINAL_MIN_WIDTH = 420;
const TERMINAL_MIN_COLS = 80;
const TERMINAL_MIN_ROWS = 24;
const TERMINAL_CELL_WIDTH = 8.4;
const TERMINAL_CELL_HEIGHT = 18;
const MAX_PROJECT_TERMINAL_OUTPUT = 200000;
const LAST_SELECTED_PROJECT_KEY = 'pixelbox.lastSelectedProject';
const PROJECTS_PANEL_HIDDEN_KEY = 'pixelbox.projectsPanelHidden';
const PROJECTS_PANEL_POSITION_KEY = 'pixelbox.projectsPanelPosition';
const HIDDEN_PROJECTS_EXPANDED_KEY = 'pixelbox.hiddenProjectsExpanded';
const AI_CLI_KEY = 'pixelbox.aiCli';
const CODEX_DANGEROUS_BYPASS_KEY = 'pixelbox.codexDangerouslyBypassPermissions';
const SUPPORTED_AI_CLIS = ['codex', 'claude', 'gemini', 'hermes', 'openclaw', 'custom'];
const terminalGridState = {
  cols: 120,
  rows: 30,
};

const previewFrameEl = document.createElement('iframe');
previewFrameEl.id = 'preview-frame';
previewFrameEl.setAttribute('title', 'Preview');
previewFrameEl.setAttribute('referrerpolicy', 'no-referrer');
previewFrameHostEl.appendChild(previewFrameEl);

function loadHiddenProjects() {
  try {
    const raw = window.localStorage.getItem('pixelbox.hiddenProjects');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (typeof entry === 'string' && entry.startsWith('projects/')) {
        hiddenProjects.add(entry);
      }
    }
  } catch {}
}

function persistHiddenProjects() {
  try {
    window.localStorage.setItem('pixelbox.hiddenProjects', JSON.stringify([...hiddenProjects]));
  } catch {}
}

function loadHiddenProjectsExpanded() {
  try {
    return window.localStorage.getItem(HIDDEN_PROJECTS_EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

function persistHiddenProjectsExpanded() {
  try {
    window.localStorage.setItem(HIDDEN_PROJECTS_EXPANDED_KEY, hiddenProjectsExpanded ? '1' : '0');
  } catch {}
}

function loadLastSelectedProject() {
  try {
    const value = window.localStorage.getItem(LAST_SELECTED_PROJECT_KEY);
    if (!value) return '.';
    if (value === '.' || value.startsWith('projects/')) return value;
  } catch {}
  return '.';
}

function persistLastSelectedProject(projectPath) {
  try {
    window.localStorage.setItem(LAST_SELECTED_PROJECT_KEY, projectPath);
  } catch {}
}

function loadProjectsPanelHidden() {
  try {
    return window.localStorage.getItem(PROJECTS_PANEL_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function persistProjectsPanelHidden() {
  try {
    window.localStorage.setItem(PROJECTS_PANEL_HIDDEN_KEY, projectsPanelHidden ? '1' : '0');
  } catch {}
}

function loadProjectsPanelPosition() {
  try {
    const raw = window.localStorage.getItem(PROJECTS_PANEL_POSITION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.left)) {
      projectsPanelState.left = Math.max(0, Math.floor(parsed.left));
    }
    if (parsed && Number.isFinite(parsed.top)) {
      projectsPanelState.top = Math.max(0, Math.floor(parsed.top));
    }
  } catch {}
}

function persistProjectsPanelPosition() {
  try {
    window.localStorage.setItem(PROJECTS_PANEL_POSITION_KEY, JSON.stringify(projectsPanelState));
  } catch {}
}

function loadSelectedAiCli() {
  try {
    const value = window.localStorage.getItem(AI_CLI_KEY);
    if (value && SUPPORTED_AI_CLIS.includes(value)) {
      return value;
    }
  } catch {}
  return 'codex';
}

function persistSelectedAiCli() {
  try {
    window.localStorage.setItem(AI_CLI_KEY, selectedAiCli);
  } catch {}
}

function loadCodexDangerouslyBypassPermissions() {
  try {
    return window.localStorage.getItem(CODEX_DANGEROUS_BYPASS_KEY) === '1';
  } catch {
    return false;
  }
}

function persistCodexDangerouslyBypassPermissions() {
  try {
    window.localStorage.setItem(
      CODEX_DANGEROUS_BYPASS_KEY,
      codexDangerouslyBypassPermissions ? '1' : '0'
    );
  } catch {}
}

function aiCliLabel(value) {
  switch (value) {
    case 'claude':
      return 'Claude';
    case 'gemini':
      return 'Gemini';
    case 'hermes':
      return 'Hermes';
    case 'openclaw':
      return 'OpenClaw TUI';
    case 'custom':
      return 'Plain terminal';
    case 'codex':
    default:
      return 'Codex';
  }
}

function aiCliSupportsDangerousBypass(value) {
  return value === 'codex' || value === 'claude';
}

function renderCodexLaunchConfig() {
  if (aiCliSelectEl) {
    aiCliSelectEl.value = selectedAiCli;
  }
  if (codexDangerousToggleEl) {
    codexDangerousToggleEl.checked = codexDangerouslyBypassPermissions;
    codexDangerousToggleEl.disabled = !aiCliSupportsDangerousBypass(selectedAiCli);
  }
  if (codexLaunchStatusEl) {
    const mode = aiCliSupportsDangerousBypass(selectedAiCli)
      ? (codexDangerouslyBypassPermissions ? 'danger mode' : 'default permissions')
      : 'standard launch';
    codexLaunchStatusEl.textContent = `${aiCliLabel(selectedAiCli)} · ${mode}`;
  }
  if (codexLaunchNoteEl) {
    codexLaunchNoteEl.textContent = 'Applies the next time Pixelbox auto-starts the selected CLI. Dangerous bypass is used for Codex and Claude only. Plain terminal opens the shell without auto-launching an agent CLI.';
  }
}

function renderProjectsPanelPosition() {
  if (!projectsPanelEl) return;
  const rect = projectsPanelEl.getBoundingClientRect();
  const width = rect.width || projectsPanelEl.offsetWidth || 340;
  const height = rect.height || projectsPanelEl.offsetHeight || 520;
  const maxLeft = Math.max(0, window.innerWidth - width - 12);
  const maxTop = Math.max(0, window.innerHeight - height - 12);
  projectsPanelState.left = Math.min(maxLeft, Math.max(12, projectsPanelState.left));
  projectsPanelState.top = Math.min(maxTop, Math.max(12 + 28, projectsPanelState.top));
  projectsPanelEl.style.left = `${projectsPanelState.left}px`;
  projectsPanelEl.style.top = `${projectsPanelState.top}px`;
}

function loadTerminalLayoutState() {
  try {
    const raw = window.localStorage.getItem('pixelbox.terminalLayout');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.mode === 'float' || parsed.mode === 'right' || parsed.mode === 'bottom')) {
      terminalLayoutState.mode = parsed.mode;
    }
    if (parsed && Number.isFinite(parsed.width)) {
      terminalLayoutState.width = Math.min(1100, Math.max(TERMINAL_MIN_WIDTH, Math.floor(parsed.width)));
    }
    if (parsed && Number.isFinite(parsed.height)) {
      terminalLayoutState.height = Math.min(900, Math.max(260, Math.floor(parsed.height)));
    }
  } catch {}
}

function persistTerminalLayoutState() {
  try {
    window.localStorage.setItem('pixelbox.terminalLayout', JSON.stringify(terminalLayoutState));
  } catch {}
}

function renderTerminalDockMode() {
  syncTerminalPresentationMode();
  document.body.classList.remove('terminal-dock-float', 'terminal-dock-right', 'terminal-dock-bottom');
  document.body.classList.add(`terminal-dock-${terminalLayoutState.mode}`);
  document.documentElement.style.setProperty('--terminal-width', `${terminalLayoutState.width}px`);
  document.documentElement.style.setProperty('--terminal-height', `${terminalLayoutState.height}px`);
  if (chatDockFloatEl) chatDockFloatEl.setAttribute('aria-pressed', String(terminalLayoutState.mode === 'float'));
  if (chatDockRightEl) chatDockRightEl.setAttribute('aria-pressed', String(terminalLayoutState.mode === 'right'));
  if (chatDockBottomEl) chatDockBottomEl.setAttribute('aria-pressed', String(terminalLayoutState.mode === 'bottom'));
  queueNativeTerminalPanelSync();
}

function nativeTerminalBridgeAvailable() {
  return Boolean(window.zero && typeof window.zero.invoke === 'function');
}

function nativeTerminalExclusive() {
  return nativeTerminalBridgeAvailable();
}

function syncTerminalPresentationMode() {
  document.body.classList.toggle('native-terminal-active', nativeTerminalExclusive());
}

function nativeTerminalPanelPayload() {
  const rect = terminalEl.getBoundingClientRect();
  const terminalBootReady = projectSessionBootstrapped.has(selectedProjectPath) || !nativeTerminalExclusive();
  return {
    visible: panel.classList.contains('open') && terminalBootReady,
    mode: terminalLayoutState.mode,
    projectPath: selectedProjectPath,
    frame: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    startupCommand: projectNativeStartupCommand.get(selectedProjectPath) || '',
    terminal: {
      cols: terminalGridState.cols,
      rows: terminalGridState.rows,
    },
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

async function syncNativeTerminalPanel() {
  if (!nativeTerminalBridgeAvailable()) return;
  try {
    await window.zero.invoke('pixelbox.terminal.setPanelState', nativeTerminalPanelPayload());
  } catch {}
}

function queueNativeTerminalPanelSync() {
  if (!nativeTerminalBridgeAvailable()) return;
  if (nativeTerminalPanelSyncRaf) return;
  nativeTerminalPanelSyncRaf = requestAnimationFrame(() => {
    nativeTerminalPanelSyncRaf = 0;
    syncNativeTerminalPanel().catch(() => {});
  });
}

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

function shellEscapePath(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseDroppedUriList(rawValue) {
  if (!rawValue) return [];
  return rawValue
    .split(/\r?\n|\0/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith('#'))
    .map((entry) => {
      if (!entry.startsWith('file://')) return '';
      try {
        return decodeURIComponent(new URL(entry).pathname);
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

function parseDroppedPlainTextPaths(rawValue) {
  if (!rawValue) return [];
  return rawValue
    .split(/\r?\n|\0/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.startsWith('file://')) {
        try {
          return decodeURIComponent(new URL(entry).pathname);
        } catch {
          return '';
        }
      }
      if (entry.startsWith('~/')) {
        return entry;
      }
      return entry.startsWith('/') ? entry : '';
    })
    .filter(Boolean);
}

function droppedPathsFromTransfer(dataTransfer) {
  if (!dataTransfer) return [];
  const paths = [];
  const seen = new Set();
  const pushPath = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    paths.push(trimmed);
  };

  for (const path of parseDroppedUriList(dataTransfer.getData('text/uri-list'))) {
    pushPath(path);
  }

  for (const path of parseDroppedUriList(dataTransfer.getData('public.file-url'))) {
    pushPath(path);
  }

  for (const file of Array.from(dataTransfer.files || [])) {
    const directPath = typeof file.path === 'string' ? file.path : '';
    if (directPath) {
      pushPath(directPath);
      continue;
    }
    if (window.api?.getPathForDroppedFile) {
      pushPath(window.api.getPathForDroppedFile(file));
    }
  }

  const plainText = dataTransfer.getData('text/plain') || '';
  if (paths.length === 0) {
    for (const path of parseDroppedUriList(plainText)) {
      pushPath(path);
    }
    for (const path of parseDroppedPlainTextPaths(plainText)) {
      pushPath(path);
    }
  }

  return paths;
}

function dragContainsFiles(dataTransfer) {
  if (!dataTransfer) return false;
  if ((dataTransfer.files?.length || 0) > 0) return true;
  if (Array.from(dataTransfer.items || []).some((item) => item?.kind === 'file')) return true;
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes('Files')
    || types.includes('text/uri-list')
    || types.includes('public.file-url')
    || types.includes('public.url')
  );
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
    '- Use localhost/127.0.0.1 URLs that can be embedded in the native preview surface.',
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

function safeWebviewCanGoBack() {
  try {
    return typeof previewFrameEl.canGoBack === 'function' ? previewFrameEl.canGoBack() : false;
  } catch {
    return false;
  }
}

function safeWebviewCanGoForward() {
  try {
    return typeof previewFrameEl.canGoForward === 'function' ? previewFrameEl.canGoForward() : false;
  } catch {
    return false;
  }
}

function updateProjectNavigationControls() {
  const projectBackAvailable = projectSelectionIndex > 0;
  const projectForwardAvailable = projectSelectionIndex < projectSelectionHistory.length - 1;
  const webBackAvailable = safeWebviewCanGoBack();
  const webForwardAvailable = safeWebviewCanGoForward();
  if (previewBackEl) {
    previewBackEl.disabled = !(webBackAvailable || projectBackAvailable);
  }
  if (previewForwardEl) {
    previewForwardEl.disabled = !(webForwardAvailable || projectForwardAvailable);
  }
}

function updatePreviewControls(state) {
  if (previewReloadEl) previewReloadEl.disabled = state.index < 0;
  updateProjectNavigationControls();
}

async function publishPreviewCaptureRegion() {
  previewCaptureRegionRaf = 0;
  if (!previewViewportEl || !window.api?.setPreviewCaptureRegion) return;
  const rect = previewViewportEl.getBoundingClientRect();
  const region = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    scale: window.devicePixelRatio || 1,
    visible: rect.width > 0 && rect.height > 0,
  };
  try {
    await window.api.setPreviewCaptureRegion(region);
  } catch {}
}

function schedulePreviewCaptureRegionPublish() {
  if (previewCaptureRegionRaf) return;
  previewCaptureRegionRaf = requestAnimationFrame(() => {
    publishPreviewCaptureRegion();
  });
}

function previewDisplayUrl(rawUrl) {
  const url = sanitizePreviewUrl(rawUrl);
  if (!url) return 'about:blank';
  return url.replace(/^file:\/\/\/?/, '/');
}

function setPreviewMeta(rawUrl, subtitle = 'Preview') {
  if (previewSubtitleEl) previewSubtitleEl.textContent = subtitle;
  if (previewUrlEl) previewUrlEl.textContent = previewDisplayUrl(rawUrl);
}

function cacheBustedUrl(rawUrl) {
  const url = sanitizePreviewUrl(rawUrl);
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}pxcode_reload=${Date.now()}`;
}

async function refreshSelectedHtmlPreview() {
  const config = projectRuntimeConfig.get(selectedProjectPath) || defaultRuntimeConfig();
  if (config.sourceType !== 'html' || !config.htmlPath) return false;
  const basePath = selectedProjectPath === '.' ? config.htmlPath : `${selectedProjectPath}/${config.htmlPath}`;
  const resolved = await window.api.resolvePreviewHtmlFile(basePath);
  const state = ensurePreviewState(selectedProjectPath);
  const cleanUrl = resolved.url;
  if (state.index >= 0) {
    state.history[state.index] = cleanUrl;
    await persistPreviewState(selectedProjectPath);
  }
  previewFrameEl.src = cacheBustedUrl(cleanUrl);
  setPreviewMeta(cleanUrl, 'HTML preview');
  updatePreviewControls(state);
  return true;
}

function renderProjectsPanelVisibility() {
  document.body.classList.toggle('projects-panel-hidden', projectsPanelHidden);
  if (projectsToggleEl) {
    projectsToggleEl.setAttribute('aria-pressed', String(!projectsPanelHidden));
  }
  if (!projectsPanelHidden) {
    requestAnimationFrame(() => {
      renderProjectsPanelPosition();
    });
  }
  schedulePreviewCaptureRegionPublish();
}

document.addEventListener('transitionend', (event) => {
  if (!(event.target instanceof Element)) return;
  if (
    event.target === previewViewportEl ||
    event.target === panel ||
    event.target === projectsPanelEl ||
    event.target === document.body
  ) {
    schedulePreviewCaptureRegionPublish();
  }
});

function renderPreviewForProject(projectPath) {
  const state = ensurePreviewState(projectPath);
  const url = currentPreviewUrl(state);
  if (!url) {
    previewFrameEl.src = 'about:blank';
    previewEmptyStateEl.style.display = 'grid';
    setPreviewMeta('', 'Preview');
    updatePreviewControls(state);
    return;
  }

  previewEmptyStateEl.style.display = 'none';
  if (previewFrameEl.src !== url) {
    previewFrameEl.src = url;
  }
  const config = projectRuntimeConfig.get(projectPath) || defaultRuntimeConfig();
  const subtitle = config.sourceType === 'html' ? 'HTML preview' : 'Live preview';
  setPreviewMeta(url, subtitle);
  updatePreviewControls(state);
  schedulePreviewCaptureRegionPublish();
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

async function promoteDetectedServerPreview(projectPath, url) {
  const currentConfig = projectRuntimeConfig.get(projectPath) || defaultRuntimeConfig();
  if (currentConfig.sourceType !== 'none') {
    if (!currentConfig.serverUrl || currentConfig.serverUrl !== url) {
      projectRuntimeConfig.set(projectPath, {
        ...currentConfig,
        serverUrl: url,
      });
    }
    return;
  }

  let serverCommand = '';
  try {
    const packagePath = projectPath === '.' ? 'package.json' : `${projectPath}/package.json`;
    const { content } = await window.api.readFile(packagePath);
    if (content) {
      const parsed = JSON.parse(content);
      if (parsed?.scripts?.dev && typeof parsed.scripts.dev === 'string') {
        serverCommand = 'npm run dev';
      }
    }
  } catch {}

  projectRuntimeConfig.set(projectPath, {
    ...currentConfig,
    sourceType: 'server',
    serverCommand,
    serverUrl: url,
    autoStart: true,
  });
}

async function pushPreviewUrl(projectPath, rawUrl, options = {}) {
  const url = sanitizePreviewUrl(rawUrl);
  if (!/^https?:\/\//i.test(url) && !url.startsWith('file://')) return;
  await promoteDetectedServerPreview(projectPath, url);
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
  const next = `${projectTerminalOutput.get(projectPath) || ''}${data}`.slice(-MAX_PROJECT_TERMINAL_OUTPUT);
  projectTerminalOutput.set(projectPath, next);
  if (projectPath === selectedProjectPath) {
    window.__pwTerminalOutput = next;
    terminalEl.textContent = next;
    terminalEl.scrollTop = terminalEl.scrollHeight;
  }
}

function singleLine(value, maxLength = 120) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function selectedAiCliLabelForMonitor() {
  switch (selectedAiCli) {
    case 'claude':
      return 'Claude';
    case 'gemini':
      return 'Gemini';
    case 'hermes':
      return 'Hermes';
    case 'openclaw':
      return 'OpenClaw';
    case 'custom':
      return 'Plain terminal';
    case 'codex':
    default:
      return 'Codex';
  }
}

function agentMonitorScopeLabel() {
  return selectedProjectPath === '.' ? 'workspace root' : selectedProjectPath;
}

function renderAgentMonitor(processes, detailsByPid = new Map()) {
  if (!agentMonitorListEl || !agentMonitorStatusEl) return;
  agentMonitorListEl.innerHTML = '';
  if (!Array.isArray(processes) || processes.length === 0) {
    agentMonitorStatusEl.textContent = `No ${selectedAiCliLabelForMonitor()} processes in ${agentMonitorScopeLabel()}.`;
    return;
  }

  const totalCpu = processes.reduce((sum, item) => sum + (Number(item.cpu) || 0), 0);
  const totalMem = processes.reduce((sum, item) => sum + (Number(item.mem) || 0), 0);
  agentMonitorStatusEl.textContent = `${selectedAiCliLabelForMonitor()} · ${agentMonitorScopeLabel()} · ${processes.length} process${processes.length === 1 ? '' : 'es'} · ${totalCpu.toFixed(1)}% CPU · ${totalMem.toFixed(1)}% MEM`;

  for (const processInfo of processes) {
    const details = detailsByPid.get(processInfo.pid) || {};
    const card = document.createElement('div');
    card.className = 'agent-monitor-item';

    const top = document.createElement('div');
    top.className = 'agent-monitor-top';
    top.innerHTML = `
      <strong>${processInfo.kind || 'unknown'} · PID ${processInfo.pid}</strong>
      <span>${Number(processInfo.cpu || 0).toFixed(1)}% CPU · ${Number(processInfo.mem || 0).toFixed(1)}% MEM</span>
    `;
    card.appendChild(top);

    const actions = document.createElement('div');
    actions.className = 'agent-monitor-actions';

    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'agent-monitor-stop';
    stopButton.textContent = agentMonitorStoppingPids.has(processInfo.pid) ? 'Stopping…' : 'Stop';
    stopButton.disabled = agentMonitorStoppingPids.has(processInfo.pid);
    stopButton.addEventListener('click', async () => {
      const confirmed = window.confirm(`Stop ${processInfo.cli || processInfo.engine || 'agent'} process ${processInfo.pid}?`);
      if (!confirmed) return;
      agentMonitorStoppingPids.add(processInfo.pid);
      renderAgentMonitor(processes, detailsByPid);
      try {
        await window.api.codexMonitorStop(processInfo.pid, 'SIGTERM');
      } catch (error) {
        window.alert(`Failed to stop PID ${processInfo.pid}: ${error && error.message ? error.message : 'unknown error'}`);
      } finally {
        agentMonitorStoppingPids.delete(processInfo.pid);
        refreshAgentMonitor().catch(() => {});
      }
    });
    actions.appendChild(stopButton);
    card.appendChild(actions);

    const command = document.createElement('div');
    command.className = 'agent-monitor-line';
    command.textContent = singleLine(processInfo.command, 160);
    card.appendChild(command);

    if (details.cwd) {
      const cwd = document.createElement('div');
      cwd.className = 'agent-monitor-line muted';
      cwd.textContent = `cwd: ${details.cwd}`;
      card.appendChild(cwd);
    }

    if (details.transcriptSummary) {
      const summary = document.createElement('div');
      summary.className = 'agent-monitor-line muted';
      summary.textContent = singleLine(details.transcriptSummary, 180);
      card.appendChild(summary);
    }

    agentMonitorListEl.appendChild(card);
  }
}

async function refreshAgentMonitor() {
  if (!agentMonitorStatusEl || !agentMonitorListEl) return;
  agentMonitorStatusEl.textContent = 'Scanning…';
  try {
    const cwdPrefix = await window.api.resolveWorkspacePath(selectedProjectPath);
    const processes = await window.api.codexMonitorList({
      cli: selectedAiCli,
      cwdPrefix,
    });
    const detailsEntries = await Promise.all(
      processes.map(async (processInfo) => {
        try {
          return [processInfo.pid, await window.api.codexMonitorDetails(processInfo.pid)];
        } catch {
          return [processInfo.pid, {}];
        }
      })
    );
    renderAgentMonitor(processes, new Map(detailsEntries));
  } catch (error) {
    agentMonitorListEl.innerHTML = '';
    const message = error && error.message ? error.message : 'unknown error';
    if (message.includes('No handler registered for')) {
      agentMonitorStatusEl.textContent = 'Monitor requires a full Pixelbox restart to enable new main-process hooks.';
      return;
    }
    agentMonitorStatusEl.textContent = `Monitor error: ${message}`;
  }
}

function estimateTerminalGrid() {
  const width = Math.max(terminalEl.clientWidth || panel.clientWidth || 800, TERMINAL_MIN_COLS * TERMINAL_CELL_WIDTH);
  const height = Math.max(terminalEl.clientHeight || panel.clientHeight || 420, TERMINAL_MIN_ROWS * TERMINAL_CELL_HEIGHT);
  return {
    cols: Math.max(TERMINAL_MIN_COLS, Math.floor(width / TERMINAL_CELL_WIDTH)),
    rows: Math.max(TERMINAL_MIN_ROWS, Math.floor(height / TERMINAL_CELL_HEIGHT)),
  };
}

function syncTerminalSize() {
  const nextGrid = estimateTerminalGrid();
  terminalGridState.cols = nextGrid.cols;
  terminalGridState.rows = nextGrid.rows;
  window.api.resizeTerminal(terminalGridState.cols, terminalGridState.rows, selectedProjectPath);
  queueNativeTerminalPanelSync();
}

function setTerminalDockMode(mode) {
  if (!['float', 'right', 'bottom'].includes(mode)) return;
  terminalLayoutState.mode = mode;
  if (mode !== 'float') {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
  }
  renderTerminalDockMode();
  persistTerminalLayoutState();
  requestAnimationFrame(() => {
    if (panel.classList.contains('open')) {
      syncTerminalSize();
      focusTerminal();
    }
  });
}

function toggleTerminalDockMode(mode) {
  if (mode === 'float') {
    setTerminalDockMode('float');
    return;
  }
  if (terminalLayoutState.mode === mode) {
    setTerminalDockMode('float');
    return;
  }
  setTerminalDockMode(mode);
}

function focusTerminal() {
  if (nativeTerminalExclusive()) return;
  terminalEl.focus();
}

function writeToActiveTerminal(data) {
  if (projectSessionExited.has(selectedProjectPath)) {
    bootTerminalForPath(selectedProjectPath, true, true)
      .then(() => {
        window.api.writeTerminal(data, selectedProjectPath);
      })
      .catch(() => {});
    return;
  }
  window.api.writeTerminal(data, selectedProjectPath);
}

function terminalInputForKeydown(event) {
  if (event.metaKey) return null;
  if (event.ctrlKey) {
    if (event.key.length === 1) {
      return String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64);
    }
    return null;
  }
  switch (event.key) {
    case 'Enter':
      return '\r';
    case 'Backspace':
      return '\x7f';
    case 'Tab':
      return '\t';
    case 'Escape':
      return '\x1b';
    case 'ArrowUp':
      return '\x1b[A';
    case 'ArrowDown':
      return '\x1b[B';
    case 'ArrowRight':
      return '\x1b[C';
    case 'ArrowLeft':
      return '\x1b[D';
    default:
      return event.key.length === 1 ? event.key : null;
  }
}

function renderTerminalDropActive(active) {
  panel.classList.toggle('terminal-drop-active', Boolean(active));
}

async function handleTerminalFileDrop(event) {
  const paths = droppedPathsFromTransfer(event.dataTransfer);
  renderTerminalDropActive(false);
  if (paths.length === 0) return;
  const escaped = `${paths.map(shellEscapePath).join(' ')} `;
  window.__pwLastTerminalDrop = escaped;
  openPanel();
  focusTerminal();
  writeToActiveTerminal(escaped);
}

function openPanel() {
  panel.classList.add('open');
  document.body.classList.add('terminal-active');
  if (toggle) {
    toggle.setAttribute('aria-pressed', 'true');
  }
  requestAnimationFrame(() => {
    syncTerminalSize();
    focusTerminal();
  });
  queueNativeTerminalPanelSync();
}

function closePanel() {
  panel.classList.remove('open');
  document.body.classList.remove('terminal-active');
  if (toggle) {
    toggle.setAttribute('aria-pressed', 'false');
  }
  queueNativeTerminalPanelSync();
}

async function removeProject(relPath, label) {
  const ok = window.confirm(`Delete project "${label}" and remove its files?`);
  if (!ok) return;
  const confirmation = window.prompt(`Type the project name to confirm delete:\n${label}`, '');
  if (confirmation !== label) {
    window.alert('Project name did not match. Delete cancelled.');
    return;
  }
  try {
    await window.api.removeDir(relPath);
    hiddenProjects.delete(relPath);
    persistHiddenProjects();
    projectPreviewState.delete(relPath);
    projectRuntimeConfig.delete(relPath);
    projectRuntimeStatus.delete(relPath);
    projectTerminalOutput.delete(relPath);
    projectNativeStartupCommand.delete(relPath);
    projectSessionBootstrapped.delete(relPath);
    projectSessionExited.delete(relPath);
    openProjectActionsPath = null;
    if (selectedProjectPath === relPath) {
      await selectProject('.', { recordHistory: true });
    } else {
      await renderProjects();
    }
  } catch (error) {
    window.alert(`Failed to remove project: ${error && error.message ? error.message : 'unknown error'}`);
  }
}

function projectButton(label, relPath, active, clickHandler) {
  const row = document.createElement('div');
  row.className = 'project-item';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `project-btn${active ? ' active' : ''}`;
  btn.textContent = label;
  btn.addEventListener('click', () => clickHandler(relPath));
  row.appendChild(btn);

  if (relPath !== '.') {
    if (openProjectActionsPath === relPath) {
      row.classList.add('project-item-actions-open');
    }

    const actionsBtn = document.createElement('button');
    actionsBtn.type = 'button';
    actionsBtn.className = 'icon-button project-actions-toggle';
    actionsBtn.setAttribute('aria-label', `Project actions for ${label}`);
    actionsBtn.setAttribute('aria-expanded', String(openProjectActionsPath === relPath));
    actionsBtn.title = 'Project actions';
    actionsBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5" r="1.75" />
        <circle cx="12" cy="12" r="1.75" />
        <circle cx="12" cy="19" r="1.75" />
      </svg>
    `;
    actionsBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openProjectActionsPath = openProjectActionsPath === relPath ? null : relPath;
      renderProjects().catch(() => {});
    });
    row.appendChild(actionsBtn);

    if (openProjectActionsPath === relPath) {
      const menu = document.createElement('div');
      menu.className = 'project-actions-menu';
      menu.addEventListener('click', (event) => event.stopPropagation());

      const hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.className = 'project-menu-item';
      hideBtn.textContent = 'Hide from list';
      hideBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openProjectActionsPath = null;
        hiddenProjects.add(relPath);
        persistHiddenProjects();
        if (selectedProjectPath === relPath) {
          selectProject('.', { recordHistory: true }).catch(() => {});
        } else {
          renderProjects().catch(() => {});
        }
      });
      menu.appendChild(hideBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'project-menu-item danger';
      removeBtn.textContent = 'Delete project…';
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        removeProject(relPath, label).catch(() => {});
      });
      menu.appendChild(removeBtn);
      row.appendChild(menu);
    }
  }

  return row;
}

function renderHiddenProjects(projects) {
  if (!hiddenProjectsToggleEl || !hiddenProjectsListEl) return;
  const hidden = projects.filter((project) => hiddenProjects.has(project.path));
  hiddenProjectsToggleEl.hidden = hidden.length === 0;
  hiddenProjectsToggleEl.textContent = `Hidden (${hidden.length})`;
  hiddenProjectsToggleEl.setAttribute('aria-expanded', String(hiddenProjectsExpanded));
  hiddenProjectsListEl.hidden = !hiddenProjectsExpanded || hidden.length === 0;
  hiddenProjectsListEl.innerHTML = '';
  if (!hiddenProjectsExpanded || hidden.length === 0) {
    return;
  }

  const header = document.createElement('div');
  header.className = 'hidden-projects-header';
  header.textContent = 'Hidden projects';
  hiddenProjectsListEl.appendChild(header);

  for (const project of hidden) {
    const row = document.createElement('div');
    row.className = 'hidden-project-item';

    const labelEl = document.createElement('div');
    labelEl.className = 'hidden-project-label';
    labelEl.textContent = project.name;
    row.appendChild(labelEl);

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'hidden-project-restore';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => {
      hiddenProjects.delete(project.path);
      persistHiddenProjects();
      renderProjects().catch(() => {});
    });
    row.appendChild(restoreBtn);

    hiddenProjectsListEl.appendChild(row);
  }
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
    if (config.sourceType === 'none') {
      replacePreviewHistory(projectPath, [], -1);
    } else {
      replacePreviewHistory(projectPath, parsed.history || [], Number.isInteger(parsed.index) ? parsed.index : -1);
    }
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
    if (projectPath === selectedProjectPath) {
      await window.api.watchPreviewHtml(projectPath, basePath);
    }
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
    const shouldAutoStart = options.forceStart ? true : config.autoStart;
    const syncResult = await window.api.syncPreviewRuntime(projectPath, {
      sourceType: 'server',
      command: config.serverCommand,
      url: config.serverUrl,
      autoStart: shouldAutoStart,
    });
    if (!syncResult?.running) {
      replacePreviewHistory(projectPath, explicitUrls, explicitUrls.length > 0 ? 0 : -1);
    }
    if (projectPath === selectedProjectPath) {
      await window.api.clearPreviewHtmlWatch();
    }
  } else {
    replacePreviewHistory(projectPath, [], -1);
    projectRuntimeStatus.set(projectPath, { running: false, sourceType: 'none', url: '' });
    await window.api.stopPreviewRuntime(projectPath);
    if (projectPath === selectedProjectPath) {
      await window.api.clearPreviewHtmlWatch();
    }
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
      aiCli: selectedAiCli,
      codexDangerouslyBypassPermissions,
    })
    : '';
  if (shouldBootstrapProject) {
    projectNativeStartupCommand.set(relPath, startupCommand);
  }
  if (!nativeTerminalExclusive()) {
    const result = await window.api.startOrRestartTerminal(relPath, shouldBootstrapProject, { startupCommand });
    startResult = result;
  }
  projectSessionBootstrapped.add(relPath);
  projectSessionExited.delete(relPath);

  // A project switch can happen while this async boot is in-flight.
  // Only apply renderer terminal state if this path is still active.
  if (selectedProjectPath !== relPath) {
    return;
  }

  window.__pwTerminalOutput = projectTerminalOutput.get(relPath) || '';
  terminalEl.textContent = window.__pwTerminalOutput;
  terminalEl.scrollTop = terminalEl.scrollHeight;

  requestAnimationFrame(() => {
    syncTerminalSize();
    focusTerminal();
  });
  queueNativeTerminalPanelSync();
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

function isEditableShortcutTarget(target = document.activeElement) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('#terminal')) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

async function listSelectableProjectPaths() {
  await window.api.mkdir('projects');
  const entries = await window.api.listDir('projects');
  const projects = entries
    .filter((entry) => entry.type === 'directory')
    .filter((entry) => !hiddenProjects.has(entry.path))
    .map((entry) => entry.path);
  return ['.', ...projects];
}

function shouldIgnoreProjectSwitchShortcut(direction) {
  const now = Date.now();
  const isDuplicate =
    lastProjectSwitchShortcut.direction === direction &&
    now - lastProjectSwitchShortcut.at < 150;
  lastProjectSwitchShortcut = { direction, at: now };
  return isDuplicate;
}

async function cycleProjectSelection(direction) {
  const projectPaths = await listSelectableProjectPaths();
  if (projectPaths.length <= 1) {
    return;
  }

  const currentIndex = projectPaths.indexOf(selectedProjectPath);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (startIndex + direction + projectPaths.length) % projectPaths.length;
  const nextProjectPath = projectPaths[nextIndex];
  if (!nextProjectPath || nextProjectPath === selectedProjectPath) {
    return;
  }

  await selectProject(nextProjectPath, { recordHistory: true });
}

function handleProjectSwitchShortcut(direction, options = {}) {
  const { checkEditableTarget = false } = options;
  if (!Number.isInteger(direction) || Math.abs(direction) !== 1) {
    return false;
  }
  if (checkEditableTarget && isEditableShortcutTarget()) {
    return false;
  }
  if (shouldIgnoreProjectSwitchShortcut(direction)) {
    return true;
  }
  cycleProjectSelection(direction).catch(() => {});
  return true;
}

async function renderProjects() {
  await window.api.mkdir('projects');
  const entries = await window.api.listDir('projects');
  const projects = entries.filter((entry) => entry.type === 'directory');

  projectsListEl.innerHTML = '';
  projectsListEl.appendChild(projectButton('workspace', '.', selectedProjectPath === '.', selectProject));

  const visibleProjects = projects.filter((project) => !hiddenProjects.has(project.path));
  for (const project of visibleProjects) {
    projectsListEl.appendChild(
      projectButton(project.name, project.path, selectedProjectPath === project.path, selectProject)
    );
  }
  renderHiddenProjects(projects);

  const activeLabel = selectedProjectPath === '.' ? 'workspace root' : selectedProjectPath;
  activeProjectEl.textContent = `Active: ${activeLabel}`;
  headlineEl.textContent = selectedProjectPath === '.' ? 'Build Directly From The App' : `Project: ${activeLabel}`;

  applyLayoutVariant(0);
}

async function selectProject(relPath, options = {}) {
  const { recordHistory = true } = options;
  const projectPath = relPath;
  selectedProjectPath = projectPath;
  persistLastSelectedProject(projectPath);
  if (recordHistory) {
    recordProjectSelection(projectPath);
  } else {
    updateProjectNavigationControls();
  }
  refreshAgentMonitor().catch(() => {});

  await renderProjects();
  const bootPromise = bootTerminalForPath(projectPath, true, projectSessionExited.has(projectPath));
  const configPromise = loadRuntimeConfig(projectPath);
  const setupPromise = Promise.all([
    ensurePixelboxProjectContext(projectPath),
    ensureAgentHandoffFile(projectPath),
  ]);

  await bootPromise;
  const config = await configPromise;
  if (selectedProjectPath !== projectPath) {
    await setupPromise;
    return;
  }
  renderRuntimeConfig(projectPath);
  try {
    await applyRuntimeConfig(projectPath, config);
  } catch (error) {
    runningPageStatusEl.textContent = error.message;
    renderPreviewForProject(projectPath);
  }
  await setupPromise;
}

async function createProject() {
  const value = newProjectNameEl.value;
  if (!value) return;
  const projectName = sanitizeProjectName(value);
  if (!projectName) {
    window.alert('Use letters, numbers, dashes, or underscores.');
    return;
  }

  const relPath = `projects/${projectName}`;
  const existing = await window.api.listDir('projects');
  if (existing.some((entry) => entry.type === 'directory' && entry.path === relPath)) {
    window.alert('Project already exists. Choose a different name.');
    return;
  }
  await window.api.mkdir(relPath);
  await window.api.writeFile(`${relPath}/README.md`, `# ${projectName}\n\nCreated from Pixelbox.\n`);
  await ensurePixelboxProjectContext(relPath);
  await ensureAgentHandoffFile(relPath);
  hiddenProjects.delete(relPath);
  persistHiddenProjects();
  newProjectNameEl.value = '';
  newProjectFormEl.hidden = true;
  await selectProject(relPath, { recordHistory: true });
}

window.api.onTerminalData(({ key, data }) => {
  appendTerminalOutput(key, data);

  const runtimeConfig = projectRuntimeConfig.get(key) || defaultRuntimeConfig();
  const shouldDetectPreviewUrl =
    runtimeConfig.sourceType === 'none' ||
    (runtimeConfig.sourceType === 'server' && !runtimeConfig.serverUrl);
  if (!shouldDetectPreviewUrl) {
    return;
  }

  const cleanData = stripAnsi(data);
  const matches = cleanData.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}[^\s"'<>)\]]*/gi) || [];
  const latest = matches[matches.length - 1];
  if (latest) {
    pushPreviewUrl(key, latest).catch(() => {});
  }
});

window.api.onPreviewStatus(({ key, running, url, configuredUrl, sourceType }) => {
  projectRuntimeStatus.set(key, {
    running,
    sourceType,
    url: url || configuredUrl || '',
  });

  if (url) {
    pushPreviewUrl(key, url)
      .then(() => {
        if (key === selectedProjectPath) {
          renderRuntimeConfig(key);
        }
      })
      .catch(() => {});
  } else if (configuredUrl && sourceType === 'server') {
    pushPreviewUrl(key, configuredUrl)
      .then(() => {
        if (key === selectedProjectPath) {
          renderRuntimeConfig(key);
        }
      })
      .catch(() => {});
  }

  if (key === selectedProjectPath) {
    renderRuntimeStatus(key);
  }
});

window.api.onPreviewHtmlChanged(({ key }) => {
  if (key !== selectedProjectPath) return;
  const config = projectRuntimeConfig.get(key) || defaultRuntimeConfig();
  if (config.sourceType !== 'html') return;
  refreshSelectedHtmlPreview().catch(() => {});
});

window.api.onTerminalExit(({ key }) => {
  if (!key) return;
  projectSessionExited.add(key);
  appendTerminalOutput(key, '\r\n[terminal exited]');
});

window.api.onRendererChanged(() => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    window.location.reload();
  }, 120);
});

toggle.addEventListener('click', () => {
  if (panel.classList.contains('open')) {
    closePanel();
    return;
  }
  openPanel();
});
primaryAction.addEventListener('click', openPanel);
minimize.addEventListener('click', closePanel);
if (chatDockFloatEl) {
  chatDockFloatEl.addEventListener('click', () => toggleTerminalDockMode('float'));
}
if (chatDockRightEl) {
  chatDockRightEl.addEventListener('click', () => toggleTerminalDockMode('right'));
}
if (chatDockBottomEl) {
  chatDockBottomEl.addEventListener('click', () => toggleTerminalDockMode('bottom'));
}
newProjectBtn.addEventListener('click', () => {
  newProjectFormEl.hidden = false;
  requestAnimationFrame(() => newProjectNameEl.focus());
});
newProjectCreateEl.addEventListener('click', () => {
  createProject().catch(() => {});
});
newProjectCancelEl.addEventListener('click', () => {
  newProjectFormEl.hidden = true;
  newProjectNameEl.value = '';
});
newProjectNameEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    createProject().catch(() => {});
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    newProjectFormEl.hidden = true;
    newProjectNameEl.value = '';
  }
});
projectsToggleEl.addEventListener('click', () => {
  projectsPanelHidden = !projectsPanelHidden;
  persistProjectsPanelHidden();
  renderProjectsPanelVisibility();
});
projectsMinimizeEl.addEventListener('click', () => {
  projectsPanelHidden = true;
  persistProjectsPanelHidden();
  renderProjectsPanelVisibility();
});
if (hiddenProjectsToggleEl) {
  hiddenProjectsToggleEl.addEventListener('click', () => {
    hiddenProjectsExpanded = !hiddenProjectsExpanded;
    persistHiddenProjectsExpanded();
    renderProjects().catch(() => {});
  });
}
if (agentMonitorRefreshEl) {
  agentMonitorRefreshEl.addEventListener('click', () => {
    refreshAgentMonitor().catch(() => {});
  });
}
terminalEl.addEventListener('mousedown', focusTerminal);
terminalEl.addEventListener('keydown', (event) => {
  if (nativeTerminalExclusive()) return;
  const input = terminalInputForKeydown(event);
  if (input === null) return;
  event.preventDefault();
  writeToActiveTerminal(input);
});
terminalEl.addEventListener('paste', (event) => {
  if (nativeTerminalExclusive()) return;
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!text) return;
  event.preventDefault();
  writeToActiveTerminal(text);
});
panel.addEventListener('mousedown', focusTerminal);
for (const dropTarget of [terminalEl, panel]) {
  dropTarget.addEventListener('dragenter', (event) => {
    if (!dragContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    renderTerminalDropActive(true);
  });

  dropTarget.addEventListener('dragover', (event) => {
    if (!dragContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    renderTerminalDropActive(true);
  });

  dropTarget.addEventListener('dragleave', (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget && panel.contains(nextTarget)) return;
    renderTerminalDropActive(false);
  });

  dropTarget.addEventListener('drop', (event) => {
    if (!dragContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    handleTerminalFileDrop(event).catch(() => {
      renderTerminalDropActive(false);
    });
  });
}

window.addEventListener('dragend', () => {
  renderTerminalDropActive(false);
});
if (chatResizeHandleEls.length) {
  const clampTerminalWidth = (value) => Math.min(Math.max(TERMINAL_MIN_WIDTH, Math.floor(value)), Math.max(TERMINAL_MIN_WIDTH, window.innerWidth - 24));
  const clampTerminalHeight = (value) => Math.min(Math.max(240, Math.floor(value)), Math.max(240, window.innerHeight - 24));

  const updateFloatingPanelBounds = (nextLeft, nextTop, nextWidth, nextHeight) => {
    const boundedWidth = clampTerminalWidth(nextWidth);
    const boundedHeight = clampTerminalHeight(nextHeight);
    const maxLeft = Math.max(0, window.innerWidth - boundedWidth);
    const maxTop = Math.max(0, window.innerHeight - boundedHeight);
    const boundedLeft = Math.min(maxLeft, Math.max(0, nextLeft));
    const boundedTop = Math.min(maxTop, Math.max(0, nextTop));

    terminalLayoutState.width = boundedWidth;
    terminalLayoutState.height = boundedHeight;
    panel.style.left = `${Math.round(boundedLeft)}px`;
    panel.style.top = `${Math.round(boundedTop)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    queueNativeTerminalPanelSync();
  };

  for (const handleEl of chatResizeHandleEls) {
    handleEl.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = panel.getBoundingClientRect();
      const direction = handleEl.dataset.resize || '';
      if (!direction) return;
      if (terminalLayoutState.mode === 'float') {
        panel.style.left = `${Math.round(rect.left)}px`;
        panel.style.top = `${Math.round(rect.top)}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      terminalResizePointer = {
        id: event.pointerId,
        mode: terminalLayoutState.mode,
        direction,
        element: handleEl,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        startWidth: rect.width,
        startHeight: rect.height,
      };
      handleEl.setPointerCapture(event.pointerId);
    });

    handleEl.addEventListener('pointermove', (event) => {
      if (!terminalResizePointer || event.pointerId !== terminalResizePointer.id) return;
      const { mode, direction, startX, startY, startWidth, startHeight, startLeft, startTop } = terminalResizePointer;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

      if (mode === 'right') {
        terminalLayoutState.width = clampTerminalWidth(startWidth - deltaX);
      } else if (mode === 'bottom') {
        terminalLayoutState.height = clampTerminalHeight(startHeight - deltaY);
      } else {
        let nextLeft = startLeft;
        let nextTop = startTop;
        let nextWidth = startWidth;
        let nextHeight = startHeight;

        if (direction.includes('e')) {
          nextWidth = startWidth + deltaX;
        }
        if (direction.includes('w')) {
          nextWidth = startWidth - deltaX;
          nextLeft = startLeft + deltaX;
        }
        if (direction.includes('s')) {
          nextHeight = startHeight + deltaY;
        }
        if (direction.includes('n')) {
          nextHeight = startHeight - deltaY;
          nextTop = startTop + deltaY;
        }

        if (nextWidth < TERMINAL_MIN_WIDTH) {
          nextLeft -= TERMINAL_MIN_WIDTH - nextWidth;
          nextWidth = TERMINAL_MIN_WIDTH;
        }
        if (nextHeight < 240) {
          nextTop -= 240 - nextHeight;
          nextHeight = 240;
        }

        updateFloatingPanelBounds(nextLeft, nextTop, nextWidth, nextHeight);
      }

      renderTerminalDockMode();
      syncTerminalSize();
      queueNativeTerminalPanelSync();
    });

    const finishResize = (event) => {
      if (!terminalResizePointer || event.pointerId !== terminalResizePointer.id) return;
      try {
        handleEl.releasePointerCapture(event.pointerId);
      } catch {}
      terminalResizePointer = null;
      persistTerminalLayoutState();
    };

    handleEl.addEventListener('pointerup', finishResize);
    handleEl.addEventListener('pointercancel', finishResize);
  }
}

if (chatHeaderEl) {
  const beginTerminalDrag = (clientX, clientY, pointerId = null) => {
    if (terminalLayoutState.mode !== 'float') {
      setTerminalDockMode('float');
    }
    const rect = panel.getBoundingClientRect();
    terminalDragPointer = {
      id: pointerId,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
    };
  };

  const moveTerminalDrag = (clientX, clientY) => {
    if (!terminalDragPointer) return;
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
    const nextLeft = Math.min(maxLeft, Math.max(0, clientX - terminalDragPointer.offsetX));
    const nextTop = Math.min(maxTop, Math.max(0, clientY - terminalDragPointer.offsetY));
    panel.style.left = `${Math.round(nextLeft)}px`;
    panel.style.top = `${Math.round(nextTop)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    syncTerminalSize();
    queueNativeTerminalPanelSync();
  };

  chatHeaderEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target && event.target.closest('button')) return;
    event.preventDefault();
    beginTerminalDrag(event.clientX, event.clientY, event.pointerId);
    chatHeaderEl.setPointerCapture(event.pointerId);
  });

  chatHeaderEl.addEventListener('pointermove', (event) => {
    if (!terminalDragPointer || event.pointerId !== terminalDragPointer.id) return;
    moveTerminalDrag(event.clientX, event.clientY);
  });

  const finishDrag = (event) => {
    if (!terminalDragPointer || event.pointerId !== terminalDragPointer.id) return;
    try {
      chatHeaderEl.releasePointerCapture(event.pointerId);
    } catch {}
    terminalDragPointer = null;
  };

  chatHeaderEl.addEventListener('pointerup', finishDrag);
  chatHeaderEl.addEventListener('pointercancel', finishDrag);

  chatHeaderEl.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target && event.target.closest('button')) return;
    event.preventDefault();
    beginTerminalDrag(event.clientX, event.clientY, 'mouse');
    terminalMouseDrag = true;
  });

  window.addEventListener('mousemove', (event) => {
    if (!terminalMouseDrag) return;
    moveTerminalDrag(event.clientX, event.clientY);
  });

  window.addEventListener('mouseup', () => {
    if (!terminalMouseDrag) return;
    terminalMouseDrag = null;
    terminalDragPointer = null;
  });

  chatHeaderEl.addEventListener('dblclick', (event) => {
    if (event.target && event.target.closest('button')) return;
    if (terminalLayoutState.mode !== 'float') {
      setTerminalDockMode('float');
    }
  });
}

if (projectsHeaderEl && projectsPanelEl) {
  const beginProjectsDrag = (clientX, clientY, pointerId = null) => {
    const rect = projectsPanelEl.getBoundingClientRect();
    projectsDragPointer = {
      id: pointerId,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
    };
  };

  const moveProjectsDrag = (clientX, clientY) => {
    if (!projectsDragPointer) return;
    const maxLeft = Math.max(12, window.innerWidth - projectsPanelEl.offsetWidth - 12);
    const maxTop = Math.max(12 + 28, window.innerHeight - projectsPanelEl.offsetHeight - 12);
    projectsPanelState.left = Math.min(maxLeft, Math.max(12, Math.round(clientX - projectsDragPointer.offsetX)));
    projectsPanelState.top = Math.min(maxTop, Math.max(12 + 28, Math.round(clientY - projectsDragPointer.offsetY)));
    renderProjectsPanelPosition();
  };

  projectsHeaderEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target && event.target.closest('button, input, select, textarea, a')) return;
    event.preventDefault();
    beginProjectsDrag(event.clientX, event.clientY, event.pointerId);
    projectsHeaderEl.setPointerCapture(event.pointerId);
  });

  projectsHeaderEl.addEventListener('pointermove', (event) => {
    if (!projectsDragPointer || event.pointerId !== projectsDragPointer.id) return;
    moveProjectsDrag(event.clientX, event.clientY);
  });

  const finishProjectsDrag = (event) => {
    if (!projectsDragPointer || event.pointerId !== projectsDragPointer.id) return;
    try {
      projectsHeaderEl.releasePointerCapture(event.pointerId);
    } catch {}
    projectsDragPointer = null;
    persistProjectsPanelPosition();
  };

  projectsHeaderEl.addEventListener('pointerup', finishProjectsDrag);
  projectsHeaderEl.addEventListener('pointercancel', finishProjectsDrag);

  projectsHeaderEl.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target && event.target.closest('button, input, select, textarea, a')) return;
    event.preventDefault();
    beginProjectsDrag(event.clientX, event.clientY, 'mouse');
    projectsMouseDrag = true;
  });

  window.addEventListener('mousemove', (event) => {
    if (!projectsMouseDrag) return;
    moveProjectsDrag(event.clientX, event.clientY);
  });

  window.addEventListener('mouseup', () => {
    if (!projectsMouseDrag) return;
    projectsMouseDrag = null;
    projectsDragPointer = null;
    persistProjectsPanelPosition();
  });

  projectsHeaderEl.addEventListener('dblclick', (event) => {
    if (event.target && event.target.closest('button, input, select, textarea, a')) return;
    projectsPanelState.left = 16;
    projectsPanelState.top = 72 + 28;
    renderProjectsPanelPosition();
    persistProjectsPanelPosition();
  });
}

window.addEventListener('keydown', (event) => {
  const isProjectSwitchShortcut =
    !event.repeat &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
  if (isProjectSwitchShortcut) {
    const handled = handleProjectSwitchShortcut(event.key === 'ArrowLeft' ? -1 : 1, {
      checkEditableTarget: true,
    });
    if (handled) {
      event.preventDefault();
    }
    return;
  }

  if (event.key !== 'Escape') return;
  if (!panel.classList.contains('open')) return;
  if (terminalLayoutState.mode === 'float') return;
  setTerminalDockMode('float');
});
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
if (aiCliSelectEl) {
  aiCliSelectEl.addEventListener('change', () => {
    if (!SUPPORTED_AI_CLIS.includes(aiCliSelectEl.value)) return;
    selectedAiCli = aiCliSelectEl.value;
    persistSelectedAiCli();
    renderCodexLaunchConfig();
    refreshAgentMonitor().catch(() => {});
  });
}
if (codexDangerousToggleEl) {
  codexDangerousToggleEl.addEventListener('change', () => {
    codexDangerouslyBypassPermissions = codexDangerousToggleEl.checked;
    persistCodexDangerouslyBypassPermissions();
    renderCodexLaunchConfig();
  });
}
if (previewBackEl) {
  previewBackEl.addEventListener('click', () => {
    try {
      if (typeof previewFrameEl.goBack === 'function' && safeWebviewCanGoBack()) {
        previewFrameEl.goBack();
        return;
      }
    } catch {}
    if (projectSelectionIndex <= 0) {
      return;
    }
    projectSelectionIndex -= 1;
    selectProject(projectSelectionHistory[projectSelectionIndex], { recordHistory: false }).catch(() => {});
  });
}
if (previewForwardEl) {
  previewForwardEl.addEventListener('click', () => {
    try {
      if (typeof previewFrameEl.goForward === 'function' && safeWebviewCanGoForward()) {
        previewFrameEl.goForward();
        return;
      }
    } catch {}
    if (projectSelectionIndex >= projectSelectionHistory.length - 1) {
      return;
    }
    projectSelectionIndex += 1;
    selectProject(projectSelectionHistory[projectSelectionIndex], { recordHistory: false }).catch(() => {});
  });
}

function reloadActivePreview() {
  const state = ensurePreviewState(selectedProjectPath);
  const url = currentPreviewUrl(state);
  if (!url) return;
  const config = projectRuntimeConfig.get(selectedProjectPath) || defaultRuntimeConfig();
  if (config.sourceType === 'html') {
    refreshSelectedHtmlPreview().catch(() => {});
    return;
  }
  if (typeof previewFrameEl.reload === 'function') {
    previewFrameEl.reload();
    setPreviewMeta(url, 'Live preview');
    return;
  }
  previewFrameEl.src = url;
  setPreviewMeta(url, 'Live preview');
}

previewFrameEl.addEventListener('did-navigate', (event) => {
  setPreviewMeta(currentPreviewUrl(ensurePreviewState(selectedProjectPath)), 'Live preview');
  updateProjectNavigationControls();
});

previewFrameEl.addEventListener('did-navigate-in-page', (event) => {
  setPreviewMeta(currentPreviewUrl(ensurePreviewState(selectedProjectPath)), 'Live preview');
  updateProjectNavigationControls();
});

previewFrameEl.addEventListener('dom-ready', () => {
  updateProjectNavigationControls();
});

previewFrameEl.addEventListener('load', () => {
  updateProjectNavigationControls();
});

if (previewReloadEl) {
  previewReloadEl.addEventListener('click', reloadActivePreview);
}
window.api.onAppRefreshShortcut(() => {
  reloadActivePreview();
});
window.api.onProjectSwitchShortcut(({ direction } = {}) => {
  handleProjectSwitchShortcut(direction);
});

window.addEventListener('resize', () => {
  renderProjectsPanelPosition();
  if (panel.classList.contains('open')) {
    syncTerminalSize();
  }
  queueNativeTerminalPanelSync();
  schedulePreviewCaptureRegionPublish();
});

window.addEventListener('pointerdown', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!openProjectActionsPath) return;
  if (target.closest('.project-item-actions-open')) return;
  openProjectActionsPath = null;
  renderProjects().catch(() => {});
});

(async () => {
  loadHiddenProjects();
  hiddenProjectsExpanded = loadHiddenProjectsExpanded();
  projectsPanelHidden = loadProjectsPanelHidden();
  loadProjectsPanelPosition();
  loadTerminalLayoutState();
  selectedAiCli = loadSelectedAiCli();
  codexDangerouslyBypassPermissions = loadCodexDangerouslyBypassPermissions();
  syncTerminalPresentationMode();
  renderTerminalDockMode();
  renderCodexLaunchConfig();
  refreshAgentMonitor().catch(() => {});
  if (agentMonitorPollTimer) {
    clearInterval(agentMonitorPollTimer);
  }
  agentMonitorPollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshAgentMonitor().catch(() => {});
  }, 30000);
  await window.api.startRendererWatch();
  openPanel();
  selectedProjectPath = loadLastSelectedProject();
  projectSelectionHistory[0] = selectedProjectPath;
  projectSelectionIndex = 0;
  await renderProjects();
  await selectProject(selectedProjectPath, { recordHistory: false });
  renderProjectsPanelVisibility();
  renderProjectsPanelPosition();
  queueNativeTerminalPanelSync();
  schedulePreviewCaptureRegionPublish();
})();
