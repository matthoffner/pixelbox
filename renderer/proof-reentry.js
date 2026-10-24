(function proofReentryFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PixelboxProofReentry = api;
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function proofReentry() {
  const SCHEMA_VERSION = 1;

  function cleanText(value, maxLength = 320) {
    return String(value || '').trim().slice(0, maxLength);
  }

  function normalizeContext(value = {}) {
    return {
      projectPath: cleanText(value.projectPath, 260) || '.',
      sourceType: cleanText(value.sourceType, 40),
      command: cleanText(value.command, 240),
      url: cleanText(value.url, 420),
    };
  }

  function contextsMatch(left, right) {
    const a = normalizeContext(left);
    const b = normalizeContext(right);
    return a.projectPath === b.projectPath &&
      a.sourceType === b.sourceType &&
      a.command === b.command &&
      a.url === b.url;
  }

  function normalizeWorkspace(value) {
    if (!value || typeof value !== 'object') return null;
    const fingerprint = cleanText(value.fingerprint, 120);
    return {
      complete: value.complete === true && fingerprint.startsWith('sha256:'),
      version: Number(value.version) || 0,
      method: cleanText(value.method, 80),
      scope: cleanText(value.scope, 300),
      fingerprint,
      baseRevision: cleanText(value.baseRevision, 120),
      fileCount: Math.max(0, Number(value.fileCount) || 0),
      changedFileCount: Math.max(0, Number(value.changedFileCount) || 0),
      changedFiles: Array.isArray(value.changedFiles)
        ? [...new Set(value.changedFiles.map((file) => cleanText(file, 300)).filter(Boolean))].slice(0, 200)
        : [],
      changedFilesTruncated: value.changedFilesTruncated === true,
      evidenceFiles: Array.isArray(value.evidenceFiles)
        ? [...new Set(value.evidenceFiles.map((file) => cleanText(file, 300)).filter(Boolean))].slice(0, 200)
        : [],
      capturedAt: cleanText(value.capturedAt, 80),
      watchRevision: Number.isInteger(value.watchRevision) ? value.watchRevision : null,
      evidenceValid: value.evidenceValid === true,
    };
  }

  function normalizeVerification(value) {
    if (!value || typeof value !== 'object' || Number(value.schemaVersion) !== SCHEMA_VERSION) return null;
    const workspace = normalizeWorkspace(value.workspace);
    const context = normalizeContext(value.context);
    const liveCheck = value.liveCheck && typeof value.liveCheck === 'object'
      ? {
          ok: value.liveCheck.ok === true,
          status: Number(value.liveCheck.status) || 0,
          label: cleanText(value.liveCheck.label, 200),
          checkedAt: cleanText(value.liveCheck.checkedAt, 80),
        }
      : null;
    const snapshot = value.snapshot && typeof value.snapshot === 'object'
      ? {
          path: cleanText(value.snapshot.path, 300),
          digest: cleanText(value.snapshot.digest, 120),
          capturedAt: cleanText(value.snapshot.capturedAt, 80),
          width: Math.max(0, Number(value.snapshot.width) || 0),
          height: Math.max(0, Number(value.snapshot.height) || 0),
        }
      : null;
    if (!workspace?.complete || !liveCheck?.ok || !snapshot?.path || !snapshot.digest.startsWith('sha256:')) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      verifiedAt: cleanText(value.verifiedAt, 80),
      context,
      workspace,
      liveCheck,
      snapshot,
    };
  }

  function createVerification({ before, after, context, liveCheck, snapshot, evidenceValid, verifiedAt } = {}) {
    const beforeWorkspace = normalizeWorkspace(before);
    const afterWorkspace = normalizeWorkspace(after);
    if (!beforeWorkspace?.complete || !afterWorkspace?.complete) {
      return { ok: false, reason: 'fingerprint_unavailable' };
    }
    if (beforeWorkspace.version !== afterWorkspace.version ||
        beforeWorkspace.fingerprint !== afterWorkspace.fingerprint ||
        (beforeWorkspace.watchRevision !== null && afterWorkspace.watchRevision !== null &&
          beforeWorkspace.watchRevision !== afterWorkspace.watchRevision)) {
      return { ok: false, reason: 'workspace_changed_during_verify' };
    }
    if (!liveCheck || liveCheck.ok !== true) {
      return { ok: false, reason: 'live_check_failed' };
    }
    if (!snapshot || !cleanText(snapshot.path, 300) || !cleanText(snapshot.digest, 120).startsWith('sha256:')) {
      return { ok: false, reason: 'snapshot_missing' };
    }
    if (evidenceValid !== true) return { ok: false, reason: 'snapshot_invalid' };
    const candidate = normalizeVerification({
      schemaVersion: SCHEMA_VERSION,
      verifiedAt: verifiedAt || snapshot.capturedAt || liveCheck.checkedAt || new Date().toISOString(),
      context: normalizeContext(context),
      workspace: afterWorkspace,
      liveCheck: {
        ok: true,
        status: liveCheck.status,
        label: liveCheck.label,
        checkedAt: liveCheck.checkedAt,
      },
      snapshot: {
        path: snapshot.path,
        digest: snapshot.digest,
        capturedAt: snapshot.capturedAt,
        width: snapshot.width,
        height: snapshot.height,
      },
    });
    return candidate
      ? { ok: true, verification: candidate }
      : { ok: false, reason: 'verification_invalid' };
  }

  function deriveState({ verification, currentWorkspace, currentContext, verifying, blocked, needsAttention, readyEligible = true } = {}) {
    if (verifying) return { key: 'proving', label: 'Proving', tone: 'waiting' };
    if (needsAttention) return { key: 'needs-you', label: 'Needs you', tone: 'waiting' };
    if (blocked) return { key: 'blocked', label: 'Blocked', tone: 'error' };
    if (!readyEligible) return { key: 'building', label: 'Building', tone: 'idle' };

    const normalizedVerification = normalizeVerification(verification);
    if (normalizedVerification) {
      const current = normalizeWorkspace(currentWorkspace);
      if (!current?.complete) return { key: 'unknown', label: 'Proof unavailable', tone: 'waiting' };
      if (!contextsMatch(normalizedVerification.context, currentContext) ||
          normalizedVerification.workspace.version !== current.version ||
          normalizedVerification.workspace.fingerprint !== current.fingerprint ||
          current.evidenceValid !== true) {
        return { key: 'stale', label: 'Proof stale', tone: 'waiting' };
      }
      return { key: 'ready', label: 'Ready', tone: 'success' };
    }

    return { key: 'building', label: 'Building', tone: 'idle' };
  }

  function reasonLabel(reason) {
    const labels = {
      fingerprint_unavailable: 'Workspace fingerprint unavailable',
      workspace_changed_during_verify: 'Files changed during Verify',
      live_check_failed: 'Live Check failed',
      snapshot_missing: 'Verified snapshot missing',
      snapshot_invalid: 'Verified snapshot changed or is missing',
      verification_invalid: 'Verification evidence incomplete',
    };
    return labels[reason] || 'Verification could not be bound';
  }

  return {
    SCHEMA_VERSION,
    contextsMatch,
    createVerification,
    deriveState,
    normalizeContext,
    normalizeVerification,
    normalizeWorkspace,
    reasonLabel,
  };
});
