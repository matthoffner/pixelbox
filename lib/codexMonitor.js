const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CODEX_HOME = path.join(os.homedir(), '.codex');
const SUMMARY_MODEL = process.env.CODEX_MONITOR_MODEL || 'gpt-5.3-codex';
const PREVIEW_TURNS = 6;
const DETAILS_CACHE_TTL_MS = 30_000;
const detailsCache = new Map();

function singleLine(value, maxLength = 140) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

const CLI_PATTERNS = {
  codex: /\bcodex\b/,
  claude: /\bclaude\b/,
  gemini: /\bgemini\b/,
  hermes: /\bhermes\b/,
  openclaw: /\bopenclaw\b/,
};

function isAgentCommand(command) {
  if (/ps -axo|egrep \(|codex-monitor/i.test(command)) return false;
  if (/pty_bridge\.py/.test(command)) return false;
  return Object.values(CLI_PATTERNS).some((pattern) => pattern.test(command));
}

function detectCli(command) {
  for (const [cli, pattern] of Object.entries(CLI_PATTERNS)) {
    if (pattern.test(command)) return cli;
  }
  return 'unknown';
}

function classifyAgentKind(command, cli) {
  if (cli !== 'codex') {
    if (/resume\b|--continue\b|tui\b/.test(command)) return 'ui';
    if (/exec\b/.test(command)) return 'exec';
    return 'agent';
  }
  if (/vendor\/aarch64-apple-darwin\/codex\/codex|codex-aarch64-apple-darwin/.test(command)) {
    return 'engine';
  }
  if (/codex exec\b/.test(command)) return 'exec';
  if (/pocket-server/.test(command)) return 'background';
  if (/resume\b|codex$|bin\/codex\b/.test(command)) return 'ui';
  return 'unknown';
}

function parsePsOutput(raw) {
  const lines = raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const out = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, ppid, cpu, mem, elapsed, state, command] = match;
    if (!isAgentCommand(command)) continue;
    const cli = detectCli(command);
    out.push({
      pid: Number(pid),
      ppid: Number(ppid),
      cpu: Number(cpu),
      mem: Number(mem),
      elapsed,
      state,
      command,
      engine: cli,
      cli,
      kind: classifyAgentKind(command, cli),
    });
  }

  return condenseProcesses(out);
}

function condenseProcesses(processes) {
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const hidden = new Set();

  for (const processInfo of processes) {
    const parent = byPid.get(processInfo.ppid);
    if (!parent) continue;
    const childIsPreferred = processInfo.kind === 'engine' || processInfo.kind === 'exec';
    const parentIsShell = parent.kind === 'ui' || parent.kind === 'background';
    if (childIsPreferred && parentIsShell) hidden.add(parent.pid);
  }

  return processes
    .filter((item) => !hidden.has(item.pid))
    .sort((a, b) => {
      const activeA = a.kind === 'ui' || a.kind === 'exec' || a.kind === 'engine' ? 0 : 1;
      const activeB = b.kind === 'ui' || b.kind === 'exec' || b.kind === 'engine' ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      return b.pid - a.pid;
    });
}

function safeExecFile(file, args) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function extractContentText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (item && (item.type === 'input_text' || item.type === 'output_text')) {
        return String(item.text || '');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function dedupeMessages(messages) {
  const out = [];
  for (const message of messages) {
    const last = out[out.length - 1];
    if (last && last.role === message.role && last.text === message.text) continue;
    out.push(message);
  }
  return out;
}

function parseCodexTranscript(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const messages = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry && entry.type === 'response_item' && entry.payload && entry.payload.type === 'message') {
      const role = entry.payload.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractContentText(entry.payload.content);
      if (!text) continue;
      messages.push({ role, text, timestamp: entry.timestamp });
    }
  }

  return dedupeMessages(messages);
}

function filterProcesses(processes, filters = {}) {
  const { cli, cwdPrefix } = filters || {};
  let filtered = processes;

  if (cli && cli !== 'custom') {
    filtered = filtered.filter((item) => item.cli === cli);
  }

  if (cwdPrefix) {
    filtered = filtered.filter((item) => {
      const details = getProcessDetails(item);
      return details.cwd === cwdPrefix || details.cwd?.startsWith(`${cwdPrefix}${path.sep}`);
    });
  }

  return filtered;
}

function getProcesses(filters = {}) {
  const raw = execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,%mem=,etime=,state=,command='], {
    encoding: 'utf8',
  });
  return filterProcesses(parsePsOutput(raw), filters);
}

function getProcessDetails(processInfo) {
  const cacheKey = Number(processInfo.pid);
  const cached = detailsCache.get(cacheKey);
  if (
    cached &&
    cached.command === processInfo.command &&
    Date.now() - cached.cachedAt < DETAILS_CACHE_TTL_MS
  ) {
    return { ...cached.details };
  }

  const details = {};
  try {
    const cwdRaw = safeExecFile('lsof', ['-a', '-p', String(processInfo.pid), '-d', 'cwd', '-Fn']);
    const cwdLine = cwdRaw.split('\n').find((line) => line.startsWith('n'));
    if (cwdLine) details.cwd = cwdLine.slice(1);
  } catch {}

  try {
    const openFiles = safeExecFile('lsof', ['-p', String(processInfo.pid), '-Fn']);
    const transcriptLine = openFiles
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('n') && line.includes(`${CODEX_HOME}/sessions/`) && line.endsWith('.jsonl'));

    if (transcriptLine) {
      const transcriptPath = transcriptLine.slice(1);
      const transcript = parseCodexTranscript(transcriptPath);
      details.transcriptPath = transcriptPath;
      details.transcriptTurns = transcript.length;
      details.transcriptPreview = transcript.slice(-PREVIEW_TURNS).map((item) => {
        const label = item.role === 'user' ? 'USER' : 'CODEX';
        return `${label}: ${singleLine(item.text, 160)}`;
      });
      details.transcriptSummary = singleLine(
        transcript
          .slice(-4)
          .map((item) => `${item.role}: ${item.text}`)
          .join(' '),
        260
      );
      details.transcriptUpdatedAt = new Date(fs.statSync(transcriptPath).mtimeMs).toISOString();
    }
  } catch (error) {
    details.error = error instanceof Error ? error.message : String(error);
  }

  detailsCache.set(cacheKey, {
    command: processInfo.command,
    cachedAt: Date.now(),
    details: { ...details },
  });
  return details;
}

function buildSummaryPrompt(processInfo, details, instruction) {
  const transcript = details.transcriptPath ? parseCodexTranscript(details.transcriptPath) : [];
  const recent = transcript
    .slice(-20)
    .map((item) => `[${item.role}] ${item.text}`)
    .join('\n\n');

  return [
    'You are summarizing an active Codex coding conversation for a human operator.',
    '',
    'Return a concise, high-signal answer with these headings exactly:',
    'Summary',
    'Current Work',
    'Open Risks',
    'Next Steps',
    '',
    'Keep it grounded in the transcript only. If something is unclear, say so plainly.',
    '',
    `Instruction: ${instruction}`,
    `PID: ${processInfo.pid}`,
    `Command: ${processInfo.command}`,
    `CWD: ${details.cwd || 'unknown'}`,
    `Transcript: ${details.transcriptPath || 'unknown'}`,
    '',
    'Recent conversation:',
    recent || '(no transcript text found)',
  ].join('\n');
}

async function runSummary(processInfo, details, instruction) {
  if (!details.transcriptPath || !fs.existsSync(details.transcriptPath)) {
    throw new Error('No Codex transcript is attached to the selected process.');
  }

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelbox-codex-monitor-'));
  const outputPath = path.join(scratchDir, 'last-message.txt');
  const prompt = buildSummaryPrompt(processInfo, details, instruction);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        'codex',
        [
          'exec',
          '--skip-git-repo-check',
          '--dangerously-bypass-approvals-and-sandbox',
          '--model',
          SUMMARY_MODEL,
          '--output-last-message',
          outputPath,
          '-',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: details.cwd || process.cwd(),
          env: process.env,
        }
      );

      let stderr = '';
      child.stdin.write(prompt);
      child.stdin.end();
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `codex exec exited with code ${code}`));
      });
    });

    return fs.readFileSync(outputPath, 'utf8').trim();
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

function stopProcess(pid, signal = 'SIGTERM') {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    throw new Error('A valid pid is required.');
  }
  detailsCache.delete(numericPid);
  process.kill(numericPid, signal);
  return { ok: true, pid: numericPid, signal };
}

module.exports = {
  getProcesses,
  getProcessDetails,
  runSummary,
  stopProcess,
  singleLine,
};
