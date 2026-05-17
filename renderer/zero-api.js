(function zeroApiBootstrap() {
  const baseUrl = window.location.origin;
  const listeners = {
    'terminal:data': [],
    'terminal:exit': [],
    'renderer:changed': [],
    'preview:status': [],
    'preview:htmlChanged': [],
    'app:refreshShortcut': [],
    'app:projectSwitchShortcut': [],
  };

  async function request(path, body = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${path}`);
    }
    if (payload && payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  function on(eventName, callback) {
    listeners[eventName].push(callback);
  }

  const source = new EventSource(`${baseUrl}/api/events`);
  for (const eventName of Object.keys(listeners)) {
    source.addEventListener(eventName, (event) => {
      const payload = event.data ? JSON.parse(event.data) : {};
      for (const callback of listeners[eventName]) {
        callback(payload);
      }
    });
  }

  window.api = {
    getWorkspaceRoot: () => request('/api/workspace/getRoot'),
    getPathForDroppedFile: () => '',
    resolveWorkspacePath: (targetPath) => request('/api/workspace/resolvePath', { path: targetPath }),
    listDir: (targetPath) => request('/api/fs/listDir', { path: targetPath }),
    readFile: (targetPath) => request('/api/fs/readFile', { path: targetPath }),
    writeFile: (targetPath, content) => request('/api/fs/writeFile', { path: targetPath, content }),
    mkdir: (targetPath) => request('/api/fs/mkdir', { path: targetPath }),
    removeDir: (targetPath) => request('/api/fs/removeDir', { path: targetPath }),
    resolvePreviewHtmlFile: (targetPath) => request('/api/preview/resolveHtmlFile', { path: targetPath }),
    resolvePreviewFile: (targetPath) => request('/api/preview/resolveFile', { path: targetPath }),
    execPreviewCommand: (projectPath, command) => request('/api/preview/execCommand', { projectPath, command }),
    syncPreviewRuntime: (projectPath, options = {}) => request('/api/preview/syncRuntime', { projectPath, options }),
    startPreviewRuntime: (projectPath, options = {}) => request('/api/preview/startRuntime', { projectPath, options }),
    stopPreviewRuntime: (projectPath) => request('/api/preview/stopRuntime', { projectPath }),
    watchPreviewHtml: (projectPath, targetPath) => request('/api/preview/watchHtml', { projectPath, path: targetPath }),
    clearPreviewHtmlWatch: () => request('/api/preview/clearHtmlWatch'),
    setPreviewCaptureRegion: (region) => request('/api/preview/setCaptureRegion', region || {}),
    getPreviewCaptureRegion: () => request('/api/preview/getCaptureRegion'),
    startTerminal: (cwd, options = {}) => request('/api/terminal/start', { cwd, options }),
    restartTerminal: (cwd, options = {}) => request('/api/terminal/restart', { cwd, options }),
    startOrRestartTerminal: (cwd, restart = false, options = {}) =>
      request(restart ? '/api/terminal/restart' : '/api/terminal/start', { cwd, options }),
    getStartupTerminalCommand: (options = {}) => request('/api/terminal/getStartupCommand', { options }),
    writeTerminal: (data, key) => request('/api/terminal/write', { data, key }),
    resizeTerminal: (cols, rows, key) => request('/api/terminal/resize', { cols, rows, key }),
    killTerminal: (key) => request('/api/terminal/kill', { key }),
    startRendererWatch: () => request('/api/renderer/watchStart'),
    codexMonitorList: (filters = {}) => request('/api/codexMonitor/list', { filters }),
    codexMonitorDetails: (pid) => request('/api/codexMonitor/details', { pid }),
    codexMonitorStop: (pid, signal = 'SIGTERM') => request('/api/codexMonitor/stop', { pid, signal }),
    onTerminalData: (callback) => on('terminal:data', callback),
    onTerminalExit: (callback) => on('terminal:exit', callback),
    onRendererChanged: (callback) => on('renderer:changed', callback),
    onPreviewStatus: (callback) => on('preview:status', callback),
    onPreviewHtmlChanged: (callback) => on('preview:htmlChanged', callback),
    onAppRefreshShortcut: (callback) => on('app:refreshShortcut', callback),
    onProjectSwitchShortcut: (callback) => on('app:projectSwitchShortcut', callback),
  };
})();
