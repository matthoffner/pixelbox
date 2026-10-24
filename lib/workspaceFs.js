const fs = require('node:fs/promises');
const path = require('node:path');

const { expandHome, isInside } = require('./pathScope');

function createWorkspaceFs(workspaceRoot, options = {}) {
  // Absolute paths are only reachable when the user explicitly opened that
  // folder (see lib/externalProjects.js); everything else stays confined to
  // the workspace root.
  const isAllowedExternalPath = typeof options.isAllowedExternalPath === 'function'
    ? options.isAllowedExternalPath
    : () => false;

  function resolveWorkspacePath(targetPath) {
    const requested = expandHome(targetPath) || '.';
    const resolved = path.resolve(workspaceRoot, requested);
    if (isInside(workspaceRoot, resolved)) return resolved;
    if (isAllowedExternalPath(resolved)) return resolved;
    throw new Error('Path is outside workspace');
  }

  function workspacePathFor(absolutePath) {
    if (!isInside(workspaceRoot, absolutePath)) return absolutePath;
    return path.relative(workspaceRoot, absolutePath) || '.';
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
      const node = {
        name: entry.name,
        path: workspacePathFor(absolutePath),
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
    return listDirRecursive(absolute);
  }

  async function readFile(relPath) {
    const absolute = resolveWorkspacePath(relPath);
    const content = await fs.readFile(absolute, 'utf8');
    return { path: relPath, content };
  }

  async function writeFile(relPath, content) {
    const absolute = resolveWorkspacePath(relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
    return { ok: true };
  }

  async function mkdir(relPath) {
    const absolute = resolveWorkspacePath(relPath);
    await fs.mkdir(absolute, { recursive: true });
    return { ok: true };
  }

  async function removeDir(relPath) {
    const absolute = resolveWorkspacePath(relPath);
    await fs.rm(absolute, { recursive: true, force: true });
    return { ok: true };
  }

  return {
    resolveWorkspacePath,
    workspacePathFor,
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
