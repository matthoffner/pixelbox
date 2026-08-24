const { buildAiCliDefinitions } = require('./aiCliDefinitions');

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildWatchdogPrompt(serverCommand) {
  return (
    `You are supervising this project's dev server. Run: ${serverCommand}. ` +
    'If it fails, diagnose the cause (missing dependencies, port conflicts, ' +
    'missing env vars, etc.), fix it, and retry. Once it is running, keep ' +
    'monitoring it — restart it if it crashes, diagnosing any new failure ' +
    'first. Work autonomously; only stop and ask if you are blocked on ' +
    'something only the user can provide (e.g. credentials).'
  );
}

function buildWatchdogStartupCommand({ aiCli, serverCommand }) {
  if (aiCli !== 'codex' && aiCli !== 'claude') {
    throw new Error('Dev server watchdog supports only codex and claude.');
  }

  const definitions = buildAiCliDefinitions({ codexDangerouslyBypassPermissions: true });
  const active = definitions[aiCli];
  const prompt = buildWatchdogPrompt(serverCommand);
  const quotedPrompt = shellSingleQuote(prompt);

  return `clear; if command -v ${active.binary} >/dev/null 2>&1; then ${active.command} ${quotedPrompt}; else echo "${active.missing}"; fi`;
}

module.exports = {
  buildWatchdogStartupCommand,
};
