const { app, BrowserWindow, ipcMain, Menu } = require('electron');
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

  return 'clear; if command -v codex >/dev/null 2>&1; then env TERM=xterm-256color codex resume --last || env TERM=xterm-256color codex; else echo "codex CLI not found in PATH."; fi';
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
    const isRefreshShortcut =
      input.type === 'keyDown' &&
      input.key &&
      input.key.toLowerCase() === 'r' &&
      (input.meta || input.control);
    if (!isRefreshShortcut) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:refreshShortcut');
    }
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
