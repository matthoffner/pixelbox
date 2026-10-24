const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { extractPageSummary, probeUrl, validateProbeUrl } = require('../lib/previewProbe');

test('extractPageSummary pulls compact title and h1 text', () => {
  assert.deepEqual(
    extractPageSummary('<title>Alpha &amp; Beta</title><main><h1>Launch <em>Board</em></h1></main>'),
    {
      title: 'Alpha & Beta',
      heading: 'Launch Board',
    }
  );
});

test('validateProbeUrl rejects non-http protocols', () => {
  assert.throws(() => validateProbeUrl('file:///tmp/demo.html'), /HTTP and HTTPS/);
});

test('probeUrl reports status, latency, and page summary', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Probe Demo</title><h1>Live Check Works</h1>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const result = await probeUrl(`http://127.0.0.1:${port}`);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.title, 'Probe Demo');
    assert.equal(result.heading, 'Live Check Works');
    assert.equal(result.contentType, 'text/html; charset=utf-8');
    assert.equal(typeof result.latencyMs, 'number');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('probeUrl retries transient connection failures', async () => {
  let calls = 0;
  const result = await probeUrl('http://127.0.0.1:4173', {
    attempts: 2,
    retryDelayMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('fetch failed');
      }
      return new Response('<title>Recovered</title><h1>Ready</h1>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.title, 'Recovered');
  assert.equal(result.attempts, 2);
});
