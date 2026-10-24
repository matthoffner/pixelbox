const { execFileSync } = require('node:child_process');

function normalizeProcessId(value) {
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function normalizeTerminalTty(value) {
  if (typeof value !== 'string') return null;
  const tty = value.trim();
  if (!tty || tty === '?' || tty === '??' || tty === '-') return null;
  return tty.startsWith('/dev/') ? tty.slice('/dev/'.length) : tty;
}

function parseProcessTable(raw) {
  const processes = [];
  for (const line of String(raw || '').split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/);
    if (!match) continue;
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      tty: normalizeTerminalTty(match[4]),
    });
  }
  return processes;
}

function readProcessTable() {
  const raw = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,tty='], {
    encoding: 'utf8',
  });
  return parseProcessTable(raw);
}

function normalizeSession(session) {
  if (!session || !Object.prototype.hasOwnProperty.call(session, 'key')) return null;
  return {
    key: session.key,
    rootPid: normalizeProcessId(session.rootPid),
    tty: normalizeTerminalTty(session.tty),
  };
}

function processSnapshot(pid, processByPid) {
  const processInfo = processByPid.get(pid);
  if (!processInfo) {
    return {
      pid,
      ppid: null,
      pgid: null,
      tty: null,
      ancestors: [],
      target: null,
    };
  }

  const ancestors = [];
  const seen = new Set();
  let current = processInfo;
  while (current && !seen.has(current.pid)) {
    ancestors.push(current.pid);
    seen.add(current.pid);
    current = processByPid.get(current.ppid);
  }

  return {
    pid: processInfo.pid,
    ppid: processInfo.ppid,
    pgid: processInfo.pgid,
    tty: processInfo.tty,
    ancestors,
    target: null,
  };
}

function targetForSession(session) {
  return {
    owner: 'bridge',
    key: session.key,
    kind: typeof session.key === 'string' && session.key.startsWith('watchdog:')
      ? 'watchdog'
      : 'project',
  };
}

function resolveTerminalFromProcessTable(pid, sessions = [], processes = []) {
  const numericPid = normalizeProcessId(pid);
  if (!numericPid) {
    return {
      pid: null,
      ppid: null,
      pgid: null,
      tty: null,
      ancestors: [],
      target: null,
    };
  }

  const processByPid = new Map();
  for (const processInfo of processes) {
    const processPid = normalizeProcessId(processInfo?.pid);
    if (!processPid) continue;
    processByPid.set(processPid, {
      pid: processPid,
      ppid: Number.isSafeInteger(Number(processInfo.ppid)) && Number(processInfo.ppid) >= 0
        ? Number(processInfo.ppid)
        : 0,
      pgid: normalizeProcessId(processInfo.pgid),
      tty: normalizeTerminalTty(processInfo.tty),
    });
  }

  const snapshot = processSnapshot(numericPid, processByPid);
  if (snapshot.ancestors.length === 0) return snapshot;

  const inventory = sessions.map(normalizeSession).filter(Boolean);
  const ancestorPids = new Set(snapshot.ancestors);
  const ancestryMatches = inventory.filter((session) => session.rootPid && ancestorPids.has(session.rootPid));
  const ttyMatches = snapshot.tty
    ? inventory.filter((session) => session.tty === snapshot.tty)
    : [];

  if (ancestryMatches.length > 1 || ttyMatches.length > 1) return snapshot;
  if (ancestryMatches.length === 1) {
    const ancestryMatch = ancestryMatches[0];
    if (ttyMatches.length === 1 && ttyMatches[0] !== ancestryMatch) return snapshot;
    snapshot.target = targetForSession(ancestryMatch);
    return snapshot;
  }
  if (ttyMatches.length === 1) {
    snapshot.target = targetForSession(ttyMatches[0]);
  }
  return snapshot;
}

function resolveTerminalForPid(pid, sessions = []) {
  let processes = [];
  try {
    processes = readProcessTable();
  } catch {}
  return resolveTerminalFromProcessTable(pid, sessions, processes);
}

module.exports = {
  normalizeProcessId,
  normalizeTerminalTty,
  parseProcessTable,
  readProcessTable,
  resolveTerminalForPid,
  resolveTerminalFromProcessTable,
};
