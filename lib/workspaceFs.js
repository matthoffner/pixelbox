const fs = require('node:fs/promises');
const path = require('node:path');

function createWorkspaceFs(workspaceRoot) {
  function resolveWorkspacePath(targetPath) {
    const resolved = path.resolve(workspaceRoot, targetPath || '.');
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path is outside workspace');
    }
    return resolved;
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
      const relativePath = path.relative(workspaceRoot, absolutePath) || '.';
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

  return {
    resolveWorkspacePath,
    listDir,
    readFile,
    writeFile,
    mkdir,
  };
}

module.exports = {
  createWorkspaceFs,
};
