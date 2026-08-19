const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { captureProjectFingerprint } = require('../lib/projectFingerprint');

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd });
}

async function createGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-fingerprint-'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'pixelbox@example.test']);
  await git(root, ['config', 'user.name', 'Pixelbox Test']);
  await fs.writeFile(path.join(root, '.gitignore'), [
    'projects/',
    '.pxcode/',
    '.pixelbox/',
    'node_modules/',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'app.txt'), 'alpha\n');
  await git(root, ['add', '.gitignore', 'app.txt']);
  await git(root, ['commit', '-qm', 'initial']);
  return root;
}

test('Git fingerprint changes for repeated edits even when status and length stay the same', async (t) => {
  const root = await createGitWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const clean = await captureProjectFingerprint(root, { workspaceRoot: root });
  await fs.writeFile(path.join(root, 'app.txt'), 'bravo\n');
  const firstEdit = await captureProjectFingerprint(root, { workspaceRoot: root });
  await fs.writeFile(path.join(root, 'app.txt'), 'cider\n');
  const secondEdit = await captureProjectFingerprint(root, { workspaceRoot: root });

  assert.equal(clean.method, 'git-worktree');
  assert.notEqual(firstEdit.fingerprint, clean.fingerprint);
  assert.notEqual(secondEdit.fingerprint, firstEdit.fingerprint);
  assert.deepEqual(secondEdit.changedFiles, ['app.txt']);
});

test('Pixelbox proof state and sibling projects do not stale the workspace-root proof', async (t) => {
  const root = await createGitWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await captureProjectFingerprint(root, { workspaceRoot: root });

  await fs.mkdir(path.join(root, '.pxcode'), { recursive: true });
  await fs.mkdir(path.join(root, '.pixelbox', 'proof-packs'), { recursive: true });
  await fs.mkdir(path.join(root, 'projects', 'sibling'), { recursive: true });
  await fs.writeFile(path.join(root, '.pxcode', 'preview.json'), '{"updated":true}\n');
  await fs.writeFile(path.join(root, '.pixelbox', 'proof-packs', 'proof.md'), '# proof\n');
  await fs.writeFile(path.join(root, 'projects', 'sibling', 'app.js'), 'changed\n');

  const after = await captureProjectFingerprint(root, { workspaceRoot: root });
  assert.equal(after.fingerprint, before.fingerprint);

  await git(root, ['add', '-f', 'projects/sibling/app.js']);
  await git(root, ['commit', '-qm', 'commit excluded sibling']);
  const afterSiblingCommit = await captureProjectFingerprint(root, { workspaceRoot: root });
  assert.equal(afterSiblingCommit.fingerprint, before.fingerprint);
});

test('Ignored Pixelbox child projects use a scoped filesystem fingerprint', async (t) => {
  const root = await createGitWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', 'demo');
  const sibling = path.join(root, 'projects', 'other');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(sibling, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), '<h1>One</h1>\n');
  await fs.writeFile(path.join(sibling, 'index.html'), '<h1>Other</h1>\n');

  const before = await captureProjectFingerprint(project, { workspaceRoot: root });
  await fs.writeFile(path.join(sibling, 'index.html'), '<h1>Changed sibling</h1>\n');
  const siblingEdit = await captureProjectFingerprint(project, { workspaceRoot: root });
  await fs.writeFile(path.join(project, 'index.html'), '<h1>Two</h1>\n');
  const projectEdit = await captureProjectFingerprint(project, { workspaceRoot: root });
  await fs.mkdir(path.join(project, '.pixelbox'), { recursive: true });
  await fs.writeFile(path.join(project, '.pixelbox', 'handoff.md'), 'control state\n');
  const controlEdit = await captureProjectFingerprint(project, { workspaceRoot: root });

  assert.equal(before.method, 'filesystem-tree');
  assert.equal(siblingEdit.fingerprint, before.fingerprint);
  assert.notEqual(projectEdit.fingerprint, before.fingerprint);
  assert.equal(controlEdit.fingerprint, projectEdit.fingerprint);
});

test('A project-root symlink cannot escape the configured workspace', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-workspace-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-outside-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(outside, 'secret.txt'), 'outside\n');
  const link = path.join(root, 'linked-project');
  await fs.symlink(outside, link, 'dir');

  await assert.rejects(
    captureProjectFingerprint(link, { workspaceRoot: root }),
    /outside the workspace/
  );
});

test('An explicitly included ignored static preview artifact participates in Git fingerprints', async (t) => {
  const root = await createGitWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.appendFile(path.join(root, '.gitignore'), 'dist/\n');
  await git(root, ['add', '.gitignore']);
  await git(root, ['commit', '-qm', 'ignore build output']);
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist', 'index.html'), '<h1>One</h1>\n');

  const before = await captureProjectFingerprint(root, {
    workspaceRoot: root,
    includedPaths: ['dist/index.html'],
  });
  await fs.writeFile(path.join(root, 'dist', 'index.html'), '<h1>Two</h1>\n');
  const after = await captureProjectFingerprint(root, {
    workspaceRoot: root,
    includedPaths: ['dist/index.html'],
  });

  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.ok(after.evidenceFiles.includes('dist/index.html'));
});
