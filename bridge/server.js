const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');

const { createWorkspaceFs } = require('../lib/workspaceFs');
const { PreviewRuntimeManager } = require('../lib/previewRuntimeManager');
const { TerminalManager } = require('../lib/terminalManager');
const { TerminalSession, defaultShell } = require('../lib/terminalSession');
const codexMonitor = require('../lib/codexMonitor');

const host = '127.0.0.1';
const port = Number(process.env.PIXELBOX_BACKEND_PORT || 3210);
const appRoot = process.cwd();
const events = new EventEmitter();

function resolveWorkspaceRoot() {
  const fromEnv = process.env.PIXELBOX_WORKSPACE_ROOT || process.env.PXCODE_WORKSPACE_ROOT;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  return process.cwd();
}

const workspaceRoot = resolveWorkspaceRoot();
fs.mkdirSync(workspaceRoot, { recursive: true });
const workspaceFs = createWorkspaceFs(workspaceRoot);

let rendererWatcher;
let rendererChangeDebounce;
let previewHtmlWatcher;
let previewHtmlWatcherKey = '';
let previewHtmlWatcherPath = '';
let previewHtmlChangeDebounce;

const sseClients = new Set();

function emit(event, payload) {
  events.emit(event, payload);
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(frame);
  }
}

function terminalSpawnArgs(shell, startupCommand = '') {
  if (process.platform === 'win32') {
    return (!startupCommand || !startupCommand.trim()) ? [] : ['-Command', startupCommand];
  }

  if (!startupCommand || !startupCommand.trim()) return ['-il'];
  return ['-ilc', startupCommand];
}

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

const terminalManager = new TerminalManager({
  createSession({ cwd, startupCommand }) {
    const shell = defaultShell();
    return new TerminalSession({
      shell,
      argv: terminalSpawnArgs(shell, startupCommand),
      cwd: workspaceFs.resolveWorkspacePath(cwd),
    });
  },
  sendData(data) {
    emit('terminal:data', data);
  },
  sendExit(payload) {
    emit('terminal:exit', payload);
  },
});

const previewRuntimeManager = new PreviewRuntimeManager({
  shell: defaultShell(),
  sendStatus(payload) {
    emit('preview:status', payload);
  },
});

function watchRendererFiles() {
  if (rendererWatcher) return;
  const rendererDir = path.join(appRoot, 'renderer');
  rendererWatcher = fs.watch(rendererDir, { recursive: true }, () => {
    clearTimeout(rendererChangeDebounce);
    rendererChangeDebounce = setTimeout(() => {
      emit('renderer:changed', {});
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
  const watchRoot = path.dirname(nextPath);
  if (previewHtmlWatcher && previewHtmlWatcherKey === key && previewHtmlWatcherPath === nextPath) {
    return { ok: true, watching: true };
  }

  clearPreviewHtmlWatcher();
  previewHtmlWatcherKey = key;
  previewHtmlWatcherPath = nextPath;
  previewHtmlWatcher = fs.watch(watchRoot, { recursive: true }, () => {
    clearTimeout(previewHtmlChangeDebounce);
    previewHtmlChangeDebounce = setTimeout(() => {
      emit('preview:htmlChanged', { key, path: nextPath });
    }, 100);
  });
  previewHtmlWatcher.on('error', () => {
    clearPreviewHtmlWatcher();
  });
  return { ok: true, watching: true };
}

function workspaceUrlForPath(relPath) {
  const cleaned = String(relPath || '.')
    .split(path.sep)
    .join('/');
  const encoded = cleaned
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `http://${host}:${port}/__workspace__/${encoded}`;
}

function resolveWorkspaceFile(relPath) {
  const absolutePath = workspaceFs.resolveWorkspacePath(relPath);
  return {
    path: absolutePath,
    url: workspaceUrlForPath(relPath),
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendError(res, error) {
  sendJson(res, 500, {
    error: error && error.message ? error.message : String(error),
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.icns':
      return 'image/icns';
    default:
      return 'application/octet-stream';
  }
}

async function sendFile(res, absolutePath) {
  const data = await fsp.readFile(absolutePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(absolutePath),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function resolveStaticPath(urlPath) {
  if (urlPath === '/') {
    return path.join(appRoot, 'renderer', 'index.html');
  }

  if (urlPath.startsWith('/renderer/') || urlPath.startsWith('/assets/') || urlPath.startsWith('/node_modules/')) {
    const absolutePath = path.join(appRoot, urlPath.replace(/^\/+/, ''));
    const relative = path.relative(appRoot, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path is outside app root');
    }
    return absolutePath;
  }

  if (urlPath.startsWith('/__workspace__/')) {
    const relPath = decodeURIComponent(urlPath.slice('/__workspace__/'.length));
    return workspaceFs.resolveWorkspacePath(relPath);
  }

  return null;
}

async function handleApi(req, res, pathname) {
  const body = req.method === 'POST' ? await readJsonBody(req) : {};

  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('event: ready\ndata: {}\n\n');
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  if (pathname === '/health') {
    return sendJson(res, 200, { ok: true, port, workspaceRoot });
  }

  if (pathname === '/api/workspace/getRoot') {
    return sendJson(res, 200, workspaceRoot);
  }
  if (pathname === '/api/workspace/resolvePath') {
    return sendJson(res, 200, workspaceFs.resolveWorkspacePath(body.path || '.'));
  }
  if (pathname === '/api/fs/listDir') {
    return sendJson(res, 200, await workspaceFs.listDir(body.path || '.'));
  }
  if (pathname === '/api/fs/readFile') {
    try {
      return sendJson(res, 200, await workspaceFs.readFile(body.path));
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return sendJson(res, 200, { path: body.path, content: '' });
      }
      throw error;
    }
  }
  if (pathname === '/api/fs/writeFile') {
    return sendJson(res, 200, await workspaceFs.writeFile(body.path, body.content));
  }
  if (pathname === '/api/fs/mkdir') {
    return sendJson(res, 200, await workspaceFs.mkdir(body.path));
  }
  if (pathname === '/api/fs/removeDir') {
    return sendJson(res, 200, await workspaceFs.removeDir(body.path));
  }
  if (pathname === '/api/preview/resolveHtmlFile') {
    return sendJson(res, 200, resolveWorkspaceFile(body.path));
  }
  if (pathname === '/api/preview/resolveFile') {
    return sendJson(res, 200, resolveWorkspaceFile(body.path));
  }
  if (pathname === '/api/preview/execCommand') {
    const cwd = workspaceFs.resolveWorkspacePath(body.projectPath || '.');
    const shell = defaultShell();
    if (!body.command || !body.command.trim()) {
      return sendJson(res, 200, { ok: true, stdout: '', stderr: '', code: 0 });
    }
    return new Promise((resolve) => {
      execFile(shell, ['-lc', body.command], { cwd, env: { ...process.env } }, (error, stdout = '', stderr = '') => {
        sendJson(res, 200, {
          ok: !error,
          stdout,
          stderr,
          code: typeof error?.code === 'number' ? error.code : 0,
        });
        resolve();
      });
    });
  }
  if (pathname === '/api/preview/syncRuntime') {
    const projectPath = body.projectPath || '.';
    const options = body.options || {};
    const cwd = workspaceFs.resolveWorkspacePath(projectPath);
    const resolvedOptions = await previewRuntimeManager.resolveLaunchOptions(projectPath, {
      cwd,
      sourceType: options.sourceType,
      command: options.command,
      url: options.url,
      autoStart: options.autoStart,
    });
    return sendJson(res, 200, await previewRuntimeManager.syncProject(projectPath, resolvedOptions));
  }
  if (pathname === '/api/preview/startRuntime') {
    const projectPath = body.projectPath || '.';
    const options = body.options || {};
    const cwd = workspaceFs.resolveWorkspacePath(projectPath);
    const resolvedOptions = await previewRuntimeManager.resolveLaunchOptions(projectPath, {
      cwd,
      sourceType: options.sourceType || 'server',
      command: options.command,
      url: options.url,
    });
    return sendJson(res, 200, await previewRuntimeManager.start(projectPath, resolvedOptions));
  }
  if (pathname === '/api/preview/stopRuntime') {
    previewRuntimeManager.stop(body.projectPath || '.', { keepStoppedState: true });
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/preview/watchHtml') {
    return sendJson(res, 200, watchPreviewHtmlFile(body.projectPath || '.', workspaceFs.resolveWorkspacePath(body.path)));
  }
  if (pathname === '/api/preview/clearHtmlWatch') {
    clearPreviewHtmlWatcher();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/terminal/getStartupCommand') {
    return sendJson(res, 200, getStartupTerminalCommand(body.options || {}));
  }
  if (pathname === '/api/terminal/start') {
    return sendJson(res, 200, terminalManager.start(body.cwd || '.', {
      cwd: body.cwd || '.',
      startupCommand: body.options?.startupCommand,
    }));
  }
  if (pathname === '/api/terminal/restart') {
    return sendJson(res, 200, terminalManager.restart(body.cwd || '.', {
      cwd: body.cwd || '.',
      startupCommand: body.options?.startupCommand,
    }));
  }
  if (pathname === '/api/terminal/write') {
    terminalManager.write(body.data, body.key);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/terminal/resize') {
    terminalManager.resize(body.cols, body.rows, body.key);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/terminal/kill') {
    terminalManager.kill(body.key);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/renderer/watchStart') {
    watchRendererFiles();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/codexMonitor/list') {
    return sendJson(res, 200, codexMonitor.getProcesses(body.filters || {}));
  }
  if (pathname === '/api/codexMonitor/details') {
    const numericPid = Number(body.pid);
    if (!Number.isFinite(numericPid)) {
      throw new Error('A numeric pid is required.');
    }
    const processInfo = codexMonitor.getProcesses().find((item) => item.pid === numericPid);
    if (!processInfo) {
      throw new Error(`PID ${numericPid} was not found.`);
    }
    return sendJson(res, 200, codexMonitor.getProcessDetails(processInfo));
  }
  if (pathname === '/api/codexMonitor/stop') {
    return sendJson(res, 200, codexMonitor.stopProcess(body.pid, body.signal || 'SIGTERM'));
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${host}:${port}`);
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      await handleApi(req, res, url.pathname);
      return;
    }

    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    await sendFile(res, filePath);
  } catch (error) {
    sendError(res, error);
  }
});

function shutdown() {
  try {
    terminalManager.kill();
  } catch {}
  try {
    previewRuntimeManager.stopAll();
  } catch {}
  clearPreviewHtmlWatcher();
  if (rendererWatcher) {
    rendererWatcher.close();
    rendererWatcher = null;
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(port, host, () => {
  console.log(`Pixelbox backend ready`);
  console.log(`http://${host}:${port}/renderer/index.html`);
});
