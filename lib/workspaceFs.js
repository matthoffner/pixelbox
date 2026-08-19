const fs = require('node:fs/promises');
const {
  constants: fsConstants,
  lstatSync,
  realpathSync,
} = require('node:fs');
const path = require('node:path');

function isWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function lstatIfPresent(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function createWorkspaceFs(workspaceRoot) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const canonicalWorkspaceRootSync = realpathSync(resolvedWorkspaceRoot);
  let canonicalWorkspaceRootPromise;

  function resolveWorkspacePath(targetPath) {
    const resolved = path.resolve(resolvedWorkspaceRoot, targetPath || '.');
    if (!isWithin(resolvedWorkspaceRoot, resolved)) {
      throw new Error('Path is outside workspace');
    }
    const rootRealPath = canonicalWorkspaceRootSync;
    const relative = path.relative(resolvedWorkspaceRoot, resolved);
    const components = relative === '' ? [] : relative.split(path.sep).filter(Boolean);
    let currentPath = resolvedWorkspaceRoot;
    for (const component of components) {
      currentPath = path.join(currentPath, component);
      try {
        lstatSync(currentPath);
      } catch (error) {
        if (error?.code === 'ENOENT') break;
        throw error;
      }
      let canonicalPath;
      try {
        canonicalPath = realpathSync(currentPath);
      } catch {
        throw new Error('Refusing to traverse a broken symbolic link');
      }
      if (!isWithin(rootRealPath, canonicalPath)) {
        throw new Error('Path is outside workspace (symbolic link escape)');
      }
    }
    return resolved;
  }

  function canonicalWorkspaceRoot() {
    canonicalWorkspaceRootPromise ||= Promise.resolve(canonicalWorkspaceRootSync);
    return canonicalWorkspaceRootPromise;
  }

  async function assertCanonicalPathInside(candidatePath) {
    const [rootRealPath, candidateRealPath] = await Promise.all([
      canonicalWorkspaceRoot(),
      fs.realpath(candidatePath),
    ]);

    if (!isWithin(rootRealPath, candidateRealPath)) {
      throw new Error('Path is outside workspace (symbolic link escape)');
    }
    return candidateRealPath;
  }

  async function inspectExistingPath(absolutePath, options = {}) {
    const {
      rejectFinalSymlink = false,
      allowMissing = true,
    } = options;
    const relative = path.relative(resolvedWorkspaceRoot, absolutePath);
    const components = relative === '' ? [] : relative.split(path.sep).filter(Boolean);
    const rootRealPath = await canonicalWorkspaceRoot();

    if (components.length === 0) {
      return {
        exists: true,
        canonicalPath: rootRealPath,
        lstat: await fs.lstat(resolvedWorkspaceRoot),
      };
    }

    let currentPath = resolvedWorkspaceRoot;
    for (let index = 0; index < components.length; index += 1) {
      currentPath = path.join(currentPath, components[index]);
      const entry = await lstatIfPresent(currentPath);
      const isFinal = index === components.length - 1;

      if (!entry) {
        if (!allowMissing) {
          const error = new Error(`Path does not exist: ${currentPath}`);
          error.code = 'ENOENT';
          throw error;
        }
        return { exists: false, missingPath: currentPath };
      }

      if (entry.isSymbolicLink() && isFinal && rejectFinalSymlink) {
        throw new Error('Refusing to follow a symbolic link at the destination');
      }

      let canonicalPath;
      try {
        canonicalPath = await fs.realpath(currentPath);
      } catch (error) {
        if (entry.isSymbolicLink()) {
          throw new Error('Refusing to traverse a broken symbolic link');
        }
        throw error;
      }

      if (!isWithin(rootRealPath, canonicalPath)) {
        throw new Error('Path is outside workspace (symbolic link escape)');
      }

      if (!isFinal) {
        const target = entry.isSymbolicLink() ? await fs.stat(currentPath) : entry;
        if (!target.isDirectory()) {
          const error = new Error(`Path component is not a directory: ${currentPath}`);
          error.code = 'ENOTDIR';
          throw error;
        }
      } else {
        return { exists: true, canonicalPath, lstat: entry };
      }
    }

    return { exists: false };
  }

  async function ensureDirectoryPath(absolutePath, options = {}) {
    const { rejectFinalSymlink = true } = options;
    const relative = path.relative(resolvedWorkspaceRoot, absolutePath);
    const components = relative === '' ? [] : relative.split(path.sep).filter(Boolean);
    const rootRealPath = await canonicalWorkspaceRoot();
    let currentPath = resolvedWorkspaceRoot;

    for (let index = 0; index < components.length; index += 1) {
      currentPath = path.join(currentPath, components[index]);
      const isFinal = index === components.length - 1;
      let entry = await lstatIfPresent(currentPath);

      if (!entry) {
        try {
          await fs.mkdir(currentPath);
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
        entry = await fs.lstat(currentPath);
      }

      if (entry.isSymbolicLink() && isFinal && rejectFinalSymlink) {
        throw new Error('Refusing to use a symbolic link as a directory destination');
      }

      let canonicalPath;
      try {
        canonicalPath = await fs.realpath(currentPath);
      } catch (error) {
        if (entry.isSymbolicLink()) {
          throw new Error('Refusing to traverse a broken symbolic link');
        }
        throw error;
      }

      if (!isWithin(rootRealPath, canonicalPath)) {
        throw new Error('Path is outside workspace (symbolic link escape)');
      }

      const target = entry.isSymbolicLink() ? await fs.stat(currentPath) : entry;
      if (!target.isDirectory()) {
        const error = new Error(`Path component is not a directory: ${currentPath}`);
        error.code = 'ENOTDIR';
        throw error;
      }
    }

    return absolutePath;
  }

  async function listDirRecursive(dirPath, depth = 0, maxDepth = 4) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const filtered = entries
      .filter((entry) => !entry.name.startsWith('.git') && entry.name !== 'node_modules')
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const nodes = [];
    for (const entry of filtered) {
      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = path.relative(resolvedWorkspaceRoot, absolutePath) || '.';
      const node = {
        name: entry.name,
        path: relativePath,
        type: entry.isDirectory() ? 'directory' : 'file',
        children: [],
      };

      if (entry.isDirectory() && depth < maxDepth) {
        try {
          node.children = await listDirRecursive(absolutePath, depth + 1, maxDepth);
        } catch {
          node.children = [];
        }
      }
      nodes.push(node);
    }

    return nodes;
  }

  async function listDir(relPath = '.') {
    const absolute = resolveWorkspacePath(relPath);
    await inspectExistingPath(absolute, { allowMissing: false });
    return listDirRecursive(absolute);
  }

  async function readFile(relPath) {
    const absolute = resolveWorkspacePath(relPath);
    const state = await inspectExistingPath(absolute, { allowMissing: false });
    const canonicalPath = await assertCanonicalPathInside(state.canonicalPath);
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    const handle = await fs.open(canonicalPath, flags);

    try {
      const content = await handle.readFile('utf8');
      return { path: relPath, content };
    } finally {
      await handle.close();
    }
  }

  async function writeFile(relPath, content) {
    const absolute = resolveWorkspacePath(relPath);
    const parentPath = path.dirname(absolute);
    await ensureDirectoryPath(parentPath, { rejectFinalSymlink: false });
    await inspectExistingPath(parentPath, { allowMissing: false });
    await inspectExistingPath(absolute, { rejectFinalSymlink: true });

    const flags = fsConstants.O_WRONLY
      | fsConstants.O_CREAT
      | fsConstants.O_TRUNC
      | (fsConstants.O_NOFOLLOW || 0);
    const handle = await fs.open(absolute, flags, 0o666);

    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    return { ok: true };
  }

  async function mkdir(relPath) {
    const absolute = resolveWorkspacePath(relPath);
    await ensureDirectoryPath(absolute, { rejectFinalSymlink: true });
    return { ok: true };
  }

  async function removeDir(relPath) {
    if (typeof relPath !== 'string' || !relPath.trim() || relPath.trim() === '.') {
      throw new Error('Refusing to remove the workspace root');
    }

    const absolute = resolveWorkspacePath(relPath);
    const rootRealPath = await canonicalWorkspaceRoot();
    if (absolute === resolvedWorkspaceRoot) {
      throw new Error('Refusing to remove the workspace root');
    }

    const state = await inspectExistingPath(absolute);
    if (state.exists && state.canonicalPath === rootRealPath) {
      throw new Error('Refusing to remove the workspace root through an alias');
    }

    await fs.rm(absolute, { recursive: true, force: true });
    return { ok: true };
  }

  return {
    resolveWorkspacePath,
    listDir,
    readFile,
    writeFile,
    mkdir,
    removeDir,
  };
}

module.exports = {
  createWorkspaceFs,
};
