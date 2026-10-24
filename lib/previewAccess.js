const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_PREFIX = '/__preview__';
const DEFAULT_MAX_TOKENS = 64;
const HARD_MAX_TOKENS = 256;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_TARGET_LENGTH = 8192;
const FORBIDDEN_NAMES = new Set(['.git', '.pixelbox', '.pxcode', 'node_modules']);

class PreviewAccessError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'PreviewAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function accessError(code, message, statusCode) {
  return new PreviewAccessError(code, message, statusCode);
}

function isInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Preview access requires a localhost port between 1 and 65535.');
  }
  return port;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizePrefix(value) {
  const prefix = String(value || DEFAULT_PREFIX).trim();
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)) {
    throw new TypeError('Preview route prefix must be an absolute path made of safe path segments.');
  }
  return prefix;
}

function isForbiddenName(name) {
  const normalized = String(name || '').toLowerCase();
  return normalized.startsWith('.') || FORBIDDEN_NAMES.has(normalized);
}

function validateFileSegments(relativePath, code = 'PREVIEW_PATH_FORBIDDEN', allowControlPaths = false) {
  const segments = String(relativePath || '').split(/[\\/]+/).filter(Boolean);
  if (!segments.length) {
    throw accessError(code, 'Preview path must identify a file.', 403);
  }
  for (const segment of segments) {
    if (
      segment === '.' ||
      segment === '..' ||
      segment.includes('\0') ||
      /[\u0000-\u001f\u007f]/.test(segment) ||
      (!allowControlPaths && isForbiddenName(segment))
    ) {
      throw accessError(code, 'Preview path contains a forbidden segment.', 403);
    }
  }
  return segments;
}

function rawPathname(requestTarget) {
  const raw = String(requestTarget || '');
  if (!raw || raw.length > MAX_REQUEST_TARGET_LENGTH) {
    throw accessError('PREVIEW_ROUTE_INVALID', 'Preview request path is invalid.', 400);
  }

  let pathname = raw;
  const absoluteUrl = raw.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/);
  if (absoluteUrl) pathname = raw.slice(absoluteUrl[0].length) || '/';
  else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    throw accessError('PREVIEW_ROUTE_INVALID', 'Preview request path is invalid.', 400);
  }

  const suffixIndex = pathname.search(/[?#]/);
  if (suffixIndex >= 0) pathname = pathname.slice(0, suffixIndex);
  if (!pathname.startsWith('/') || pathname.includes('\\')) {
    throw accessError('PREVIEW_ROUTE_INVALID', 'Preview request path is invalid.', 400);
  }
  return pathname;
}

function decodePathSegment(segment) {
  if (!segment) {
    throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview path contains an empty segment.', 403);
  }
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw accessError('PREVIEW_ROUTE_INVALID', 'Preview request path has invalid encoding.', 400);
  }
  if (
    decoded === '.' ||
    decoded === '..' ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    /[\u0000-\u001f\u007f]/.test(decoded) ||
    isForbiddenName(decoded)
  ) {
    throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview path contains a forbidden segment.', 403);
  }
  return decoded;
}

function createPreviewAccess(options = {}) {
  if (typeof options.workspaceRoot !== 'string' || !options.workspaceRoot.trim()) {
    throw new TypeError('Preview access requires a workspace root.');
  }

  const workspacePath = path.resolve(options.workspaceRoot);
  const port = validatePort(options.port);
  const prefix = normalizePrefix(options.prefix);
  const maxTokens = boundedInteger(options.maxTokens, DEFAULT_MAX_TOKENS, 1, HARD_MAX_TOKENS);
  const ttlMs = boundedInteger(options.ttlMs, DEFAULT_TTL_MS, 1000, MAX_TTL_MS);
  const allowControlPaths = options.allowControlPaths === true;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const records = new Map();
  let workspaceRealPromise;

  function getWorkspaceReal() {
    if (!workspaceRealPromise) {
      workspaceRealPromise = fs.realpath(workspacePath).then(async (realPath) => {
        const stat = await fs.stat(realPath);
        if (!stat.isDirectory()) throw new TypeError('Preview workspace root must be a directory.');
        return realPath;
      });
    }
    return workspaceRealPromise;
  }

  function currentTime() {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }

  function prune(at = currentTime()) {
    let removed = 0;
    for (const [token, record] of records) {
      if (record.expiresAt <= at) {
        records.delete(token);
        removed += 1;
      }
    }
    while (records.size > maxTokens) {
      const oldest = records.keys().next().value;
      if (!oldest) break;
      records.delete(oldest);
      removed += 1;
    }
    return removed;
  }

  function mintToken() {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const token = crypto.randomBytes(32).toString('base64url');
      if (!records.has(token)) return token;
    }
    throw accessError('PREVIEW_TOKEN_UNAVAILABLE', 'Could not allocate a preview capability.', 503);
  }

  async function verifyRealFile(candidatePath, rootReal, workspaceReal) {
    let realFile;
    try {
      realFile = await fs.realpath(candidatePath);
    } catch (error) {
      if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
        throw accessError('PREVIEW_FILE_NOT_FOUND', 'Preview file was not found.', 404);
      }
      throw error;
    }

    if (!isInside(workspaceReal, realFile) || !isInside(rootReal, realFile)) {
      throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview path escapes its capability root.', 403);
    }

    validateFileSegments(path.relative(workspaceReal, realFile), 'PREVIEW_PATH_FORBIDDEN', allowControlPaths);
    const stat = await fs.stat(realFile);
    if (!stat.isFile()) {
      throw accessError('PREVIEW_FILE_NOT_FOUND', 'Preview path must identify a regular file.', 404);
    }
    return realFile;
  }

  async function issue(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0') || filePath.includes('\\')) {
      throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview file path is invalid.', 403);
    }
    if (filePath.split('/').includes('..')) {
      throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview file path cannot contain traversal.', 403);
    }

    const workspaceReal = await getWorkspaceReal();
    const candidate = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(workspacePath, filePath);
    if (!isInside(workspacePath, candidate)) {
      throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview file is outside the workspace.', 403);
    }

    const workspaceRelative = path.relative(workspacePath, candidate);
    validateFileSegments(workspaceRelative, 'PREVIEW_PATH_FORBIDDEN', allowControlPaths);

    let rootReal;
    try {
      rootReal = await fs.realpath(path.dirname(candidate));
    } catch (error) {
      if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
        throw accessError('PREVIEW_FILE_NOT_FOUND', 'Preview file was not found.', 404);
      }
      throw error;
    }
    if (!isInside(workspaceReal, rootReal)) {
      throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview capability root is outside the workspace.', 403);
    }
    const realRootRelative = path.relative(workspaceReal, rootReal);
    if (realRootRelative) validateFileSegments(realRootRelative, 'PREVIEW_PATH_FORBIDDEN', allowControlPaths);

    const entryName = path.basename(candidate);
    const realFile = await verifyRealFile(candidate, rootReal, workspaceReal);
    const issuedAt = currentTime();
    prune(issuedAt);

    const token = mintToken();
    const expiresAt = issuedAt + ttlMs;
    const pathname = `${prefix}/${token}/${encodeURIComponent(entryName)}`;
    records.set(token, {
      token,
      rootReal,
      entryName,
      issuedAt,
      expiresAt,
    });
    prune(issuedAt);

    return {
      token,
      url: `http://localhost:${port}${pathname}`,
      pathname,
      workspacePath: toPosix(path.relative(workspaceReal, realFile)),
      expiresAt,
    };
  }

  async function resolve(requestTarget) {
    const pathname = rawPathname(requestTarget);
    const routeStart = `${prefix}/`;
    if (!pathname.startsWith(routeStart)) {
      throw accessError('PREVIEW_ROUTE_INVALID', 'Request is not a preview capability URL.', 404);
    }

    const rawSegments = pathname.slice(routeStart.length).split('/');
    const token = rawSegments.shift();
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw accessError('PREVIEW_TOKEN_INVALID', 'Preview capability is invalid or expired.', 404);
    }

    const at = currentTime();
    const record = records.get(token);
    if (!record || record.expiresAt <= at) {
      if (record) records.delete(token);
      prune(at);
      throw accessError('PREVIEW_TOKEN_INVALID', 'Preview capability is invalid or expired.', 404);
    }
    prune(at);

    let relativeSegments;
    if (rawSegments.length === 0 || (rawSegments.length === 1 && rawSegments[0] === '')) {
      relativeSegments = [record.entryName];
    } else {
      relativeSegments = rawSegments.map(decodePathSegment);
    }
    validateFileSegments(relativeSegments.join(path.sep), 'PREVIEW_PATH_FORBIDDEN', allowControlPaths);

    const candidate = path.resolve(record.rootReal, ...relativeSegments);
    if (!isInside(record.rootReal, candidate)) {
      throw accessError('PREVIEW_PATH_FORBIDDEN', 'Preview path escapes its capability root.', 403);
    }

    const workspaceReal = await getWorkspaceReal();
    const realFile = await verifyRealFile(candidate, record.rootReal, workspaceReal);
    return {
      token,
      filePath: realFile,
      relativePath: toPosix(path.relative(record.rootReal, realFile)),
      workspacePath: toPosix(path.relative(workspaceReal, realFile)),
      expiresAt: record.expiresAt,
    };
  }

  function revoke(token) {
    return records.delete(String(token || ''));
  }

  function clear() {
    records.clear();
  }

  function size() {
    prune();
    return records.size;
  }

  return {
    issue,
    resolve,
    revoke,
    clear,
    prune,
    size,
    prefix,
    port,
  };
}

module.exports = {
  PreviewAccessError,
  createPreviewAccess,
};
