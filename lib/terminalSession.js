const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const pty = require('node-pty');

function terminalType() {
  return process.env.PXCODE_TERM || 'xterm-256color';
}

class StdioTerminalSession {
  constructor({ cwd, shell, argv = [], env = process.env }) {
    this._dataHandlers = new Set();
    this._exitHandlers = new Set();
    this._closed = false;

    this.process = spawn(shell, argv, {
      cwd,
      env: { ...env, TERM: terminalType() },
      stdio: 'pipe',
    });

    this.process.stdout.on('data', (chunk) => {
      const data = chunk.toString('utf8');
      for (const handler of this._dataHandlers) handler(data);
    });

    this.process.stderr.on('data', (chunk) => {
      const data = chunk.toString('utf8');
      for (const handler of this._dataHandlers) handler(data);
    });

    this.process.on('exit', (exitCode, signal) => {
      this._closed = true;
      const payload = { exitCode, signal };
      for (const handler of this._exitHandlers) handler(payload);
    });
  }

  onData(handler) {
    this._dataHandlers.add(handler);
    return {
      dispose: () => this._dataHandlers.delete(handler),
    };
  }

  onExit(handler) {
    this._exitHandlers.add(handler);
    return {
      dispose: () => this._exitHandlers.delete(handler),
    };
  }

  write(data) {
    if (!this._closed) {
      this.process.stdin.write(data);
    }
  }

  resize() {}

  kill() {
    if (!this._closed) {
      this.process.kill();
      this._closed = true;
    }
  }
}

class PythonPtyTerminalSession extends StdioTerminalSession {
  constructor({ cwd, shell, argv = [], env = process.env }) {
    super({
      cwd,
      shell: 'python3',
      env,
      argv: [path.join(__dirname, 'pty_bridge.py'), shell, ...argv],
    });
  }
}

class TerminalSession {
  constructor({ cwd, shell, argv = [], cols = 80, rows = 24, env = process.env }) {
    this.isFallback = false;
    this.hasPseudoTTY = false;

    try {
      if (process.env.FORCE_STDIO_TERMINAL === '1') {
        throw new Error('Forced stdio terminal backend');
      }

      this.backend = pty.spawn(shell, argv, {
        name: 'xterm-color',
        cols,
        rows,
        cwd,
        env: { ...env, TERM: terminalType() },
      });
      this.isFallback = false;
      this.hasPseudoTTY = true;
    } catch {
      try {
        const pythonProbe = spawn('python3', ['--version'], { stdio: 'ignore' });
        if (!pythonProbe.pid) {
          throw new Error('python3 unavailable');
        }
        pythonProbe.kill();
        this.backend = new PythonPtyTerminalSession({
          cwd,
          shell,
          argv,
          env: {
            ...env,
            PXCODE_PTY_COLS: String(cols),
            PXCODE_PTY_ROWS: String(rows),
          },
        });
        this.isFallback = true;
        this.hasPseudoTTY = true;
      } catch {
        this.backend = new StdioTerminalSession({ cwd, shell, argv, env });
        this.isFallback = true;
        this.hasPseudoTTY = false;
      }
    }
  }

  onData(handler) {
    return this.backend.onData(handler);
  }

  onExit(handler) {
    return this.backend.onExit(handler);
  }

  write(data) {
    this.backend.write(data);
  }

  resize(cols, rows) {
    if (cols > 0 && rows > 0) {
      this.backend.resize(cols, rows);
    }
  }

  kill() {
    this.backend.kill();
  }
}

function defaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';

  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/usr/bin/bash', 'bash'].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate.startsWith('/')) return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'bash';
}

module.exports = {
  TerminalSession,
  defaultShell,
};
