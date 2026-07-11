const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizePathPart,
  snapshotRelativePath,
  snapshotTimestamp,
  validateSnapshotUrl,
} = require('../lib/previewSnapshot');

test('validateSnapshotUrl rejects non-http protocols', () => {
  assert.throws(() => validateSnapshotUrl('file:///tmp/demo.html'), /HTTP and HTTPS/);
});

test('snapshotRelativePath stores root snapshots under .pixelbox', () => {
  const date = new Date('2026-07-11T04:33:00.000Z');
  assert.equal(
    snapshotRelativePath('.', date),
    '.pixelbox/proof-snapshots/proof-2026-07-11T04-33-00Z.png'
  );
});

test('snapshotRelativePath stores project snapshots inside the project', () => {
  const date = new Date('2026-07-11T04:33:00.000Z');
  assert.equal(
    snapshotRelativePath('projects/demo', date),
    'projects/demo/.pixelbox/proof-snapshots/proof-2026-07-11T04-33-00Z.png'
  );
});

test('snapshotTimestamp is filename-safe', () => {
  assert.equal(snapshotTimestamp(new Date('2026-07-11T04:33:01.234Z')), '2026-07-11T04-33-01Z');
});

test('sanitizePathPart creates compact path segments', () => {
  assert.equal(sanitizePathPart('projects/My App!'), 'projects-My-App');
  assert.equal(sanitizePathPart(''), 'workspace');
});
