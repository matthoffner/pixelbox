const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getWorkspaceRoot: () => ipcRenderer.invoke('workspace:getRoot'),
  listDir: (path) => ipcRenderer.invoke('fs:listDir', path),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  mkdir: (path) => ipcRenderer.invoke('fs:mkdir', path),
  startTerminal: (cwd, options = {}) => ipcRenderer.invoke('terminal:start', cwd, options),
  restartTerminal: (cwd, options = {}) => ipcRenderer.invoke('terminal:restart', cwd, options),
  startOrRestartTerminal: (cwd, restart = false, options = {}) =>
    (restart
      ? ipcRenderer.invoke('terminal:restart', cwd, options)
      : ipcRenderer.invoke('terminal:start', cwd, options)),
  getStartupTerminalCommand: (options = {}) => ipcRenderer.invoke('terminal:getStartupCommand', options),
  writeTerminal: (data) => ipcRenderer.send('terminal:write', data),
  resizeTerminal: (cols, rows) => ipcRenderer.send('terminal:resize', cols, rows),
  killTerminal: () => ipcRenderer.send('terminal:kill'),
  startRendererWatch: () => ipcRenderer.invoke('renderer:watchStart'),
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal:data', (_event, data) => callback(data));
  },
  onTerminalExit: (callback) => {
    ipcRenderer.on('terminal:exit', () => callback());
  },
  onRendererChanged: (callback) => {
    ipcRenderer.on('renderer:changed', () => callback());
  },
});
