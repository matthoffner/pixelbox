const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { expandHome, isInside } = require('./pathScope');

// Folders the user opened from anywhere on disk. They live outside the
// workspace root, so every fs/terminal/preview call has to be explicitly
// allowed against this registry instead of the plain workspace containment
// check in lib/workspaceFs.js.
function createExternalProjectStore({ storePath, workspaceRoot }) {
  let roots = [];

  function normalize(targetPath) {
    const expanded = expandHome(targetPath);
    if (!expanded) throw new Error('A folder path is required.');
    return path.resolve(expanded);
  }

  function loadSync() {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (!Array.isArray(parsed)) return;
      roots = [...new Set(parsed.filter((entry) => typeof entry === 'string' && entry).map(normalize))];
    } catch {
      roots = [];
    }
  }

  async function persist() {
    await fsp.mkdir(path.dirname(storePath), { recursive: true });
    await fsp.writeFile(storePath, `${JSON.stringify(roots, null, 2)}\n`, 'utf8');
  }

  function entry(absolutePath) {
    return { path: absolutePath, name: path.basename(absolutePath) || absolutePath };
  }

  function list() {
    return roots.map(entry);
  }

  function isAllowedPath(absolutePath) {
    return roots.some((root) => isInside(root, absolutePath));
  }

  function rootFor(absolutePath) {
    return roots.find((root) => isInside(root, absolutePath)) || null;
  }

  async function add(targetPath) {
    const absolute = normalize(targetPath);
    const stats = await fsp.stat(absolute).catch(() => null);
    if (!stats || !stats.isDirectory()) {
      throw new Error(`Not a folder: ${absolute}`);
    }
    // Inside the workspace it is already a plain project path; registering it
    // as an external root would just create a second identity for one folder.
    if (isInside(workspaceRoot, absolute)) {
      const relative = path.relative(workspaceRoot, absolute) || '.';
      return { ...entry(absolute), path: relative, external: false };
    }
    if (!roots.includes(absolute)) {
      roots.push(absolute);
      await persist();
    }
    return { ...entry(absolute), external: true };
  }

  async function remove(targetPath) {
    const absolute = normalize(targetPath);
    const next = roots.filter((root) => root !== absolute);
    if (next.length === roots.length) return { ok: true, removed: false };
    roots = next;
    await persist();
    return { ok: true, removed: true };
  }

  loadSync();

  return {
    list,
    add,
    remove,
    isAllowedPath,
    rootFor,
  };
}

module.exports = {
  createExternalProjectStore,
};
