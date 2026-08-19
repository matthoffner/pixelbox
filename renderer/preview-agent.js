(function previewAgentFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelboxPreviewAgent = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function previewAgent() {
  function defaultConfig() {
    return {
      sourceType: 'none',
      htmlPath: '',
      serverCommand: '',
      serverUrl: '',
      autoStart: true,
      agentManaged: true,
      agentPaused: false,
    };
  }

  async function detectConfig(readFile) {
    const safeRead = async (path) => {
      try {
        return String(await readFile(path) || '');
      } catch {
        return '';
      }
    };

    const packageSource = await safeRead('package.json');
    if (packageSource) {
      try {
        const packageJson = JSON.parse(packageSource);
        const script = packageJson.scripts?.dev ? 'dev' : packageJson.scripts?.start ? 'start' : '';
        if (script) {
          return {
            ...defaultConfig(),
            sourceType: 'server',
            serverCommand: `npm run ${script}`,
            detected: true,
          };
        }
      } catch {}
    }

    for (const htmlPath of ['index.html', 'dist/index.html', 'public/index.html', 'generated/landing.html']) {
      if (await safeRead(htmlPath)) {
        return {
          ...defaultConfig(),
          sourceType: 'html',
          htmlPath,
          autoStart: false,
          detected: true,
        };
      }
    }
    return defaultConfig();
  }

  return { defaultConfig, detectConfig };
});
