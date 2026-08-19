const test = require('node:test');
const assert = require('node:assert/strict');

const { createBridgeSecurity } = require('../lib/bridgeSecurity');

const policy = createBridgeSecurity({ host: '127.0.0.1', port: 3210 });

test('bridge accepts only its loopback Host names on the configured port', () => {
  assert.equal(policy.allowsHost('127.0.0.1:3210'), true);
  assert.equal(policy.allowsHost('localhost:3210'), true);
  assert.equal(policy.allowsHost('evil.example:3210'), false);
  assert.equal(policy.allowsHost('127.0.0.1:9999'), false);
  assert.equal(policy.allowsHost(''), false);
});

test('bridge rejects foreign and opaque browser origins', () => {
  assert.equal(policy.allowsOrigin('http://127.0.0.1:3210'), true);
  assert.equal(policy.allowsOrigin('http://localhost:3210'), false);
  assert.equal(policy.allowsOrigin('https://evil.example'), false);
  assert.equal(policy.allowsOrigin('null'), false);
  assert.equal(policy.allowsOrigin(undefined), true);
});

test('static preview requests may use the isolated localhost origin without trusting it for APIs', () => {
  const previewRequest = { headers: {
    host: 'localhost:3210',
    origin: 'http://localhost:3210',
  } };
  assert.equal(policy.validateRequest(previewRequest, { requireTrustedOrigin: false }).ok, true);
  assert.equal(policy.validateRequest(previewRequest).ok, false);
});

test('request validation fails closed for DNS rebinding and cross-site calls', () => {
  assert.deepEqual(policy.validateRequest({ headers: {
    host: 'evil.example:3210',
    origin: 'https://evil.example',
  } }), { ok: false, reason: 'invalid_host' });
  assert.deepEqual(policy.validateRequest({ headers: {
    host: '127.0.0.1:3210',
    origin: 'https://evil.example',
  } }), { ok: false, reason: 'invalid_origin' });
  assert.equal(policy.validateRequest({ headers: {
    host: '127.0.0.1:3210',
    origin: 'http://127.0.0.1:3210',
  } }).ok, true);
});

test('bridge API mutations are POST-only while health and events are GET-only', () => {
  assert.equal(policy.validateMethod('POST', '/api/fs/removeDir').ok, true);
  assert.deepEqual(policy.validateMethod('GET', '/api/fs/removeDir'), {
    ok: false,
    reason: 'method_not_allowed',
    allow: 'POST, OPTIONS',
  });
  assert.equal(policy.validateMethod('GET', '/health').ok, true);
  assert.equal(policy.validateMethod('GET', '/api/events').ok, true);
  assert.equal(policy.validateMethod('POST', '/api/events').ok, false);
});
