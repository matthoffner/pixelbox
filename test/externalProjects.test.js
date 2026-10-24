const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createExternalProjectStore } = require('../lib/externalProjects');
const { createWorkspaceFs } = require('../lib/workspaceFs');
const { pickerCommand } = require('../lib/folderPicker');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelbox-external-'));
  const workspaceRoot = path.join(root, 'workspace');
  const outside = path.join(root, 'outside-repo');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(outside, 'src'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'src', 'index.js'), 'console.log("hi");\n');
  return {
    root,
    workspaceRoot,
    outside,
    storePath: path.join(workspaceRoot, '.pixelbox', 'external-projects.json'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('external folders are only reachable after they are registered', async (t) => {
  const sandbox = makeSandbox();
  t.after(sandbox.cleanup);

  const store = createExternalProjectStore({
    storePath: sandbox.storePath,
    workspaceRoot: sandbox.workspaceRoot,
  });
  const workspaceFs = createWorkspaceFs(sandbox.workspaceRoot, {
    isAllowedExternalPath: (absolutePath) => store.isAllowedPath(absolutePath),
  });

  assert.throws(() => workspaceFs.resolveWorkspacePath(sandbox.outside), /outside workspace/);

  const entry = await store.add(sandbox.outside);
  assert.equal(entry.external, true);
  assert.equal(entry.path, sandbox.outside);
  assert.equal(entry.name, path.basename(sandbox.outside));

  assert.equal(workspaceFs.resolveWorkspacePath(entry.path), entry.path);
  assert.equal(
    workspaceFs.resolveWorkspacePath(`${entry.path}/src/index.js`),
    path.join(entry.path, 'src', 'index.js')
  );

  const listing = await workspaceFs.listDir(entry.path);
  const src = listing.find((node) => node.name === 'src');
  assert.equal(src.path, path.join(entry.path, 'src'), 'entries outside the workspace keep absolute paths');

  await store.remove(entry.path);
  assert.throws(() => workspaceFs.resolveWorkspacePath(entry.path), /outside workspace/);
});

test('registration persists across store instances', async (t) => {
  const sandbox = makeSandbox();
  t.after(sandbox.cleanup);

  const first = createExternalProjectStore({
    storePath: sandbox.storePath,
    workspaceRoot: sandbox.workspaceRoot,
  });
  await first.add(sandbox.outside);

  const second = createExternalProjectStore({
    storePath: sandbox.storePath,
    workspaceRoot: sandbox.workspaceRoot,
  });
  assert.deepEqual(second.list().map((entry) => entry.path), [sandbox.outside]);
  assert.equal(second.isAllowedPath(path.join(sandbox.outside, 'src')), true);
});

test('a folder inside the workspace stays a plain project path', async (t) => {
  const sandbox = makeSandbox();
  t.after(sandbox.cleanup);
  const inside = path.join(sandbox.workspaceRoot, 'projects', 'demo');
  await fsp.mkdir(inside, { recursive: true });

  const store = createExternalProjectStore({
    storePath: sandbox.storePath,
    workspaceRoot: sandbox.workspaceRoot,
  });
  const entry = await store.add(inside);
  assert.equal(entry.external, false);
  assert.equal(entry.path, path.join('projects', 'demo'));
  assert.deepEqual(store.list(), []);
});

test('adding a missing folder or a file fails loudly', async (t) => {
  const sandbox = makeSandbox();
  t.after(sandbox.cleanup);
  const store = createExternalProjectStore({
    storePath: sandbox.storePath,
    workspaceRoot: sandbox.workspaceRoot,
  });

  await assert.rejects(store.add(path.join(sandbox.root, 'nope')), /Not a folder/);
  await assert.rejects(store.add(path.join(sandbox.outside, 'src', 'index.js')), /Not a folder/);
  await assert.rejects(store.add('   '), /folder path is required/);
});

test('the folder picker binary matches the platform', () => {
  assert.equal(pickerCommand('darwin').file, 'osascript');
  assert.equal(pickerCommand('win32').file, 'powershell');
  assert.equal(pickerCommand('linux').file, 'zenity');
});
