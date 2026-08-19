const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createPreviewAccess, PreviewAccessError } = require('../lib/previewAccess');

async function fixture(t) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pixelbox-preview-access-'));
  const workspace = path.join(tempRoot, 'workspace');
  const external = path.join(tempRoot, 'external');
  await fs.mkdir(path.join(workspace, 'site', 'assets'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'private'), { recursive: true });
  await fs.mkdir(external, { recursive: true });
  await fs.writeFile(path.join(workspace, 'root.html'), '<h1>Root</h1>');
  await fs.writeFile(path.join(workspace, 'site', 'index.html'), '<h1>Site</h1>');
  await fs.writeFile(path.join(workspace, 'site', 'about.html'), '<h1>About</h1>');
  await fs.writeFile(path.join(workspace, 'site', 'assets', 'app.js'), 'console.log("site")');
  await fs.writeFile(path.join(workspace, 'private', 'secret.txt'), 'workspace secret');
  await fs.writeFile(path.join(external, 'secret.txt'), 'external secret');
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  return { workspace, external };
}

function errorCode(code) {
  return (error) => error instanceof PreviewAccessError && error.code === code;
}

test('issues an unguessable localhost URL and resolves entry plus relative assets', async (t) => {
  const { workspace } = await fixture(t);
  const access = createPreviewAccess({ workspaceRoot: workspace, port: 43210 });

  const capability = await access.issue('site/index.html');
  assert.match(capability.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(capability.url, `http://localhost:43210/__preview__/${capability.token}/index.html`);
  assert.equal(capability.workspacePath, 'site/index.html');

  const entry = await access.resolve(capability.url);
  assert.equal(entry.filePath, await fs.realpath(path.join(workspace, 'site', 'index.html')));
  assert.equal(entry.relativePath, 'index.html');

  const asset = await access.resolve(`/__preview__/${capability.token}/assets/app.js?cache=1`);
  assert.equal(asset.filePath, await fs.realpath(path.join(workspace, 'site', 'assets', 'app.js')));
  assert.equal(asset.relativePath, 'assets/app.js');

  const root = await access.resolve(`/__preview__/${capability.token}/`);
  assert.equal(root.filePath, await fs.realpath(path.join(workspace, 'site', 'index.html')));

  const rootCapability = await access.issue('root.html');
  const rootEntry = await access.resolve(rootCapability.pathname);
  assert.equal(rootEntry.workspacePath, 'root.html');
});

test('a capability is confined to the issued file containing directory', async (t) => {
  const { workspace } = await fixture(t);
  const access = createPreviewAccess({ workspaceRoot: workspace, port: 43210 });
  const { token } = await access.issue(path.join(workspace, 'site', 'index.html'));

  const attacks = [
    `/__preview__/${token}/../private/secret.txt`,
    `/__preview__/${token}/%2e%2e/private/secret.txt`,
    `/__preview__/${token}/%2E%2E/private/secret.txt`,
    `/__preview__/${token}/assets%2f..%2f..%2fprivate%2fsecret.txt`,
    `/__preview__/${token}/assets%5c..%5cprivate%5csecret.txt`,
    `/__preview__/${token}//about.html`,
  ];
  for (const target of attacks) {
    await assert.rejects(access.resolve(target), errorCode('PREVIEW_PATH_FORBIDDEN'), target);
  }

  await assert.rejects(access.issue('../external/secret.txt'), errorCode('PREVIEW_PATH_FORBIDDEN'));
  await assert.rejects(access.issue('site/../private/secret.txt'), errorCode('PREVIEW_PATH_FORBIDDEN'));
});

test('dotfiles and control directories cannot be issued or resolved', async (t) => {
  const { workspace } = await fixture(t);
  await fs.mkdir(path.join(workspace, 'site', '.git'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'site', '.pixelbox'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'site', '.pxcode'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'site', 'node_modules', 'pkg'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'site', '.env'), 'SECRET=yes');
  await fs.writeFile(path.join(workspace, 'site', '.git', 'config'), 'private');
  await fs.writeFile(path.join(workspace, 'site', '.pixelbox', 'state.json'), '{}');
  await fs.writeFile(path.join(workspace, 'site', '.pxcode', 'state.json'), '{}');
  await fs.writeFile(path.join(workspace, 'site', 'node_modules', 'pkg', 'index.js'), 'private');

  const access = createPreviewAccess({ workspaceRoot: workspace, port: 43210 });
  await assert.rejects(access.issue('site/.env'), errorCode('PREVIEW_PATH_FORBIDDEN'));
  await assert.rejects(access.issue('site/node_modules/pkg/index.js'), errorCode('PREVIEW_PATH_FORBIDDEN'));

  const { token } = await access.issue('site/index.html');
  for (const relative of ['.env', '.git/config', '.pixelbox/state.json', '.pxcode/state.json', 'node_modules/pkg/index.js']) {
    await assert.rejects(
      access.resolve(`/__preview__/${token}/${relative}`),
      errorCode('PREVIEW_PATH_FORBIDDEN'),
      relative
    );
  }
});

test('a separate evidence capability may serve an exact control artifact without weakening preview tokens', async (t) => {
  const { workspace } = await fixture(t);
  await fs.mkdir(path.join(workspace, '.pixelbox', 'proof-snapshots'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.pixelbox', 'proof-snapshots', 'proof.png'), 'png');
  const evidence = createPreviewAccess({
    workspaceRoot: workspace,
    port: 43210,
    prefix: '/__evidence__',
    allowControlPaths: true,
  });
  const capability = await evidence.issue('.pixelbox/proof-snapshots/proof.png');
  assert.match(capability.url, /^http:\/\/localhost:43210\/__evidence__\//);
  assert.equal((await evidence.resolve(capability.pathname)).workspacePath, '.pixelbox/proof-snapshots/proof.png');
});

test('symlinks cannot escape the token root or workspace or hide control paths', async (t) => {
  const { workspace, external } = await fixture(t);
  await fs.writeFile(path.join(workspace, 'site', '.hidden.txt'), 'hidden');
  await fs.symlink(path.join(workspace, 'private', 'secret.txt'), path.join(workspace, 'site', 'workspace-secret.txt'));
  await fs.symlink(path.join(external, 'secret.txt'), path.join(workspace, 'site', 'external-secret.txt'));
  await fs.symlink(path.join(workspace, 'site', '.hidden.txt'), path.join(workspace, 'site', 'hidden-alias.txt'));
  await fs.symlink(path.join(workspace, 'site', 'about.html'), path.join(workspace, 'site', 'about-alias.html'));

  const access = createPreviewAccess({ workspaceRoot: workspace, port: 43210 });
  await assert.rejects(access.issue('site/workspace-secret.txt'), errorCode('PREVIEW_PATH_FORBIDDEN'));
  await assert.rejects(access.issue('site/external-secret.txt'), errorCode('PREVIEW_PATH_FORBIDDEN'));
  await assert.rejects(access.issue('site/hidden-alias.txt'), errorCode('PREVIEW_PATH_FORBIDDEN'));

  const { token } = await access.issue('site/index.html');
  await assert.rejects(
    access.resolve(`/__preview__/${token}/workspace-secret.txt`),
    errorCode('PREVIEW_PATH_FORBIDDEN')
  );
  await assert.rejects(
    access.resolve(`/__preview__/${token}/external-secret.txt`),
    errorCode('PREVIEW_PATH_FORBIDDEN')
  );
  await assert.rejects(
    access.resolve(`/__preview__/${token}/hidden-alias.txt`),
    errorCode('PREVIEW_PATH_FORBIDDEN')
  );

  const safeAlias = await access.resolve(`/__preview__/${token}/about-alias.html`);
  assert.equal(safeAlias.filePath, await fs.realpath(path.join(workspace, 'site', 'about.html')));
});

test('tokens expire, can be revoked, and are pruned to the configured cap', async (t) => {
  const { workspace } = await fixture(t);
  let clock = 1_000;
  const access = createPreviewAccess({
    workspaceRoot: workspace,
    port: 43210,
    maxTokens: 2,
    ttlMs: 1_000,
    now: () => clock,
  });

  const first = await access.issue('site/index.html');
  const second = await access.issue('site/about.html');
  const third = await access.issue('site/assets/app.js');
  assert.equal(access.size(), 2);
  await assert.rejects(access.resolve(first.pathname), errorCode('PREVIEW_TOKEN_INVALID'));
  await access.resolve(second.pathname);
  await access.resolve(third.pathname);

  assert.equal(access.revoke(second.token), true);
  assert.equal(access.revoke(second.token), false);
  await assert.rejects(access.resolve(second.pathname), errorCode('PREVIEW_TOKEN_INVALID'));

  clock = 2_001;
  assert.equal(access.prune(), 1);
  assert.equal(access.size(), 0);
  await assert.rejects(access.resolve(third.pathname), errorCode('PREVIEW_TOKEN_INVALID'));
});

test('unknown tokens, malformed routes, missing files, and directories fail closed', async (t) => {
  const { workspace } = await fixture(t);
  const access = createPreviewAccess({ workspaceRoot: workspace, port: 43210 });
  const { token } = await access.issue('site/index.html');

  await assert.rejects(
    access.resolve('/other/route'),
    errorCode('PREVIEW_ROUTE_INVALID')
  );
  await assert.rejects(
    access.resolve('/__preview__/guess/index.html'),
    errorCode('PREVIEW_TOKEN_INVALID')
  );
  await assert.rejects(
    access.resolve(`/__preview__/${token}/missing.html`),
    errorCode('PREVIEW_FILE_NOT_FOUND')
  );
  await assert.rejects(
    access.resolve(`/__preview__/${token}/assets`),
    errorCode('PREVIEW_FILE_NOT_FOUND')
  );

  access.clear();
  assert.equal(access.size(), 0);
});
