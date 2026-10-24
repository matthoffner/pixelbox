const test = require('node:test');
const assert = require('node:assert/strict');

const { TerminalManager } = require('../lib/terminalManager');

function createFakeSession(label, identity = {}) {
  let dataHandler = () => {};
  let exitHandler = () => {};

  return {
    label,
    rootPid: identity.rootPid ?? null,
    tty: identity.tty ?? null,
    hasPseudoTTY: label === 'new',
    killed: false,
    onData(handler) {
      dataHandler = handler;
      return { dispose() {} };
    },
    onExit(handler) {
      exitHandler = handler;
      return { dispose() {} };
    },
    writeCalls: [],
    resizeCalls: [],
    write(data) {
      this.writeCalls.push(data);
    },
    resize(cols, rows) {
      this.resizeCalls.push([cols, rows]);
    },
    kill() {
      this.killed = true;
    },
    emitData(data) {
      dataHandler(data);
    },
    emitExit() {
      exitHandler();
    },
  };
}

test('restart ignores stale exit and keeps the new session interactive', () => {
  const sessions = [];
  const sentData = [];
  let exitCount = 0;
  const manager = new TerminalManager({
    createSession() {
      const session = createFakeSession(sessions.length === 0 ? 'old' : 'new');
      sessions.push(session);
      return session;
    },
    sendData(data) {
      sentData.push(data);
    },
    sendExit() {
      exitCount += 1;
    },
  });

  const first = manager.start('project-a', {});
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.hasPseudoTTY, false);

  const second = manager.restart('project-a', {});
  assert.equal(second.ok, true);
  assert.equal(second.created, true);
  assert.equal(second.hasPseudoTTY, true);
  assert.equal(sessions[0].killed, true);

  sessions[0].emitData('stale-data');
  sessions[0].emitExit();
  assert.deepEqual(sentData, []);
  assert.equal(exitCount, 0);

  manager.write('pwd\n');
  manager.resize(120, 40);
  assert.deepEqual(sessions[1].writeCalls, ['pwd\n']);
  assert.deepEqual(sessions[1].resizeCalls, [[120, 40]]);

  sessions[1].emitData('fresh-data');
  sessions[1].emitExit();
  assert.deepEqual(sentData, [{ key: 'project-a', data: 'fresh-data' }]);
  assert.equal(exitCount, 1);
  assert.equal(manager.sessions.size, 0);
  assert.equal(manager.activeKey, null);
});

test('start reuses an existing session for the same project without affecting others', () => {
  const sessions = [];
  const exits = [];
  const manager = new TerminalManager({
    createSession(options) {
      const session = createFakeSession(`session-${sessions.length}-${options.cwd}`);
      sessions.push(session);
      return session;
    },
    sendData() {},
    sendExit(payload) {
      exits.push(payload);
    },
  });

  const firstA = manager.start('project-a', { cwd: 'project-a' });
  const firstB = manager.start('project-b', { cwd: 'project-b' });
  const secondA = manager.start('project-a', { cwd: 'project-a' });

  assert.equal(firstA.created, true);
  assert.equal(firstB.created, true);
  assert.equal(secondA.created, false);
  assert.equal(sessions.length, 2);
  assert.equal(manager.activeKey, 'project-a');

  manager.write('ls\n');
  assert.deepEqual(sessions[0].writeCalls, ['ls\n']);
  assert.deepEqual(sessions[1].writeCalls, []);

  manager.kill('project-b');
  assert.equal(sessions[1].killed, true);
  assert.equal(manager.sessions.has('project-b'), false);

  sessions[0].emitExit();
  assert.deepEqual(exits, [{ key: 'project-a' }]);
});

test('listSessions returns safe identity snapshots without exposing sessions', () => {
  const sessions = [];
  const manager = new TerminalManager({
    createSession(options) {
      const session = createFakeSession(options.label, options.identity);
      sessions.push(session);
      return session;
    },
    sendData() {},
    sendExit() {},
  });

  manager.start('project-a', {
    label: 'project',
    identity: { rootPid: 1234, tty: '/dev/ttys007' },
  });
  manager.start('watchdog:project-a', {
    label: 'watchdog',
    identity: { rootPid: 'invalid', tty: '??' },
  });

  const inventory = manager.listSessions();
  assert.deepEqual(inventory, [
    { key: 'project-a', rootPid: 1234, tty: 'ttys007' },
    { key: 'watchdog:project-a', rootPid: null, tty: null },
  ]);
  assert.notEqual(inventory[0], sessions[0]);

  inventory[0].rootPid = 9999;
  assert.equal(manager.listSessions()[0].rootPid, 1234);
});
