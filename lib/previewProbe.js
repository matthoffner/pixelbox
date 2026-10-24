function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function compactText(value, maxLength = 180) {
  const compact = decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractPageSummary(html) {
  const source = String(html || '');
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const heading = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  return {
    title: compactText(title, 120),
    heading: compactText(heading, 120),
  };
}

function validateProbeUrl(rawUrl) {
  const url = new URL(String(rawUrl || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Live Check only supports HTTP and HTTPS URLs.');
  }
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeUrlOnce(rawUrl, options = {}) {
  const url = validateProbeUrl(rawUrl);
  const timeoutMs = Number(options.timeoutMs) || 5000;
  const fetchImpl = options.fetchImpl || fetch;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = response.headers?.get?.('content-type') || '';
    let title = '';
    let heading = '';
    let bytes = 0;

    if (/^(text\/|application\/(json|xhtml\+xml))|html/i.test(contentType)) {
      const body = await response.text();
      bytes = Buffer.byteLength(body, 'utf8');
      if (/html/i.test(contentType) || /<html|<title|<h1/i.test(body)) {
        ({ title, heading } = extractPageSummary(body));
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || '',
      url: response.url || url,
      latencyMs: Date.now() - startedAt,
      contentType,
      title,
      heading,
      bytes,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error?.name === 'AbortError' ? 'Timed out' : (error?.message || 'Request failed'),
      url,
      latencyMs: Date.now() - startedAt,
      contentType: '',
      title: '',
      heading: '',
      bytes: 0,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeUrl(rawUrl, options = {}) {
  const attempts = Math.max(1, Math.min(10, Number(options.attempts) || 1));
  const retryDelayMs = Math.max(0, Math.min(2000, Number(options.retryDelayMs) || 250));
  let result;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await probeUrlOnce(rawUrl, options);
    if (result.status !== 0 || attempt === attempts) {
      return {
        ...result,
        attempts: attempt,
      };
    }
    await sleep(retryDelayMs);
  }

  return result;
}

module.exports = {
  compactText,
  extractPageSummary,
  probeUrl,
  probeUrlOnce,
  validateProbeUrl,
};
