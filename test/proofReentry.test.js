const test = require('node:test');
const assert = require('node:assert/strict');

const {
  contextsMatch,
  createVerification,
  deriveState,
  normalizeVerification,
} = require('../renderer/proof-reentry');

function workspace(fingerprint = 'sha256:aaaaaaaa') {
  return {
    complete: true,
    version: 1,
    method: 'git-worktree',
    scope: 'test',
    fingerprint,
    changedFiles: ['app.js'],
    changedFileCount: 1,
    fileCount: 2,
    evidenceValid: true,
  };
}

function context(overrides = {}) {
  return {
    projectPath: 'projects/demo',
    sourceType: 'server',
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173/',
    ...overrides,
  };
}

function successfulVerification(overrides = {}) {
  const before = workspace();
  const after = workspace();
  return createVerification({
    before,
    after,
    context: context(),
    liveCheck: { ok: true, status: 200, label: '200 OK' },
    snapshot: { path: '.pixelbox/proof.png', digest: 'sha256:snapshot', width: 1280, height: 720 },
    evidenceValid: true,
    ...overrides,
  });
}

test('Reentry is Ready only for matching successful evidence and context', () => {
  const result = successfulVerification();
  assert.equal(result.ok, true);
  assert.equal(deriveState({
    verification: result.verification,
    currentWorkspace: workspace(),
    currentContext: context(),
  }).key, 'ready');
});

test('A selected-project edit or runtime-context change makes proof stale', () => {
  const verification = successfulVerification().verification;
  assert.equal(deriveState({
    verification,
    currentWorkspace: workspace('sha256:bbbbbbbb'),
    currentContext: context(),
  }).key, 'stale');
  assert.equal(deriveState({
    verification,
    currentWorkspace: workspace(),
    currentContext: context({ command: 'npm run preview' }),
  }).key, 'stale');
});

test('Verify fails closed when files mutate or evidence is incomplete', () => {
  assert.deepEqual(createVerification({
    before: workspace('sha256:before'),
    after: workspace('sha256:after'),
    context: context(),
    liveCheck: { ok: true, status: 200 },
    snapshot: { path: '.pixelbox/proof.png', digest: 'sha256:snapshot' },
    evidenceValid: true,
  }), { ok: false, reason: 'workspace_changed_during_verify' });
  assert.equal(successfulVerification({ liveCheck: { ok: false, status: 500 } }).ok, false);
  assert.equal(successfulVerification({ snapshot: null }).ok, false);
});

test('Legacy or malformed verification records never become Ready', () => {
  assert.equal(normalizeVerification({ liveCheck: { ok: true } }), null);
  assert.equal(deriveState({
    verification: { schemaVersion: 1 },
    currentWorkspace: workspace(),
    currentContext: context(),
  }).key, 'building');
  assert.equal(deriveState({ verifying: true }).key, 'proving');
  assert.equal(deriveState({ blocked: true }).key, 'blocked');
  assert.equal(deriveState({ needsAttention: true }).key, 'needs-you');
});

test('A later runtime or Live Check failure overrides otherwise current proof', () => {
  const verification = successfulVerification().verification;
  assert.equal(deriveState({
    verification,
    currentWorkspace: workspace(),
    currentContext: context(),
    blocked: true,
  }).key, 'blocked');
});

test('Ready requires a live runtime surface and an intact snapshot', () => {
  const verification = successfulVerification().verification;
  assert.equal(deriveState({
    verification,
    currentWorkspace: workspace(),
    currentContext: context(),
    readyEligible: false,
  }).key, 'building');
  assert.equal(deriveState({
    verification,
    currentWorkspace: { ...workspace(), evidenceValid: false },
    currentContext: context(),
  }).key, 'stale');
});

test('static preview context can remain stable when its capability URL rotates', () => {
  assert.equal(contextsMatch(
    { projectPath: '.', sourceType: 'html', command: 'Static site render', url: 'static:index.html' },
    { projectPath: '.', sourceType: 'html', command: 'Static site render', url: 'static:index.html' },
  ), true);
});
