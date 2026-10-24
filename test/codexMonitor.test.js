const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePsOutput } = require('../lib/codexMonitor');

function psLine(pid, command, ppid = 1) {
  return `${pid} ${ppid} 0.0 0.1 00:01 S ${command}`;
}

test('parsePsOutput ignores shell commands that only mention agent CLIs in arguments or paths', () => {
  const processes = parsePsOutput([
    psLine(
      30161,
      '/bin/zsh -c source /Users/example/.claude/shell-snapshots/snapshot-zsh.sh && echo codex'
    ),
    psLine(30162, '/bin/zsh -c "echo claude && echo gemini && echo hermes && echo openclaw"'),
    psLine(30163, 'node /tmp/build.js --output /tmp/codex'),
  ].join('\n'));

  assert.deepEqual(processes, []);
});

test('parsePsOutput recognizes direct and absolute agent CLI executables', () => {
  const processes = parsePsOutput([
    psLine(41001, 'claude --dangerously-skip-permissions'),
    psLine(41002, '/Users/example/.claude/local/claude --continue'),
    psLine(41003, '/opt/homebrew/bin/gemini --model pro'),
    psLine(41004, '/Users/example/.local/bin/hermes gateway run'),
    psLine(41005, '/usr/local/bin/openclaw tui'),
    psLine(
      41006,
      '/Users/example/.nvm/versions/node/v22/bin/node /Users/example/.nvm/versions/node/v22/bin/codex exec'
    ),
    psLine(
      41007,
      '/Users/example/.nvm/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex'
    ),
  ].join('\n'));

  assert.deepEqual(
    new Map(processes.map((processInfo) => [processInfo.pid, processInfo.cli])),
    new Map([
      [41001, 'claude'],
      [41002, 'claude'],
      [41003, 'gemini'],
      [41004, 'hermes'],
      [41005, 'openclaw'],
      [41006, 'codex'],
      [41007, 'codex'],
    ])
  );
});

test('parsePsOutput recognizes env and interpreter-wrapped CLI executables', () => {
  const processes = parsePsOutput([
    psLine(42001, '/usr/bin/env TERM=xterm-256color codex resume --last'),
    psLine(
      42002,
      '/opt/homebrew/Frameworks/Python.framework/Versions/3.11/Resources/Python.app/Contents/MacOS/Python /Users/example/.local/bin/hermes gateway run'
    ),
  ].join('\n'));

  assert.deepEqual(
    new Map(processes.map((processInfo) => [processInfo.pid, processInfo.cli])),
    new Map([
      [42001, 'codex'],
      [42002, 'hermes'],
    ])
  );
});
