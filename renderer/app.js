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
const headlineEl = document.getElementById('headline');
const previewFrameEl = document.getElementById('preview-frame');
const previewUrlEl = document.getElementById('preview-url');
const previewBackEl = document.getElementById('preview-back');
const previewForwardEl = document.getElementById('preview-forward');
const previewReloadEl = document.getElementById('preview-reload');

window.__pwTerminalOutput = '';
let reloadTimer;
let selectedProjectPath = '.';
let startResult;
const projectPreviewState = new Map();

function ensurePreviewState(projectPath) {
  if (!projectPreviewState.has(projectPath)) {
    projectPreviewState.set(projectPath, { history: [], index: -1 });
  }
  return projectPreviewState.get(projectPath);
}

function updatePreviewControls(state) {
  previewBackEl.disabled = state.index <= 0;
  previewForwardEl.disabled = state.index >= state.history.length - 1;
  previewReloadEl.disabled = state.index < 0;
}

function currentPreviewUrl(state) {
  if (state.index < 0 || state.index >= state.history.length) return '';
  return state.history[state.index] || '';
}

function renderPreviewForProject(projectPath) {
  const state = ensurePreviewState(projectPath);
  const url = currentPreviewUrl(state);
  if (!url) {
    previewUrlEl.textContent = 'No running page detected for this project yet.';
    previewFrameEl.src = 'about:blank';
    updatePreviewControls(state);
    return;
  }
  previewUrlEl.textContent = url;
  if (previewFrameEl.src !== url) previewFrameEl.src = url;
  updatePreviewControls(state);
}

function pushPreviewUrl(projectPath, rawUrl) {
  const url = rawUrl.trim().replace(/[),.;]+$/, '');
  if (!/^https?:\/\//i.test(url)) return;
  const state = ensurePreviewState(projectPath);
  const current = currentPreviewUrl(state);
  if (current === url) return;
  state.history = state.history.slice(0, state.index + 1);
  state.history.push(url);
  state.index = state.history.length - 1;
  if (projectPath === selectedProjectPath) renderPreviewForProject(projectPath);
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
  requestAnimationFrame(() => {
    syncTerminalSize();
    focusTerminal();
  });
}

function closePanel() {
  panel.classList.remove('open');
  toggle.style.display = 'inline-flex';
}

function projectButton(label, relPath, active, clickHandler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `project-btn${active ? ' active' : ''}`;
  btn.textContent = label;
  btn.addEventListener('click', () => clickHandler(relPath));
  return btn;
}

function sanitizeProjectName(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function applyLayoutVariant(index) {
  document.body.classList.remove('layout-0', 'layout-1', 'layout-2');
  document.body.classList.add(`layout-${index % 3}`);
}

async function bootTerminalForPath(relPath, shouldRunStartup = false) {
  window.__pwTerminalOutput = '';
  term.clear();
  const startupCommand = shouldRunStartup
    ? await window.api.getStartupTerminalCommand({
      hasPseudoTTY: Boolean(startResult && startResult.hasPseudoTTY),
    })
    : '';
  const result = await window.api.startOrRestartTerminal(relPath, true, { startupCommand });
  startResult = result;

  requestAnimationFrame(() => {
    syncTerminalSize();
    focusTerminal();
  });

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

  const activeIndex = Math.max(0, projects.findIndex((p) => p.path === selectedProjectPath));
  applyLayoutVariant(selectedProjectPath === '.' ? 0 : activeIndex + 1);
}

async function selectProject(relPath) {
  selectedProjectPath = relPath;
  await renderProjects();
  await bootTerminalForPath(selectedProjectPath, true);
  renderPreviewForProject(selectedProjectPath);
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
  await window.api.writeFile(`${relPath}/README.md`, `# ${projectName}\n\nCreated from PxCode.\n`);
  selectedProjectPath = relPath;
  await renderProjects();
  await bootTerminalForPath(selectedProjectPath, true);
}

window.api.onTerminalData((data) => {
  window.__pwTerminalOutput += data;
  term.write(data);

  const matches = data.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}[^\s"'<>)\]]*/gi) || [];
  for (const match of matches) pushPreviewUrl(selectedProjectPath, match);
});

term.onData((data) => {
  window.api.writeTerminal(data);
});

window.api.onTerminalExit(() => {
  term.writeln('\r\n[terminal exited]');
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
terminalEl.addEventListener('mousedown', focusTerminal);
panel.addEventListener('mousedown', focusTerminal);
previewBackEl.addEventListener('click', () => {
  const state = ensurePreviewState(selectedProjectPath);
  if (state.index <= 0) return;
  state.index -= 1;
  renderPreviewForProject(selectedProjectPath);
});
previewForwardEl.addEventListener('click', () => {
  const state = ensurePreviewState(selectedProjectPath);
  if (state.index >= state.history.length - 1) return;
  state.index += 1;
  renderPreviewForProject(selectedProjectPath);
});
previewReloadEl.addEventListener('click', () => {
  const state = ensurePreviewState(selectedProjectPath);
  const url = currentPreviewUrl(state);
  if (!url) return;
  previewFrameEl.src = url;
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
  renderPreviewForProject(selectedProjectPath);
})();
