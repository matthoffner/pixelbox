const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');

test('landing leads with the durable Pixelbox identity and subordinates Reentry', async () => {
  const html = await readFile('landing/index.html', 'utf8');
  const changelog = JSON.parse(await readFile('landing/changelog.json', 'utf8'));

  const identity = 'Go from idea to running software in one workspace.';
  const currentRelease = 'Current initiative · Released';

  assert.match(html, /Pixelbox is a native local AI software workspace/);
  assert.match(html, /Ask, edit, run, preview, debug, and iterate/);
  assert.ok(html.indexOf(identity) < html.indexOf(currentRelease));
  assert.match(html, /Current release: automatic previews plus proof-bound Reentry/);
  assert.match(html, /Runtime visibility/);
  assert.match(html, /Continuity/);
  assert.equal(
    changelog.entries[0]?.title,
    'Kept the Pixelbox identity ahead of the current release',
  );
});
