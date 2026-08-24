const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWatchdogStartupCommand } = require('../lib/devServerWatchdog');

test('buildWatchdogStartupCommand builds a claude launch command with the brief embedded', () => {
  const result = buildWatchdogStartupCommand({ aiCli: 'claude', serverCommand: 'npm run dev' });
  assert.match(result, /^clear; if command -v claude >\/dev\/null 2>&1; then env TERM=xterm-256color claude --dangerously-skip-permissions '/);
  assert.match(result, /npm run dev/);
  assert.match(result, /else echo "Claude CLI not found in PATH\."; fi$/);
});

test('buildWatchdogStartupCommand builds a codex launch command with the brief embedded', () => {
  const result = buildWatchdogStartupCommand({ aiCli: 'codex', serverCommand: 'npm run dev' });
  assert.match(result, /^clear; if command -v codex >\/dev\/null 2>&1; then env TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox '/);
  assert.match(result, /npm run dev/);
  assert.match(result, /else echo "Codex CLI not found in PATH\."; fi$/);
});

test('buildWatchdogStartupCommand single-quote-escapes a server command containing a single quote', () => {
  const result = buildWatchdogStartupCommand({ aiCli: 'claude', serverCommand: "npm run dev -- --name 'x'" });
  // The brief is wrapped in single quotes; any single quote inside the
  // interpolated serverCommand must be escaped as '\'' so the shell sees
  // one continuous argument.
  assert.ok(result.includes(`--name '\\''x'\\''`));
});

test('buildWatchdogStartupCommand rejects unsupported CLIs', () => {
  assert.throws(() => buildWatchdogStartupCommand({ aiCli: 'gemini', serverCommand: 'npm run dev' }), /only codex and claude/i);
  assert.throws(() => buildWatchdogStartupCommand({ aiCli: 'custom', serverCommand: 'npm run dev' }), /only codex and claude/i);
});
