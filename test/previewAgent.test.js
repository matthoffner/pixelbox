const test = require('node:test');
const assert = require('node:assert/strict');
const { detectConfig } = require('../renderer/preview-agent');

function reader(files) {
  return async (path) => {
    if (!(path in files)) throw new Error('missing');
    return files[path];
  };
}

test('Preview Agent prefers an npm dev script and manages it automatically', async () => {
  const config = await detectConfig(reader({
    'package.json': JSON.stringify({ scripts: { dev: 'vite', start: 'node server.js' } }),
    'index.html': '<h1>fallback</h1>',
  }));
  assert.equal(config.sourceType, 'server');
  assert.equal(config.serverCommand, 'npm run dev');
  assert.equal(config.agentManaged, true);
  assert.equal(config.autoStart, true);
});

test('Preview Agent falls back to npm start', async () => {
  const config = await detectConfig(reader({
    'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }),
  }));
  assert.equal(config.sourceType, 'server');
  assert.equal(config.serverCommand, 'npm run start');
});

test('Preview Agent renders a static entry when no server script exists', async () => {
  const config = await detectConfig(reader({ 'dist/index.html': '<h1>Built</h1>' }));
  assert.equal(config.sourceType, 'html');
  assert.equal(config.htmlPath, 'dist/index.html');
  assert.equal(config.autoStart, false);
});

test('Preview Agent stays idle when no preview can be detected', async () => {
  const config = await detectConfig(reader({ 'package.json': '{not json' }));
  assert.equal(config.sourceType, 'none');
  assert.equal(config.agentManaged, true);
});
