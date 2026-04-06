const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const { TerminalSession, defaultShell } = require('../lib/terminalSession');
const { createWorkspaceFs } = require('../lib/workspaceFs');

const execFileAsync = promisify(execFile);
const workspaceRoot = process.cwd();
const workspaceFs = createWorkspaceFs(workspaceRoot);

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function createOutputCollector(session) {
  let output = '';
  session.onData((chunk) => {
    output += chunk;
  });
  return () => output;
}

async function waitFor(condition, timeoutMs = 120000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function tryCreateSession(t) {
  try {
    return new TerminalSession({ cwd: workspaceRoot, shell: defaultShell() });
  } catch (error) {
    t.skip(`PTY not available in this environment: ${error.message}`);
    return null;
  }
}

test('terminal session executes shell commands', async (t) => {
  const session = tryCreateSession(t);
  if (!session) return;

  const getOutput = createOutputCollector(session);

  try {
    session.write('printf "terminal-ok"\n');

    await waitFor(() => getOutput().includes('terminal-ok'), 10000);
    assert.match(getOutput(), /terminal-ok/);
  } finally {
    session.kill();
  }
});

test('python PTY bridge keeps reading child output after stdin EOF', async () => {
  const bridgePath = path.join(workspaceRoot, 'lib', 'pty_bridge.py');
  const shell = defaultShell();

  const output = await new Promise((resolve, reject) => {
    const child = spawn('python3', [bridgePath, shell, '-lc', 'printf "bridge-ok"'], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`pty bridge exited with code ${code} signal ${signal}: ${stderr}`));
    });
  });

  assert.match(output, /bridge-ok/);
});

test('terminal can run codex to generate landing page visible to editor file API', { timeout: 240000 }, async (t) => {
  if (!process.env.RUN_CODEX_E2E) {
    t.skip('Set RUN_CODEX_E2E=1 to run Codex terminal end-to-end test');
    return;
  }

  try {
    await execFileAsync('codex', ['--version']);
  } catch {
    t.skip('codex CLI is not available in PATH');
    return;
  }

  const session = tryCreateSession(t);
  if (!session) return;

  const targetRelPath = 'generated/landing.html';
  const targetAbsPath = path.join(workspaceRoot, targetRelPath);

  await fs.mkdir(path.dirname(targetAbsPath), { recursive: true });
  await fs.rm(targetAbsPath, { force: true });

  const prompt = [
    `Create a single-file marketing landing page at ${targetRelPath}.`,
    'Return no markdown fences.',
    'Write only that file and keep all assets inline (single HTML file).',
  ].join(' ');

  const command = [
    'codex exec --skip-git-repo-check --sandbox workspace-write --color never',
    `-C ${shellEscape(workspaceRoot)}`,
    shellEscape(prompt),
    '; printf "\\n__CODEX_DONE__:$?\\n"',
  ].join(' ');

  const getOutput = createOutputCollector(session);

  try {
    session.write(`${command}\n`);

    await waitFor(() => getOutput().includes('__CODEX_DONE__:0'), 220000);

    const fileFromEditorApi = await workspaceFs.readFile(targetRelPath);
    assert.ok(fileFromEditorApi.content.includes('<html') || fileFromEditorApi.content.includes('<!DOCTYPE html'));
  } finally {
    session.kill();
  }
});
