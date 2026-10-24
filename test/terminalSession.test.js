const test = require('node:test');
const assert = require('node:assert/strict');

const { TerminalSession } = require('../lib/terminalSession');

test('TerminalSession exposes normalized node-pty root PID and TTY identity', () => {
  const session = Object.create(TerminalSession.prototype);
  session.backend = { pid: 1234, ptsName: '/dev/ttys009' };

  assert.equal(session.rootPid, 1234);
  assert.equal(session.tty, 'ttys009');
});

test('TerminalSession exposes a fallback process root without inventing a TTY', () => {
  const session = Object.create(TerminalSession.prototype);
  session.backend = { process: { pid: 5678 } };

  assert.equal(session.rootPid, 5678);
  assert.equal(session.tty, null);
});

test('TerminalSession returns null for unavailable or invalid backend identity', () => {
  const session = Object.create(TerminalSession.prototype);
  session.backend = { pid: -1, ptsName: '??' };

  assert.equal(session.rootPid, null);
  assert.equal(session.tty, null);
});
