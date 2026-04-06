const pty = require('node-pty');

async function runProbe(termValue) {
  return new Promise((resolve) => {
    const p = pty.spawn('/bin/zsh', [], {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: '/Users/matthoffner/workspace/pxcode',
      env: { ...process.env, TERM: termValue },
    });

    let out = '';
    p.onData((d) => { out += d; });

    setTimeout(() => p.write('codex\r'), 500);
    setTimeout(() => p.write('test input\r'), 5000);
    setTimeout(() => p.write('\u0003'), 9000);
    setTimeout(() => {
      const panic = out.includes('The application panicked (crashed).');
      const stdinErr = out.includes('stdin is not a terminal');
      p.kill();
      resolve({ termValue, panic, stdinErr, tail: out.split('\n').slice(-40).join('\n') });
    }, 11000);
  });
}

(async () => {
  for (const term of ['xterm-256color', 'xterm', 'vt100', 'ansi', 'screen']) {
    const res = await runProbe(term);
    console.log('TERM', res.termValue, 'PANIC', res.panic, 'STDIN_ERR', res.stdinErr);
  }
})();
