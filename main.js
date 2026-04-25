const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createWorkspaceFs } = require('./lib/workspaceFs');
const { PreviewRuntimeManager } = require('./lib/previewRuntimeManager');
const { TerminalManager } = require('./lib/terminalManager');
const { TerminalSession, defaultShell } = require('./lib/terminalSession');

function resolveWorkspaceRoot() {
  const fromEnv = process.env.PIXELBOX_WORKSPACE_ROOT || process.env.PXCODE_WORKSPACE_ROOT;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }

  if (app.isPackaged) {
    return path.join(os.homedir(), 'pixelbox-workspace');
  }

  return process.cwd();
}

const workspaceRoot = resolveWorkspaceRoot();
fs.mkdirSync(workspaceRoot, { recursive: true });
const workspaceFs = createWorkspaceFs(workspaceRoot);
const appIconPath = path.join(__dirname, 'assets', 'pixelbox-icon.png');
app.setName('Pixelbox');
let mainWindow;
let rendererWatcher;
let rendererChangeDebounce;
let terminalManager;
let previewRuntimeManager;
let previewHtmlWatcher;
let previewHtmlWatcherKey = '';
let previewHtmlWatcherPath = '';
let previewHtmlChangeDebounce;

function getStartupTerminalCommand(options = {}) {
  if (process.env.PXCODE_DISABLE_AUTO_TUI === '1') {
    return '';
  }

  const preferred = process.env.PXCODE_TUI_COMMAND;
  if (preferred && preferred.trim()) {
    return preferred.trim();
  }

  const launcher = ['codex', 'claude', 'gemini', 'hermes', 'openclaw', 'custom'].includes(options.aiCli)
    ? options.aiCli
    : 'codex';

  const definitions = {
    codex: {
      binary: 'codex',
      missing: 'Codex CLI not found in PATH.',
      command: options.codexDangerouslyBypassPermissions
        ? 'env TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox'
        : 'env TERM=xterm-256color codex resume --last || env TERM=xterm-256color codex',
    },
    claude: {
      binary: 'claude',
      missing: 'Claude CLI not found in PATH.',
      command: options.codexDangerouslyBypassPermissions
        ? 'env TERM=xterm-256color claude --dangerously-skip-permissions'
        : 'env TERM=xterm-256color claude --continue || env TERM=xterm-256color claude',
    },
    gemini: {
      binary: 'gemini',
      missing: 'Gemini CLI not found in PATH.',
      command: 'env TERM=xterm-256color gemini',
    },
    hermes: {
      binary: 'hermes',
      missing: 'Hermes CLI not found in PATH.',
      command: 'env TERM=xterm-256color hermes',
    },
    openclaw: {
      binary: 'openclaw',
      missing: 'OpenClaw CLI not found in PATH.',
      command: 'env TERM=xterm-256color openclaw tui',
    },
  };

  if (launcher === 'custom') {
    return '';
  }

  const active = definitions[launcher];
  return `clear; if command -v ${active.binary} >/dev/null 2>&1; then ${active.command}; else echo "${active.missing}"; fi`;
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Pixelbox',
    icon: appIconPath,
    titleBarStyle: 'hiddenInset',
    transparent: isMac,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundMaterial: isMac ? 'under-window' : 'none',
    backgroundColor: isMac ? '#00000000' : '#071425',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  if (isMac && typeof mainWindow.setVibrancy === 'function') {
    mainWindow.setVibrancy('under-window');
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key ? input.key.toLowerCase() : '';
    const isKeyDown = input.type === 'keyDown';
    const isRefreshShortcut = isKeyDown && key === 'r' && (input.meta || input.control);
    if (!isRefreshShortcut) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:refreshShortcut');
    }
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const key = input.key ? input.key.toLowerCase() : '';
    const isDirectionalShortcut =
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      input.shift &&
      (input.meta || input.control) &&
      (key === 'arrowleft' || key === 'left' || key === 'arrowright' || key === 'right');
    if (!isDirectionalShortcut) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('app:projectSwitchShortcut', {
      direction: key.includes('left') ? -1 : 1,
    });
  });

  if (process.env.PXCODE_CAPTURE_ON_LOAD === '1') {
    const capturePath = path.join(workspaceRoot, 'screenshots', 'live-capture', `capture-${Date.now()}.png`);
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          await fsp.mkdir(path.dirname(capturePath), { recursive: true });
          await fsp.writeFile(capturePath, image.toPNG());
          // eslint-disable-next-line no-console
          console.log(`[pxcode:capture] ${capturePath}`);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`[pxcode:capture:error] ${error.message}`);
        }
      }, 3500);
    });
  }
}

function watchRendererFiles() {
  if (rendererWatcher) return;

  const rendererDir = path.join(__dirname, 'renderer');
  rendererWatcher = fs.watch(rendererDir, { recursive: true }, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(rendererChangeDebounce);
    rendererChangeDebounce = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('renderer:changed');
    }, 100);
  });
}

function clearPreviewHtmlWatcher() {
  if (previewHtmlWatcher) {
    previewHtmlWatcher.close();
    previewHtmlWatcher = null;
  }
  previewHtmlWatcherKey = '';
  previewHtmlWatcherPath = '';
  clearTimeout(previewHtmlChangeDebounce);
}

function watchPreviewHtmlFile(key, absolutePath) {
  const nextPath = path.resolve(absolutePath);
  if (previewHtmlWatcher && previewHtmlWatcherKey === key && previewHtmlWatcherPath === nextPath) {
    return { ok: true, watching: true };
  }

  clearPreviewHtmlWatcher();

  previewHtmlWatcherKey = key;
  previewHtmlWatcherPath = nextPath;
  previewHtmlWatcher = fs.watch(nextPath, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(previewHtmlChangeDebounce);
    previewHtmlChangeDebounce = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('preview:htmlChanged', {
        key,
        path: nextPath,
      });
    }, 100);
  });

  previewHtmlWatcher.on('error', () => {
    clearPreviewHtmlWatcher();
  });

  return { ok: true, watching: true };
}

function attachIpcHandlers() {
  ipcMain.handle('workspace:getRoot', () => workspaceRoot);
  ipcMain.handle('workspace:resolvePath', (_event, relPath = '.') => {
    return workspaceFs.resolveWorkspacePath(relPath);
  });
  ipcMain.handle('terminal:getStartupCommand', (_event, options = {}) => getStartupTerminalCommand(options));
  const terminalSpawnArgs = (startupCommand = '') => {
    if (!startupCommand || !startupCommand.trim()) return [];
    return ['-lc', startupCommand];
  };
  const ensureTerminalManager = () => {
    if (terminalManager) return terminalManager;
    terminalManager = new TerminalManager({
      createSession({ cwd, startupCommand }) {
        return new TerminalSession({
          shell: defaultShell(),
          argv: terminalSpawnArgs(startupCommand),
          cwd: workspaceFs.resolveWorkspacePath(cwd),
        });
      },
      sendData(data) {
        mainWindow.webContents.send('terminal:data', data);
      },
      sendExit(payload) {
        mainWindow.webContents.send('terminal:exit', payload);
      },
    });
    return terminalManager;
  };
  const ensurePreviewRuntimeManager = () => {
    if (previewRuntimeManager) return previewRuntimeManager;
    previewRuntimeManager = new PreviewRuntimeManager({
      shell: defaultShell(),
      sendStatus(payload) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('preview:status', payload);
        }
      },
    });
    return previewRuntimeManager;
  };

  ipcMain.handle('fs:listDir', async (_event, relPath = '.') => {
    return workspaceFs.listDir(relPath);
  });

  ipcMain.handle('fs:readFile', async (_event, relPath) => {
    try {
      return await workspaceFs.readFile(relPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { path: relPath, content: '' };
      }
      throw error;
    }
  });

  ipcMain.handle('fs:writeFile', async (_event, relPath, content) => {
    return workspaceFs.writeFile(relPath, content);
  });

  ipcMain.handle('fs:mkdir', async (_event, relPath) => {
    return workspaceFs.mkdir(relPath);
  });

  ipcMain.handle('fs:removeDir', async (_event, relPath) => {
    return workspaceFs.removeDir(relPath);
  });

  ipcMain.handle('preview:resolveHtmlFile', async (_event, relPath) => {
    const absolutePath = workspaceFs.resolveWorkspacePath(relPath);
    await fsp.access(absolutePath, fs.constants.R_OK);
    return {
      path: absolutePath,
      url: pathToFileURL(absolutePath).href,
    };
  });

  ipcMain.handle('preview:resolveFile', async (_event, relPath) => {
    const absolutePath = workspaceFs.resolveWorkspacePath(relPath);
    await fsp.access(absolutePath, fs.constants.R_OK);
    return {
      path: absolutePath,
      url: pathToFileURL(absolutePath).href,
    };
  });

  ipcMain.handle('preview:execCommand', async (_event, projectPath = '.', command = '') => {
    const cwd = workspaceFs.resolveWorkspacePath(projectPath);
    const shell = defaultShell();

    if (!command || !command.trim()) {
      return { ok: true, stdout: '', stderr: '', code: 0 };
    }

    return new Promise((resolve) => {
      execFile(shell, ['-lc', command], { cwd, env: { ...process.env } }, (error, stdout = '', stderr = '') => {
        resolve({
          ok: !error,
          stdout,
          stderr,
          code: typeof error?.code === 'number' ? error.code : 0,
        });
      });
    });
  });

  ipcMain.handle('preview:syncRuntime', (_event, projectPath = '.', options = {}) => {
    const manager = ensurePreviewRuntimeManager();
    const cwd = workspaceFs.resolveWorkspacePath(projectPath);
    return manager.syncProject(projectPath, {
      cwd,
      sourceType: options.sourceType,
      command: options.command,
      url: options.url,
      autoStart: options.autoStart,
    });
  });

  ipcMain.handle('preview:startRuntime', (_event, projectPath = '.', options = {}) => {
    const manager = ensurePreviewRuntimeManager();
    const cwd = workspaceFs.resolveWorkspacePath(projectPath);
    return manager.start(projectPath, {
      cwd,
      sourceType: options.sourceType || 'server',
      command: options.command,
      url: options.url,
    });
  });

  ipcMain.handle('preview:stopRuntime', (_event, projectPath = '.') => {
    ensurePreviewRuntimeManager().stop(projectPath, { keepStoppedState: true });
    return { ok: true };
  });

  ipcMain.handle('preview:watchHtml', (_event, projectPath = '.', relPath) => {
    const absolutePath = workspaceFs.resolveWorkspacePath(relPath);
    return watchPreviewHtmlFile(projectPath, absolutePath);
  });

  ipcMain.handle('preview:clearHtmlWatch', () => {
    clearPreviewHtmlWatcher();
    return { ok: true };
  });

  ipcMain.handle('terminal:start', (_event, cwd = '.', options = {}) => {
    return ensureTerminalManager().start(cwd, {
      cwd,
      startupCommand: options.startupCommand,
    });
  });

  ipcMain.handle('terminal:restart', (_event, cwd = '.', options = {}) => {
    return ensureTerminalManager().restart(cwd, {
      cwd,
      startupCommand: options.startupCommand,
    });
  });

  ipcMain.handle('renderer:watchStart', () => {
    watchRendererFiles();
    return { ok: true };
  });

  ipcMain.on('terminal:write', (_event, data, key) => {
    ensureTerminalManager().write(data, key);
  });

  ipcMain.on('terminal:resize', (_event, cols, rows, key) => {
    ensureTerminalManager().resize(cols, rows, key);
  });

  ipcMain.on('terminal:kill', () => {
    ensureTerminalManager().kill();
  });
}

app.whenReady().then(() => {
  app.setName('Pixelbox');
  Menu.setApplicationMenu(null);
  if (process.platform === 'darwin' && app.dock && fs.existsSync(appIconPath)) {
    app.dock.setIcon(appIconPath);
  }
  attachIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (rendererWatcher) {
    rendererWatcher.close();
    rendererWatcher = null;
  }
  if (terminalManager) {
    terminalManager.kill();
    terminalManager = null;
  }
  if (previewRuntimeManager) {
    previewRuntimeManager.stopAll();
    previewRuntimeManager = null;
  }
  clearPreviewHtmlWatcher();
});
