const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { captureProjectFingerprint } = require('../lib/projectFingerprint');
const { createVerification, deriveState } = require('../renderer/proof-reentry');

const execFileAsync = promisify(execFile);

test('a real project edit takes an evidence-bound Reentry receipt from Ready to Proof stale', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-reentry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await execFileAsync('git', ['init', '-q'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'pixelbox@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Pixelbox Test'], { cwd: root });
  await fs.writeFile(path.join(root, '.gitignore'), '.pixelbox/\n.pxcode/\n');
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Before</h1>\n');
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-qm', 'initial'], { cwd: root });

  const context = {
    projectPath: '.',
    sourceType: 'html',
    command: 'Static site render',
    url: 'http://localhost:3210/__preview__/test/index.html',
  };
  const before = {
    ...await captureProjectFingerprint(root, { workspaceRoot: root, includedPaths: ['index.html'] }),
    evidenceValid: true,
  };
  const after = {
    ...await captureProjectFingerprint(root, { workspaceRoot: root, includedPaths: ['index.html'] }),
    evidenceValid: true,
  };
  const created = createVerification({
    before,
    after,
    context,
    liveCheck: { ok: true, status: 200, label: '200 OK' },
    snapshot: { path: '.pixelbox/proof.png', digest: 'sha256:snapshot' },
    evidenceValid: true,
  });
  assert.equal(created.ok, true);
  assert.equal(deriveState({
    verification: created.verification,
    currentWorkspace: after,
    currentContext: context,
  }).key, 'ready');

  await fs.writeFile(path.join(root, 'index.html'), '<h1>After</h1>\n');
  const edited = {
    ...await captureProjectFingerprint(root, { workspaceRoot: root, includedPaths: ['index.html'] }),
    evidenceValid: true,
  };
  assert.equal(deriveState({
    verification: created.verification,
    currentWorkspace: edited,
    currentContext: context,
  }).key, 'stale');
});
