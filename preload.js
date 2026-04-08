const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getWorkspaceRoot: () => ipcRenderer.invoke('workspace:getRoot'),
  resolveWorkspacePath: (path) => ipcRenderer.invoke('workspace:resolvePath', path),
  listDir: (path) => ipcRenderer.invoke('fs:listDir', path),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  mkdir: (path) => ipcRenderer.invoke('fs:mkdir', path),
  removeDir: (path) => ipcRenderer.invoke('fs:removeDir', path),
  resolvePreviewHtmlFile: (path) => ipcRenderer.invoke('preview:resolveHtmlFile', path),
  syncPreviewRuntime: (projectPath, options = {}) => ipcRenderer.invoke('preview:syncRuntime', projectPath, options),
  startPreviewRuntime: (projectPath, options = {}) => ipcRenderer.invoke('preview:startRuntime', projectPath, options),
  stopPreviewRuntime: (projectPath) => ipcRenderer.invoke('preview:stopRuntime', projectPath),
  watchPreviewHtml: (projectPath, path) => ipcRenderer.invoke('preview:watchHtml', projectPath, path),
  clearPreviewHtmlWatch: () => ipcRenderer.invoke('preview:clearHtmlWatch'),
  startTerminal: (cwd, options = {}) => ipcRenderer.invoke('terminal:start', cwd, options),
  restartTerminal: (cwd, options = {}) => ipcRenderer.invoke('terminal:restart', cwd, options),
  startOrRestartTerminal: (cwd, restart = false, options = {}) =>
    (restart
      ? ipcRenderer.invoke('terminal:restart', cwd, options)
      : ipcRenderer.invoke('terminal:start', cwd, options)),
  getStartupTerminalCommand: (options = {}) => ipcRenderer.invoke('terminal:getStartupCommand', options),
  writeTerminal: (data, key) => ipcRenderer.send('terminal:write', data, key),
  resizeTerminal: (cols, rows, key) => ipcRenderer.send('terminal:resize', cols, rows, key),
  killTerminal: () => ipcRenderer.send('terminal:kill'),
  startRendererWatch: () => ipcRenderer.invoke('renderer:watchStart'),
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal:data', (_event, payload) => callback(payload));
  },
  onTerminalExit: (callback) => {
    ipcRenderer.on('terminal:exit', (_event, payload) => callback(payload));
  },
  onRendererChanged: (callback) => {
    ipcRenderer.on('renderer:changed', () => callback());
  },
  onPreviewStatus: (callback) => {
    ipcRenderer.on('preview:status', (_event, payload) => callback(payload));
  },
  onPreviewHtmlChanged: (callback) => {
    ipcRenderer.on('preview:htmlChanged', (_event, payload) => callback(payload));
  },
  onAppRefreshShortcut: (callback) => {
    ipcRenderer.on('app:refreshShortcut', () => callback());
  },
});
