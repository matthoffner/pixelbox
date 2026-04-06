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

class PreviewRuntimeManager {
  constructor({ shell, sendStatus }) {
    this.shell = shell;
    this.sendStatus = sendStatus;
    this.processes = new Map();
  }

  syncProject(key, options = {}) {
    const sourceType = options.sourceType || 'none';
    if (sourceType !== 'server' || !options.command || options.autoStart === false) {
      this.stop(key, { keepStoppedState: sourceType === 'server' });
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

    return this.start(key, options);
  }

  start(key, options = {}) {
    const { cwd, command, url = '', sourceType = 'server' } = options;
    if (!cwd || !command) {
      throw new Error('Preview server start requires cwd and command');
    }

    this.stop(key);

    const child = spawn(this.shell, ['-lc', `exec ${command}`], {
      cwd,
      env: { ...process.env },
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
      const urls = extractUrls(text);
      if (urls.length > 0) {
        runtime.url = urls[urls.length - 1];
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
}

module.exports = {
  PreviewRuntimeManager,
  extractUrls,
};
