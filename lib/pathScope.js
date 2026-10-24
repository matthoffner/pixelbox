const os = require('node:os');
const path = require('node:path');

function expandHome(targetPath) {
  const value = String(targetPath == null ? '' : targetPath).trim();
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

module.exports = {
  expandHome,
  isInside,
};
