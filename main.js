const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createWorkspaceFs } = require('./lib/workspaceFs');
const { TerminalSession, defaultShell } = require('./lib/terminalSession');

const workspaceRoot = process.cwd();
const workspaceFs = createWorkspaceFs(workspaceRoot);
let mainWindow;
let terminalSession;
let rendererWatcher;
let rendererChangeDebounce;

function getStartupTerminalCommand(options = {}) {
  if (process.env.PXCODE_DISABLE_AUTO_TUI === '1') {
    return '';
  }

  const preferred = process.env.PXCODE_TUI_COMMAND;
  if (preferred && preferred.trim()) {
    return preferred.trim();
  }

  return 'clear; command -v codex >/dev/null 2>&1 && exec env TERM=xterm-256color codex || echo "codex CLI not found in PATH."';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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

function attachIpcHandlers() {
  ipcMain.handle('workspace:getRoot', () => workspaceRoot);
  ipcMain.handle('terminal:getStartupCommand', (_event, options = {}) => getStartupTerminalCommand(options));
  const terminalSpawnArgs = (startupCommand = '') => {
    if (!startupCommand || !startupCommand.trim()) return [];
    return ['-lc', startupCommand];
  };

  ipcMain.handle('fs:listDir', async (_event, relPath = '.') => {
    return workspaceFs.listDir(relPath);
  });

  ipcMain.handle('fs:readFile', async (_event, relPath) => {
    return workspaceFs.readFile(relPath);
  });

  ipcMain.handle('fs:writeFile', async (_event, relPath, content) => {
    return workspaceFs.writeFile(relPath, content);
  });

  ipcMain.handle('fs:mkdir', async (_event, relPath) => {
    return workspaceFs.mkdir(relPath);
  });

  ipcMain.handle('terminal:start', (_event, cwd = '.', options = {}) => {
    if (terminalSession) return { ok: true, hasPseudoTTY: terminalSession.hasPseudoTTY === true };

    terminalSession = new TerminalSession({
      shell: defaultShell(),
      argv: terminalSpawnArgs(options.startupCommand),
      cwd: workspaceFs.resolveWorkspacePath(cwd),
    });

    terminalSession.onData((data) => {
      mainWindow.webContents.send('terminal:data', data);
    });

    terminalSession.onExit(() => {
      terminalSession = null;
      mainWindow.webContents.send('terminal:exit');
    });

    return { ok: true, hasPseudoTTY: terminalSession.hasPseudoTTY === true };
  });

  ipcMain.handle('terminal:restart', (_event, cwd = '.', options = {}) => {
    if (terminalSession) {
      terminalSession.kill();
      terminalSession = null;
    }

    terminalSession = new TerminalSession({
      shell: defaultShell(),
      argv: terminalSpawnArgs(options.startupCommand),
      cwd: workspaceFs.resolveWorkspacePath(cwd),
    });

    terminalSession.onData((data) => {
      mainWindow.webContents.send('terminal:data', data);
    });

    terminalSession.onExit(() => {
      terminalSession = null;
      mainWindow.webContents.send('terminal:exit');
    });

    return { ok: true, hasPseudoTTY: terminalSession.hasPseudoTTY === true };
  });

  ipcMain.handle('renderer:watchStart', () => {
    watchRendererFiles();
    return { ok: true };
  });

  ipcMain.on('terminal:write', (_event, data) => {
    if (terminalSession) {
      terminalSession.write(data);
    }
  });

  ipcMain.on('terminal:resize', (_event, cols, rows) => {
    if (terminalSession) {
      terminalSession.resize(cols, rows);
    }
  });

  ipcMain.on('terminal:kill', () => {
    if (terminalSession) {
      terminalSession.kill();
      terminalSession = null;
    }
  });
}

app.whenReady().then(() => {
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
  if (terminalSession) {
    terminalSession.kill();
    terminalSession = null;
  }
});
