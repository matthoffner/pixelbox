const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const FINGERPRINT_VERSION = 1;
const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const GIT_MAX_BUFFER = 128 * 1024 * 1024;
const CONTROL_DIRECTORIES = new Set([
  '.git',
  '.pixelbox',
  '.pxcode',
  'node_modules',
  '.next',
  '.zig-cache',
  'zig-cache',
  'zig-out',
  'coverage',
]);

class FingerprintError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FingerprintError';
    this.code = code;
  }
}

function normalizedRelativePath(value) {
  return String(value || '')
    .split(path.sep)
    .join('/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function shouldExcludeRelativePath(value, options = {}) {
  const relativePath = normalizedRelativePath(value);
  if (!relativePath) return false;
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.some((part) => CONTROL_DIRECTORIES.has(part))) return true;
  return options.excludeProjects === true && parts[0] === 'projects';
}

function isInsideRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveSafeProjectRoot(workspaceRoot, projectRoot) {
  const resolvedWorkspace = await fsp.realpath(path.resolve(workspaceRoot));
  const resolvedProject = await fsp.realpath(path.resolve(projectRoot));
  if (!isInsideRoot(resolvedWorkspace, resolvedProject)) {
    throw new FingerprintError('OUTSIDE_WORKSPACE', 'Project fingerprint target is outside the workspace.');
  }
  return {
    workspaceRoot: resolvedWorkspace,
    projectRoot: resolvedProject,
    excludeProjects: resolvedWorkspace === resolvedProject,
  };
}

async function runGit(cwd, args, options = {}) {
  return execFileAsync('git', args, {
    cwd,
    encoding: options.encoding || 'buffer',
    maxBuffer: options.maxBuffer || GIT_MAX_BUFFER,
    windowsHide: true,
  });
}

function splitNul(value) {
  const source = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  return source.split('\0').map(normalizedRelativePath).filter(Boolean);
}

function gitPathspecs(excludeProjects) {
  const specs = [
    '.',
    ':(exclude).git/**',
    ':(exclude).pixelbox/**',
    ':(exclude).pxcode/**',
    ':(exclude)node_modules/**',
    ':(exclude).next/**',
    ':(exclude).zig-cache/**',
    ':(exclude)zig-cache/**',
    ':(exclude)zig-out/**',
    ':(exclude)coverage/**',
  ];
  if (excludeProjects) specs.push(':(exclude)projects/**');
  return specs;
}

function normalizedIncludedPaths(values, excludeProjects) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(normalizedRelativePath)
    .filter((value) => value && !value.startsWith('../') && !path.isAbsolute(value))
    .filter((value) => !shouldExcludeRelativePath(value, { excludeProjects })))]
    .sort()
    .slice(0, 16);
}

async function projectIsIgnoredByParentRepo(projectRoot) {
  try {
    await runGit(projectRoot, ['check-ignore', '-q', '--', '.']);
    return true;
  } catch (error) {
    if (error && error.code === 1) return false;
    return false;
  }
}

async function captureScopedHeadRevision(projectRoot, excludeProjects) {
  const [topLevelResult, treeResult] = await Promise.all([
    runGit(projectRoot, ['rev-parse', '--show-toplevel']),
    runGit(projectRoot, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']),
  ]);
  const repositoryRoot = String(topLevelResult.stdout).trim();
  const projectPrefix = normalizedRelativePath(path.relative(repositoryRoot, projectRoot));
  const prefix = projectPrefix ? `${projectPrefix}/` : '';
  const hash = crypto.createHash('sha256');
  hash.update(`pixelbox-scoped-head\0${FINGERPRINT_VERSION}\0`);
  const records = Buffer.isBuffer(treeResult.stdout)
    ? treeResult.stdout.toString('utf8').split('\0')
    : String(treeResult.stdout || '').split('\0');

  for (const record of records) {
    if (!record) continue;
    const separator = record.indexOf('\t');
    if (separator < 0) continue;
    const metadata = record.slice(0, separator);
    const repositoryPath = normalizedRelativePath(record.slice(separator + 1));
    if (prefix && !repositoryPath.startsWith(prefix)) continue;
    const relativePath = prefix ? repositoryPath.slice(prefix.length) : repositoryPath;
    if (!relativePath || shouldExcludeRelativePath(relativePath, { excludeProjects })) continue;
    hash.update(`${metadata}\t${relativePath}\0`);
  }

  return `sha256:${hash.digest('hex')}`;
}

async function hashFileEntry(hash, projectRoot, relativePath, budget) {
  const absolutePath = path.join(projectRoot, relativePath);
  const before = await fsp.lstat(absolutePath);
  const executable = before.mode & 0o111 ? 'x' : '-';
  hash.update(`path\0${normalizedRelativePath(relativePath)}\0mode\0${executable}\0`);

  if (before.isSymbolicLink()) {
    const target = await fsp.readlink(absolutePath);
    hash.update(`link\0${target}\0`);
    return 0;
  }
  if (!before.isFile()) {
    hash.update(`other\0${before.mode}\0`);
    return 0;
  }
  if (budget.bytes + before.size > budget.maxBytes) {
    throw new FingerprintError('BYTE_BUDGET_EXCEEDED', 'Project is too large for a trustworthy fingerprint.');
  }

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let handle;
  try {
    handle = await fsp.open(absolutePath, flags);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size) {
      throw new FingerprintError('WORKSPACE_UNSTABLE', 'A project file changed while it was being fingerprinted.');
    }
    hash.update(`file\0${opened.size}\0`);
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw new FingerprintError('WORKSPACE_UNSTABLE', 'A project file changed while it was being fingerprinted.');
    }
    budget.bytes += opened.size;
    return opened.size;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function captureGitFingerprint(context, options) {
  const { projectRoot, excludeProjects } = context;
  try {
    const inside = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
    if (String(inside.stdout).trim() !== 'true') return null;
  } catch {
    return null;
  }
  if (await projectIsIgnoredByParentRepo(projectRoot)) return null;

  let baseRevision;
  try {
    await runGit(projectRoot, ['rev-parse', '--verify', 'HEAD']);
    baseRevision = await captureScopedHeadRevision(projectRoot, excludeProjects);
  } catch {
    return null;
  }

  const pathspecs = gitPathspecs(excludeProjects);
  const scopeArgs = ['--', ...pathspecs];
  const [diffResult, changedResult, allResult, untrackedResult] = await Promise.all([
    runGit(projectRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD', ...scopeArgs]),
    runGit(projectRoot, ['diff', '--name-only', '-z', 'HEAD', ...scopeArgs]),
    runGit(projectRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...scopeArgs]),
    runGit(projectRoot, ['ls-files', '-z', '--others', '--exclude-standard', ...scopeArgs]),
  ]);

  const allFiles = splitNul(allResult.stdout)
    .filter((file) => !shouldExcludeRelativePath(file, { excludeProjects }))
    .sort();
  if (allFiles.length > options.maxFiles) {
    throw new FingerprintError('FILE_BUDGET_EXCEEDED', 'Project has too many files for a trustworthy fingerprint.');
  }

  const untrackedFiles = splitNul(untrackedResult.stdout)
    .filter((file) => !shouldExcludeRelativePath(file, { excludeProjects }))
    .sort();
  const explicitFiles = normalizedIncludedPaths(options.includedPaths, excludeProjects);
  const changedFiles = [...new Set([
    ...splitNul(changedResult.stdout),
    ...untrackedFiles,
  ].filter((file) => !shouldExcludeRelativePath(file, { excludeProjects })))].sort();

  const hash = crypto.createHash('sha256');
  hash.update(`pixelbox-project-fingerprint\0${FINGERPRINT_VERSION}\0git\0${baseRevision}\0`);
  hash.update(diffResult.stdout);
  const budget = { bytes: diffResult.stdout.length, maxBytes: options.maxBytes };
  for (const relativePath of untrackedFiles) {
    await hashFileEntry(hash, projectRoot, relativePath, budget);
  }
  for (const relativePath of explicitFiles) {
    hash.update('explicit\0');
    try {
      await hashFileEntry(hash, projectRoot, relativePath, budget);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        hash.update(`missing\0${relativePath}\0`);
        continue;
      }
      throw error;
    }
  }

  return {
    complete: true,
    version: FINGERPRINT_VERSION,
    method: 'git-worktree',
    scope: explicitFiles.length > 0
      ? 'Git-visible project files plus the active static preview artifact; Pixelbox control state and sibling projects excluded'
      : 'Git-visible project files; Pixelbox control state and sibling projects excluded',
    fingerprint: `sha256:${hash.digest('hex')}`,
    baseRevision,
    fileCount: allFiles.length,
    changedFileCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, 200),
    changedFilesTruncated: changedFiles.length > 200,
    evidenceFiles: explicitFiles,
    capturedAt: new Date().toISOString(),
  };
}

async function collectFilesystemEntries(projectRoot, excludeProjects, maxFiles) {
  const entries = [];
  async function walk(relativeDirectory) {
    const absoluteDirectory = path.join(projectRoot, relativeDirectory);
    const children = await fsp.readdir(absoluteDirectory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const relativePath = normalizedRelativePath(path.join(relativeDirectory, child.name));
      if (shouldExcludeRelativePath(relativePath, { excludeProjects })) continue;
      if (child.isDirectory()) {
        await walk(relativePath);
      } else {
        entries.push(relativePath);
        if (entries.length > maxFiles) {
          throw new FingerprintError('FILE_BUDGET_EXCEEDED', 'Project has too many files for a trustworthy fingerprint.');
        }
      }
    }
  }
  await walk('');
  return entries.sort();
}

async function captureFilesystemFingerprint(context, options) {
  const { projectRoot, excludeProjects } = context;
  const files = await collectFilesystemEntries(projectRoot, excludeProjects, options.maxFiles);
  const hash = crypto.createHash('sha256');
  hash.update(`pixelbox-project-fingerprint\0${FINGERPRINT_VERSION}\0filesystem\0`);
  const budget = { bytes: 0, maxBytes: options.maxBytes };
  for (const relativePath of files) {
    await hashFileEntry(hash, projectRoot, relativePath, budget);
  }
  return {
    complete: true,
    version: FINGERPRINT_VERSION,
    method: 'filesystem-tree',
    scope: 'Project files; Pixelbox control state, dependency trees, build caches, and sibling projects excluded',
    fingerprint: `sha256:${hash.digest('hex')}`,
    baseRevision: null,
    fileCount: files.length,
    changedFileCount: 0,
    changedFiles: [],
    changedFilesTruncated: false,
    evidenceFiles: files.slice(0, 200),
    capturedAt: new Date().toISOString(),
  };
}

async function captureProjectFingerprint(projectRoot, options = {}) {
  const workspaceRoot = options.workspaceRoot || projectRoot;
  const context = await resolveSafeProjectRoot(workspaceRoot, projectRoot);
  const limits = {
    maxFiles: Number(options.maxFiles) || DEFAULT_MAX_FILES,
    maxBytes: Number(options.maxBytes) || DEFAULT_MAX_BYTES,
    includedPaths: options.includedPaths,
  };
  const gitFingerprint = await captureGitFingerprint(context, limits);
  return gitFingerprint || captureFilesystemFingerprint(context, limits);
}

module.exports = {
  FINGERPRINT_VERSION,
  FingerprintError,
  captureProjectFingerprint,
  normalizedRelativePath,
  shouldExcludeRelativePath,
};
