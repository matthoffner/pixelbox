const http = require('node:http');
const crypto = require('node:crypto');
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
const { probeUrl } = require('../lib/previewProbe');
const { capturePreviewSnapshot, snapshotRelativePath } = require('../lib/previewSnapshot');
const codexMonitor = require('../lib/codexMonitor');
const { captureProjectFingerprint, shouldExcludeRelativePath } = require('../lib/projectFingerprint');
const { createBridgeSecurity } = require('../lib/bridgeSecurity');
const { createPreviewAccess } = require('../lib/previewAccess');

const host = '127.0.0.1';
const port = Number(process.env.PIXELBOX_BACKEND_PORT || 3210);
const appRoot = process.cwd();
const events = new EventEmitter();
const bridgeSecurity = createBridgeSecurity({ host, port });

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
const previewAccess = createPreviewAccess({ workspaceRoot, port, prefix: '/__preview__' });
const evidenceAccess = createPreviewAccess({
  workspaceRoot,
  port,
  prefix: '/__evidence__',
  allowControlPaths: true,
});

let rendererWatcher;
let rendererChangeDebounce;
let previewHtmlWatcher;
let previewHtmlWatcherKey = '';
let previewHtmlWatcherPath = '';
let previewHtmlChangeDebounce;
let previewCaptureRegion = null;
let workspaceWatcher;
let workspaceWatcherKey = '';
let workspaceChangeDebounce;
let workspaceWatcherRevision = 0;

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
  sendLog(payload) {
    emit('preview:log', payload);
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

function clearWorkspaceWatcher() {
  if (workspaceWatcher) {
    workspaceWatcher.close();
    workspaceWatcher = null;
  }
  workspaceWatcherKey = '';
  workspaceWatcherRevision = 0;
  clearTimeout(workspaceChangeDebounce);
}

async function watchWorkspaceProject(projectPath = '.') {
  const key = projectPath || '.';
  if (workspaceWatcher && workspaceWatcherKey === key) {
    return { ok: true, watching: true, key };
  }
  clearWorkspaceWatcher();
  const absolutePath = workspaceFs.resolveWorkspacePath(key);
  const [realWorkspaceRoot, realProjectRoot] = await Promise.all([
    fsp.realpath(workspaceRoot),
    fsp.realpath(absolutePath),
  ]);
  const relative = path.relative(realWorkspaceRoot, realProjectRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Workspace watch target is outside workspace');
  }

  workspaceWatcherKey = key;
  const onChange = (_eventType, filename) => {
    const changedPath = filename ? String(filename) : '';
    if (changedPath && shouldExcludeRelativePath(changedPath, { excludeProjects: key === '.' })) return;
    workspaceWatcherRevision += 1;
    clearTimeout(workspaceChangeDebounce);
    workspaceChangeDebounce = setTimeout(() => {
      emit('workspace:changed', { key, path: changedPath });
    }, 180);
  };
  try {
    workspaceWatcher = fs.watch(realProjectRoot, { recursive: true }, onChange);
  } catch {
    workspaceWatcher = fs.watch(realProjectRoot, onChange);
  }
  workspaceWatcher.on('error', () => clearWorkspaceWatcher());
  return { ok: true, watching: true, key };
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
  previewHtmlWatcher = fs.watch(watchRoot, { recursive: true }, (_eventType, filename) => {
    const changedPath = filename ? String(filename) : '';
    if (changedPath && shouldExcludeRelativePath(changedPath, { excludeProjects: key === '.' })) return;
    clearTimeout(previewHtmlChangeDebounce);
    previewHtmlChangeDebounce = setTimeout(() => {
      emit('preview:htmlChanged', { key, path: changedPath || nextPath });
    }, 100);
  });
  previewHtmlWatcher.on('error', () => {
    clearPreviewHtmlWatcher();
  });
  return { ok: true, watching: true };
}

async function resolveWorkspaceFile(relPath, access = evidenceAccess) {
  const absolutePath = workspaceFs.resolveWorkspacePath(relPath);
  const capability = await access.issue(absolutePath);
  return {
    path: absolutePath,
    url: capability.url,
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendMethodNotAllowed(res, allow) {
  res.writeHead(405, {
    Allow: allow,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(`${JSON.stringify({ error: 'Method not allowed' })}\n`);
}

function sendError(res, error) {
  sendJson(res, Number(error?.statusCode) || 500, {
    error: error && error.message ? error.message : String(error),
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      const error = new Error('Request body exceeds 1 MiB limit');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function verifyWorkspaceEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const expected = String(evidence.digest || '');
  const relativePath = String(evidence.path || '');
  if (!relativePath || !expected.startsWith('sha256:')) {
    return { path: relativePath, match: false, digest: '' };
  }
  try {
    const absolutePath = workspaceFs.resolveWorkspacePath(relativePath);
    const [realRoot, realTarget] = await Promise.all([
      fsp.realpath(workspaceRoot),
      fsp.realpath(absolutePath),
    ]);
    const relative = path.relative(realRoot, realTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { path: relativePath, match: false, digest: '' };
    }
    const bytes = await fsp.readFile(realTarget);
    const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    return { path: relativePath, match: digest === expected, digest };
  } catch {
    return { path: relativePath, match: false, digest: '' };
  }
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
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

async function resolveStaticPath(urlPath, requestHost) {
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

  if (urlPath.startsWith(`${previewAccess.prefix}/`)) {
    if (String(requestHost || '').toLowerCase() !== `localhost:${port}`) {
      const error = new Error('Preview capabilities require the isolated localhost origin');
      error.statusCode = 403;
      throw error;
    }
    return (await previewAccess.resolve(urlPath)).filePath;
  }

  if (urlPath.startsWith(`${evidenceAccess.prefix}/`)) {
    if (String(requestHost || '').toLowerCase() !== `localhost:${port}`) {
      const error = new Error('Evidence capabilities require the isolated localhost origin');
      error.statusCode = 403;
      throw error;
    }
    return (await evidenceAccess.resolve(urlPath)).filePath;
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
      'X-Content-Type-Options': 'nosniff',
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
  if (pathname === '/api/workspace/fingerprint') {
    const projectPath = body.projectPath || '.';
    const projectRoot = workspaceFs.resolveWorkspacePath(projectPath);
    const revisionBefore = workspaceWatcherKey === projectPath ? workspaceWatcherRevision : null;
    const fingerprint = await captureProjectFingerprint(projectRoot, {
      workspaceRoot,
      includedPaths: body.includedPaths,
    });
    const revisionAfter = workspaceWatcherKey === projectPath ? workspaceWatcherRevision : null;
    const evidence = await verifyWorkspaceEvidence(body.evidence);
    return sendJson(res, 200, {
      ...fingerprint,
      complete: fingerprint.complete === true && (
        revisionBefore === null || revisionAfter === null || revisionBefore === revisionAfter
      ),
      watchRevision: revisionAfter,
      evidence,
    });
  }
  if (pathname === '/api/workspace/watch') {
    return sendJson(res, 200, await watchWorkspaceProject(body.projectPath || '.'));
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
    return sendJson(res, 200, await resolveWorkspaceFile(body.path, previewAccess));
  }
  if (pathname === '/api/preview/resolveFile') {
    return sendJson(res, 200, await resolveWorkspaceFile(body.path, evidenceAccess));
  }
  if (pathname === '/api/preview/probeUrl') {
    return sendJson(res, 200, await probeUrl(body.url, {
      timeoutMs: body.timeoutMs,
      attempts: body.attempts,
      retryDelayMs: body.retryDelayMs,
    }));
  }
  if (pathname === '/api/preview/captureSnapshot') {
    const projectPath = body.projectPath || '.';
    const relativePath = snapshotRelativePath(projectPath);
    const outputPath = workspaceFs.resolveWorkspacePath(relativePath);
    const result = await capturePreviewSnapshot(body.url, {
      outputPath,
      relativePath,
      width: body.width,
      height: body.height,
      timeoutMs: body.timeoutMs,
      waitAfterLoadMs: body.waitAfterLoadMs,
    });
    const evidencePreview = await resolveWorkspaceFile(result.path, evidenceAccess);
    return sendJson(res, 200, {
      ...result,
      previewUrl: evidencePreview.url,
    });
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
    await previewRuntimeManager.stopAndWait(projectPath);
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
  if (pathname === '/api/preview/setCaptureRegion') {
    previewCaptureRegion = body && typeof body === 'object'
      ? {
          x: Number(body.x) || 0,
          y: Number(body.y) || 0,
          width: Number(body.width) || 0,
          height: Number(body.height) || 0,
          scale: Number(body.scale) || 1,
          visible: body.visible !== false,
          updatedAt: Date.now(),
        }
      : null;
    return sendJson(res, 200, { ok: true, region: previewCaptureRegion });
  }
  if (pathname === '/api/preview/getCaptureRegion') {
    return sendJson(res, 200, previewCaptureRegion || { visible: false });
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
    const url = new URL(req.url, `http://${host}:${port}`);
    const privilegedRoute = url.pathname.startsWith('/api/') || url.pathname === '/health';
    const requestTrust = bridgeSecurity.validateRequest(req, {
      requireTrustedOrigin: privilegedRoute,
    });
    if (!requestTrust.ok) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...bridgeSecurity.corsHeaders(req.headers.origin),
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    const methodTrust = bridgeSecurity.validateMethod(req.method, url.pathname);
    if (!methodTrust.ok) {
      return sendMethodNotAllowed(res, methodTrust.allow);
    }
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      await handleApi(req, res, url.pathname);
      return;
    }

    const filePath = await resolveStaticPath(url.pathname, req.headers.host);
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
  clearWorkspaceWatcher();
  previewAccess.clear();
  evidenceAccess.clear();
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
