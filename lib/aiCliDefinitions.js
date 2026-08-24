function buildAiCliDefinitions({ codexDangerouslyBypassPermissions } = {}) {
  return {
    codex: {
      binary: 'codex',
      missing: 'Codex CLI not found in PATH.',
      command: codexDangerouslyBypassPermissions
        ? 'env TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox'
        : 'env TERM=xterm-256color codex resume --last || env TERM=xterm-256color codex',
    },
    claude: {
      binary: 'claude',
      missing: 'Claude CLI not found in PATH.',
      command: codexDangerouslyBypassPermissions
        ? 'env TERM=xterm-256color claude --dangerously-skip-permissions'
        : 'env TERM=xterm-256color claude --continue || env TERM=xterm-256color claude',
    },
    gemini: {
      binary: 'gemini',
      missing: 'Gemini CLI not found in PATH.',
      command: 'env TERM=xterm-256color gemini',
    },
    hermes: {
      binary: 'hermes',
      missing: 'Hermes CLI not found in PATH.',
      command: 'env TERM=xterm-256color hermes',
    },
    openclaw: {
      binary: 'openclaw',
      missing: 'OpenClaw CLI not found in PATH.',
      command: 'env TERM=xterm-256color openclaw tui',
    },
  };
}

module.exports = {
  buildAiCliDefinitions,
};
