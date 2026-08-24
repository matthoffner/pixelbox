const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAiCliDefinitions } = require('../lib/aiCliDefinitions');

test('buildAiCliDefinitions returns entries for all five CLIs', () => {
  const definitions = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: false });
  assert.deepEqual(Object.keys(definitions).sort(), ['claude', 'codex', 'gemini', 'hermes', 'openclaw']);
});

test('codex/claude commands switch on codexDangerouslyBypassPermissions', () => {
  const safe = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: false });
  assert.equal(safe.codex.command, 'env TERM=xterm-256color codex resume --last || env TERM=xterm-256color codex');
  assert.equal(safe.claude.command, 'env TERM=xterm-256color claude --continue || env TERM=xterm-256color claude');

  const bypass = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: true });
  assert.equal(bypass.codex.command, 'env TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox');
  assert.equal(bypass.claude.command, 'env TERM=xterm-256color claude --dangerously-skip-permissions');
});

test('gemini/hermes/openclaw commands are fixed regardless of the bypass flag', () => {
  const definitions = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: true });
  assert.equal(definitions.gemini.command, 'env TERM=xterm-256color gemini');
  assert.equal(definitions.hermes.command, 'env TERM=xterm-256color hermes');
  assert.equal(definitions.openclaw.command, 'env TERM=xterm-256color openclaw tui');
  assert.equal(definitions.gemini.missing, 'Gemini CLI not found in PATH.');
});
