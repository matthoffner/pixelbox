const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createWorkspaceFs } = require('../lib/workspaceFs');

async function makeFixture(t) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-workspace-fs-'));
  const workspaceRoot = path.join(fixtureRoot, 'workspace');
  const outsideRoot = path.join(fixtureRoot, 'outside');
  await Promise.all([
    fs.mkdir(workspaceRoot),
    fs.mkdir(outsideRoot),
  ]);
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
  return {
    workspaceRoot,
    outsideRoot,
    workspaceFs: createWorkspaceFs(workspaceRoot),
  };
}

test('ordinary workspace operations remain supported', async (t) => {
  const { workspaceRoot, workspaceFs } = await makeFixture(t);

  assert.deepEqual(await workspaceFs.mkdir('notes/nested'), { ok: true });
  assert.deepEqual(await workspaceFs.writeFile('notes/nested/hello.txt', 'hello'), { ok: true });
  assert.deepEqual(await workspaceFs.readFile('notes/nested/hello.txt'), {
    path: 'notes/nested/hello.txt',
    content: 'hello',
  });

  assert.deepEqual(await workspaceFs.removeDir('notes'), { ok: true });
  await assert.rejects(fs.access(path.join(workspaceRoot, 'notes')), { code: 'ENOENT' });
  assert.throws(() => workspaceFs.resolveWorkspacePath('../outside'), /outside workspace/);
});

test('readFile rejects file and parent symlinks that escape the workspace', async (t) => {
  const { workspaceRoot, outsideRoot, workspaceFs } = await makeFixture(t);
  const secretPath = path.join(outsideRoot, 'secret.txt');
  await fs.writeFile(secretPath, 'do not expose');
  await fs.symlink(secretPath, path.join(workspaceRoot, 'secret-link'));
  await fs.symlink(outsideRoot, path.join(workspaceRoot, 'outside-link'));

  assert.throws(() => workspaceFs.resolveWorkspacePath('secret-link'), /outside workspace/);
  assert.throws(() => workspaceFs.resolveWorkspacePath('outside-link/secret.txt'), /outside workspace/);
  await assert.rejects(workspaceFs.readFile('secret-link'), /outside workspace/);
  await assert.rejects(workspaceFs.readFile('outside-link/secret.txt'), /outside workspace/);
  assert.equal(await fs.readFile(secretPath, 'utf8'), 'do not expose');
});

test('writeFile never follows a final symlink or an escaping parent symlink', async (t) => {
  const { workspaceRoot, outsideRoot, workspaceFs } = await makeFixture(t);
  const outsideFile = path.join(outsideRoot, 'keep.txt');
  const insideFile = path.join(workspaceRoot, 'inside.txt');
  await fs.writeFile(outsideFile, 'outside original');
  await fs.writeFile(insideFile, 'inside original');
  await fs.symlink(outsideFile, path.join(workspaceRoot, 'outside-file-link'));
  await fs.symlink('inside.txt', path.join(workspaceRoot, 'inside-file-link'));
  await fs.symlink(outsideRoot, path.join(workspaceRoot, 'outside-dir-link'));

  await assert.rejects(
    workspaceFs.writeFile('outside-file-link', 'overwrite'),
    /symbolic link/,
  );
  await assert.rejects(
    workspaceFs.writeFile('inside-file-link', 'overwrite'),
    /symbolic link/,
  );
  await assert.rejects(
    workspaceFs.writeFile('outside-dir-link/new.txt', 'escape'),
    /outside workspace/,
  );

  assert.equal(await fs.readFile(outsideFile, 'utf8'), 'outside original');
  assert.equal(await fs.readFile(insideFile, 'utf8'), 'inside original');
  await assert.rejects(fs.access(path.join(outsideRoot, 'new.txt')), { code: 'ENOENT' });
});

test('mkdir rejects escaping parent and final directory symlinks', async (t) => {
  const { workspaceRoot, outsideRoot, workspaceFs } = await makeFixture(t);
  await fs.symlink(outsideRoot, path.join(workspaceRoot, 'outside-dir-link'));

  await assert.rejects(workspaceFs.mkdir('outside-dir-link'), /symbolic link/);
  await assert.rejects(workspaceFs.mkdir('outside-dir-link/new-dir'), /outside workspace/);
  await assert.rejects(fs.access(path.join(outsideRoot, 'new-dir')), { code: 'ENOENT' });
});

test('removeDir refuses every workspace-root spelling', async (t) => {
  const { workspaceRoot, workspaceFs } = await makeFixture(t);
  const sentinelPath = path.join(workspaceRoot, 'sentinel.txt');
  await fs.writeFile(sentinelPath, 'keep');

  for (const unsafePath of [undefined, '', '   ', '.', './', 'child/..', workspaceRoot]) {
    await assert.rejects(workspaceFs.removeDir(unsafePath), /workspace root/);
  }

  assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'keep');
});

test('removeDir rejects escaping symlinks without deleting links or targets', async (t) => {
  const { workspaceRoot, outsideRoot, workspaceFs } = await makeFixture(t);
  const outsideChild = path.join(outsideRoot, 'victim');
  const outsideSentinel = path.join(outsideChild, 'sentinel.txt');
  const outsideLink = path.join(workspaceRoot, 'outside-dir-link');
  await fs.mkdir(outsideChild);
  await fs.writeFile(outsideSentinel, 'keep');
  await fs.symlink(outsideRoot, outsideLink);

  await assert.rejects(workspaceFs.removeDir('outside-dir-link'), /outside workspace/);
  await assert.rejects(workspaceFs.removeDir('outside-dir-link/victim'), /outside workspace/);

  assert.equal((await fs.lstat(outsideLink)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(outsideSentinel, 'utf8'), 'keep');
});
