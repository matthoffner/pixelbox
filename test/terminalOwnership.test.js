const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTerminalTty,
  parseProcessTable,
  resolveTerminalFromProcessTable,
} = require('../lib/terminalOwnership');

function processInfo(pid, ppid, options = {}) {
  return {
    pid,
    ppid,
    pgid: options.pgid ?? pid,
    tty: options.tty ?? null,
  };
}

test('resolveTerminalFromProcessTable resolves a direct session root', () => {
  const result = resolveTerminalFromProcessTable(
    100,
    [{ key: 'project-a', rootPid: 100, tty: '/dev/ttys001' }],
    [processInfo(100, 10, { pgid: 100, tty: 'ttys001' }), processInfo(10, 1)]
  );

  assert.deepEqual(result, {
    pid: 100,
    ppid: 10,
    pgid: 100,
    tty: 'ttys001',
    ancestors: [100, 10],
    target: { owner: 'bridge', key: 'project-a', kind: 'project' },
  });
});

test('resolveTerminalFromProcessTable walks through a PTY wrapper process', () => {
  const result = resolveTerminalFromProcessTable(
    302,
    [{ key: 'project-a', rootPid: 300, tty: null }],
    [processInfo(302, 301), processInfo(301, 300), processInfo(300, 10), processInfo(10, 1)]
  );

  assert.deepEqual(result.ancestors, [302, 301, 300, 10]);
  assert.deepEqual(result.target, { owner: 'bridge', key: 'project-a', kind: 'project' });
});

test('resolveTerminalFromProcessTable preserves an exact watchdog session key', () => {
  const result = resolveTerminalFromProcessTable(
    402,
    [
      { key: 'projects/demo', rootPid: 200, tty: 'ttys020' },
      { key: 'watchdog:projects/demo', rootPid: 400, tty: '/dev/ttys035' },
    ],
    [
      processInfo(402, 401, { tty: 'ttys035' }),
      processInfo(401, 400, { tty: 'ttys035' }),
      processInfo(400, 10),
      processInfo(10, 1),
    ]
  );

  assert.deepEqual(result.target, {
    owner: 'bridge',
    key: 'watchdog:projects/demo',
    kind: 'watchdog',
  });
});

test('resolveTerminalFromProcessTable leaves an external process unowned', () => {
  const result = resolveTerminalFromProcessTable(
    502,
    [{ key: 'project-a', rootPid: 100, tty: 'ttys001' }],
    [processInfo(502, 501, { tty: 'ttys099' }), processInfo(501, 1)]
  );

  assert.deepEqual(result.target, null);
  assert.deepEqual(result.ancestors, [502, 501]);
});

test('resolveTerminalFromProcessTable returns no target for ambiguous ancestry', () => {
  const result = resolveTerminalFromProcessTable(
    602,
    [
      { key: 'project-a', rootPid: 600, tty: null },
      { key: 'watchdog:project-a', rootPid: 601, tty: null },
    ],
    [processInfo(602, 601), processInfo(601, 600), processInfo(600, 1)]
  );

  assert.equal(result.target, null);
});

test('resolveTerminalFromProcessTable uses a unique normalized TTY when ancestry is unavailable', () => {
  const result = resolveTerminalFromProcessTable(
    702,
    [{ key: 'project-a', rootPid: 900, tty: 'pts/7' }],
    [processInfo(702, 701, { tty: '/dev/pts/7' }), processInfo(701, 1)]
  );

  assert.deepEqual(result.target, { owner: 'bridge', key: 'project-a', kind: 'project' });
  assert.equal(normalizeTerminalTty('??'), null);
});

test('resolveTerminalFromProcessTable rejects conflicting ancestry and TTY ownership', () => {
  const result = resolveTerminalFromProcessTable(
    802,
    [
      { key: 'project-a', rootPid: 800, tty: 'ttys001' },
      { key: 'project-b', rootPid: 900, tty: 'ttys002' },
    ],
    [processInfo(802, 800, { tty: 'ttys002' }), processInfo(800, 1)]
  );

  assert.equal(result.target, null);
});

test('parseProcessTable captures the resolver process fields and normalizes TTY names', () => {
  const result = parseProcessTable([
    '  13614 13611 13614 ttys035',
    '  13611 73762 73446 ??',
  ].join('\n'));

  assert.deepEqual(result, [
    { pid: 13614, ppid: 13611, pgid: 13614, tty: 'ttys035' },
    { pid: 13611, ppid: 73762, pgid: 73446, tty: null },
  ]);
});
