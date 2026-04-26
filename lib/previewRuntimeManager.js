const net = require('node:net');
const { spawn } = require('node:child_process');

function stripAnsi(input) {
  if (!input) return '';
  return input
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-ntqry=><~]|(?:[^\u001B]*\u001B\\))/g, '');
}

function sanitizeUrl(rawUrl) {
  return stripAnsi(rawUrl)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/[),.;]+$/, '');
}

function extractUrls(text) {
  const cleanText = stripAnsi(text);
  const matches = cleanText.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}[^\s"'<>)\]]*/gi) || [];
  return matches.map((match) => sanitizeUrl(match)).filter(Boolean);
}

function parseLocalUrl(rawUrl) {
  const clean = sanitizeUrl(rawUrl);
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      return null;
    }
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0) {
      return null;
    }
    return {
      url: clean,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port,
      pathname: parsed.pathname || '/',
      search: parsed.search || '',
      hash: parsed.hash || '',
    };
  } catch {
    return null;
  }
}

function buildUrlWithPort(parsed, port) {
  return `${parsed.protocol}//${parsed.hostname}:${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

class PreviewRuntimeManager {
  constructor({ shell, sendStatus }) {
    this.shell = shell;
    this.sendStatus = sendStatus;
    this.processes = new Map();
  }

  async syncProject(key, options = {}) {
    const sourceType = options.sourceType || 'none';
    const shouldManageProcess = (sourceType === 'server' || sourceType === 'native') && options.command;
    if (!shouldManageProcess) {
      this.stop(key, { keepStoppedState: sourceType === 'server' || sourceType === 'native' });
      return { ok: true, running: false };
    }

    const current = this.processes.get(key);
    if (current && current.command === options.command && current.cwd === options.cwd) {
      this.#emitStatus(key, {
        running: true,
        sourceType,
        command: options.command,
        configuredUrl: options.url || '',
        url: current.url || options.url || '',
      });
      return { ok: true, running: true };
    }

    if (options.autoStart === false) {
      this.stop(key, { keepStoppedState: true });
      return { ok: true, running: false };
    }

    return this.start(key, options);
  }

  start(key, options = {}) {
    const { cwd, command, url = '', sourceType = 'server' } = options;
    if (!cwd || !command) {
      throw new Error('Preview runtime start requires cwd and command');
    }

    this.stop(key);

    const child = spawn(this.shell, ['-lc', `exec ${command}`], {
      cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: 'pipe',
    });

    const runtime = {
      child,
      cwd,
      command,
      url,
      sourceType,
    };
    this.processes.set(key, runtime);

    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      if (sourceType === 'server') {
        const urls = extractUrls(text);
        if (urls.length > 0) {
          runtime.url = urls[urls.length - 1];
        }
      }
      this.#emitStatus(key, {
        running: true,
        sourceType,
        command,
        configuredUrl: url,
        url: runtime.url || url,
      });
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (exitCode, signal) => {
      if (this.processes.get(key)?.child !== child) return;
      this.processes.delete(key);
      this.#emitStatus(key, {
        running: false,
        sourceType,
        command,
        configuredUrl: url,
        url: runtime.url || url,
        exitCode,
        signal,
      });
    });

    this.#emitStatus(key, {
      running: true,
      sourceType,
      command,
      configuredUrl: url,
      url: url || '',
    });

    return { ok: true, running: true };
  }

  async resolveLaunchOptions(key, options = {}) {
    const sourceType = options.sourceType || 'server';
    const configuredUrl = sanitizeUrl(options.url || '');
    if (sourceType !== 'server') {
      return {
        ...options,
        url: configuredUrl,
      };
    }

    const parsed = parseLocalUrl(configuredUrl);
    if (!parsed) {
      return {
        ...options,
        url: configuredUrl,
      };
    }

    const assignedPort = await this.#findAvailablePort(parsed.hostname, parsed.port);
    if (assignedPort === parsed.port) {
      return {
        ...options,
        url: configuredUrl,
      };
    }

    const assignedUrl = buildUrlWithPort(parsed, assignedPort);
    return {
      ...options,
      url: assignedUrl,
      configuredUrl,
      env: {
        ...(options.env || {}),
        PORT: String(assignedPort),
        npm_config_port: String(assignedPort),
        PIXELBOX_PORT: String(assignedPort),
      },
    };
  }

  stop(key, options = {}) {
    const runtime = this.processes.get(key);
    if (!runtime) {
      if (options.keepStoppedState) {
        this.#emitStatus(key, { running: false, sourceType: 'server' });
      }
      return;
    }

    this.processes.delete(key);
    runtime.child.kill();
    this.#emitStatus(key, {
      running: false,
      sourceType: runtime.sourceType,
      command: runtime.command,
      configuredUrl: runtime.url || '',
      url: runtime.url || '',
    });
  }

  stopAll() {
    for (const key of [...this.processes.keys()]) {
      this.stop(key);
    }
  }

  #emitStatus(key, payload) {
    this.sendStatus({ key, ...payload });
  }

  async #isUrlReachable(url) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(1500),
      });
      return response.status < 500;
    } catch {
      return false;
    }
  }

  async #findAvailablePort(hostname, preferredPort) {
    let port = preferredPort;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // If the port is free, keep the configured value. Otherwise move upward.
      // This avoids binding one project to another project's already-live preview URL.
      // Many dev servers respect PORT automatically once Pixelbox injects it.
      // The resolved URL is sent back to the renderer and persisted there.
      // That keeps Running Page in sync with the actual launched port.
      const inUse = await this.#isPortInUse(hostname, port);
      if (!inUse) {
        return port;
      }
      port += 1;
    }
    return preferredPort;
  }

  async #isPortInUse(hostname, port) {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: hostname === 'localhost' ? '127.0.0.1' : hostname,
        port,
      });
      const finish = (value) => {
        socket.removeAllListeners();
        try {
          socket.destroy();
        } catch {}
        resolve(value);
      };
      socket.setTimeout(350, () => finish(true));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
  }
}

module.exports = {
  PreviewRuntimeManager,
  extractUrls,
};
