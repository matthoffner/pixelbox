function createBridgeSecurity({ host = '127.0.0.1', port = 3210 } = {}) {
  const normalizedPort = String(port);
  const allowedHosts = new Set([
    `${host}:${normalizedPort}`.toLowerCase(),
    `localhost:${normalizedPort}`,
  ]);
  const allowedOrigins = new Set([`http://${host}:${normalizedPort}`.toLowerCase()]);

  function allowsHost(value) {
    const candidate = String(value || '').trim().toLowerCase();
    return allowedHosts.has(candidate);
  }

  function allowsOrigin(value) {
    if (value == null || value === '') return true;
    const candidate = String(value).trim().toLowerCase();
    return candidate !== 'null' && allowedOrigins.has(candidate);
  }

  function validateRequest(req, options = {}) {
    if (!allowsHost(req?.headers?.host)) {
      return { ok: false, reason: 'invalid_host' };
    }
    if (options.requireTrustedOrigin !== false && !allowsOrigin(req?.headers?.origin)) {
      return { ok: false, reason: 'invalid_origin' };
    }
    return { ok: true, reason: '' };
  }

  function validateMethod(method, pathname) {
    const verb = String(method || '').toUpperCase();
    const route = String(pathname || '');
    if (verb === 'OPTIONS') return { ok: true, reason: '' };
    if (route === '/health' || route === '/api/events') {
      return verb === 'GET'
        ? { ok: true, reason: '' }
        : { ok: false, reason: 'method_not_allowed', allow: 'GET, OPTIONS' };
    }
    if (route.startsWith('/api/')) {
      return verb === 'POST'
        ? { ok: true, reason: '' }
        : { ok: false, reason: 'method_not_allowed', allow: 'POST, OPTIONS' };
    }
    return verb === 'GET' || verb === 'HEAD'
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'method_not_allowed', allow: 'GET, HEAD, OPTIONS' };
  }

  function corsHeaders(origin) {
    if (!origin || !allowsOrigin(origin)) return {};
    return {
      'Access-Control-Allow-Origin': String(origin),
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      Vary: 'Origin',
    };
  }

  return {
    allowedHosts,
    allowedOrigins,
    allowsHost,
    allowsOrigin,
    corsHeaders,
    validateMethod,
    validateRequest,
  };
}

module.exports = { createBridgeSecurity };
