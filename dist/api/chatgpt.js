/**
 * Extracts a UUID v4 share identifier from a raw URL or string.
 * @param {unknown} input Raw share URL or UUID string.
 * @returns {string | null} Extracted UUID v4 string or null if invalid.
 */
function extractShareId(input) {
  if (!input) return null;
  const match = String(input).match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  return match ? match[1] : null;
}

/**
 * Decodes React Router Turbo Stream payload embedded in ChatGPT SSR HTML.
 * @param {string} html Raw HTML string from a ChatGPT share page.
 * @returns {Record<string, unknown> | null} Extracted conversation data object or null.
 */
function parseTurboStream(html) {
  const match = html.match(/window\.__reactRouterContext\.streamController\.enqueue\("((?:\\.|[^"])*)"\)/);
  if (!match) return null;

  try {
    const rawJson = /** @type {string} */ (JSON.parse('"' + match[1] + '"'));
    const parsed = /** @type {unknown} */ (JSON.parse(rawJson));
    if (!Array.isArray(parsed)) return null;
    const stream = /** @type {unknown[]} */ (parsed);

    /** @type {Map<number, unknown>} */
    const cache = new Map();

    /**
     * Recursively resolves flattened index references inside a Turbo Stream array.
     * @param {number} idx Array index to resolve.
     * @param {number} [depth] Current recursion depth.
     * @returns {unknown} Unflattened value.
     */
    function unflatten(idx, depth = 0) {
      if (idx < 0 || idx >= stream.length || depth > 30) return null;
      if (cache.has(idx)) return cache.get(idx);
      const val = stream[idx];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        /** @type {Record<string, unknown>} */
        const res = {};
        cache.set(idx, res);
        for (const [k, v] of Object.entries(val)) {
          if (k.startsWith('_')) {
            const keyIdx = parseInt(k.slice(1), 10);
            const realKey = keyIdx >= 0 && keyIdx < stream.length ? String(stream[keyIdx]) : k;
            res[realKey] = typeof v === 'number' && v >= 0 ? unflatten(v, depth + 1) : v;
          } else {
            res[k] = typeof v === 'number' && v >= 0 ? unflatten(v, depth + 1) : v;
          }
        }
        return res;
      } else if (Array.isArray(val)) {
        /** @type {unknown[]} */
        const res = [];
        cache.set(idx, res);
        for (const x of val) {
          res.push(typeof x === 'number' && x >= 0 ? unflatten(x, depth + 1) : x);
        }
        return res;
      }
      return val;
    }

    // Direct check on frequent data container indices
    for (const testIdx of [8, 12, 11, 10, 13]) {
      const serverResponse = /** @type {Record<string, any> | null} */ (unflatten(testIdx));
      if (serverResponse && serverResponse.data && (serverResponse.data.linear_conversation || serverResponse.data.mapping)) {
        return /** @type {Record<string, unknown>} */ (serverResponse.data);
      }
      if (serverResponse && (serverResponse.linear_conversation || serverResponse.mapping)) {
        return /** @type {Record<string, unknown>} */ (serverResponse);
      }
    }

    // Secondary scan across elements
    for (let i = 0; i < Math.min(parsed.length, 100); i++) {
      const item = /** @type {Record<string, any> | null} */ (unflatten(i));
      if (item && typeof item === 'object') {
        if (item.serverResponse?.data && (item.serverResponse.data.linear_conversation || item.serverResponse.data.mapping)) {
          return /** @type {Record<string, unknown>} */ (item.serverResponse.data);
        }
        if (item.data && (item.data.linear_conversation || item.data.mapping)) {
          return /** @type {Record<string, unknown>} */ (item.data);
        }
        if (item.linear_conversation || item.mapping) {
          return /** @type {Record<string, unknown>} */ (item);
        }
      }
    }
  } catch {
    // Ignore malformed JSON payloads and return null
  }

  return null;
}

/**
 * Fetches a shared ChatGPT conversation using SSR HTML profiles and backend API fallback.
 * @param {string} shareId Validated UUID v4 share ID.
 * @returns {Promise<{success: boolean, data?: Record<string, unknown>, status?: number, error?: string, details?: Array<Record<string, unknown>>}>} Fetch result.
 */
async function fetchConversation(shareId) {
  /** @type {Array<{name: string, headers: Record<string, string>}>} */
  const browserProfiles = [
    {
      name: 'Chrome Desktop',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    },
    {
      name: 'Googlebot',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
    {
      name: 'FacebookExternalHit',
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
  ];

  /** @type {Array<Record<string, unknown>>} */
  const attempts = [];

  // Strategy 1: Iterate SSR HTML fetching with browser and verified crawler headers
  for (const profile of browserProfiles) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const htmlRes = await fetch(`https://chatgpt.com/share/${shareId}`, {
        signal: controller.signal,
        headers: profile.headers,
      });
      clearTimeout(timeout);

      const status = htmlRes.status;
      if (htmlRes.ok) {
        const htmlText = await htmlRes.text();
        const extracted = parseTurboStream(htmlText);
        if (extracted && (extracted.linear_conversation || extracted.mapping)) {
          return { success: true, data: extracted };
        }
        attempts.push({ profile: profile.name, status, streamParsed: false, htmlLen: htmlText.length });
      } else {
        attempts.push({ profile: profile.name, status });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ profile: profile.name, error: message });
    }
  }

  // Strategy 2: Direct backend-api fallback
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const apiRes = await fetch(`https://chatgpt.com/backend-api/share/${shareId}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timeout);

    if (apiRes.ok) {
      const data = /** @type {Record<string, unknown>} */ (await apiRes.json());
      if (data && (data.linear_conversation || data.mapping)) {
        return { success: true, data };
      }
    }
    attempts.push({ apiStatus: apiRes.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    attempts.push({ apiError: message });
  }

  return { success: false, status: 404, error: 'Could not extract conversation data from share link.', details: attempts };
}

/**
 * Writes a JSON response to a Node.js or Express/Vercel ServerResponse object.
 * @param {Record<string, any>} res Node/Vercel response object.
 * @param {number} statusCode HTTP status code.
 * @param {unknown} data JSON-serializable payload.
 * @param {Record<string, string>} [headers] Optional HTTP response headers.
 * @returns {unknown} Response result.
 */
function sendNodeJson(res, statusCode, data, headers = {}) {
  for (const [key, val] of Object.entries(headers)) {
    if (typeof res.setHeader === 'function') {
      res.setHeader(key, val);
    }
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(data);
  }
  res.statusCode = statusCode;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }
  return res.end(JSON.stringify(data));
}

/**
 * Handles Node.js `(req, res)` serverless invocation.
 * @param {Record<string, any>} req Node/Vercel request object.
 * @param {Record<string, any>} res Node/Vercel response object.
 * @returns {Promise<unknown>} Response completion.
 */
async function handleNode(req, res) {
  /** @type {Record<string, string>} */
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  for (const [key, val] of Object.entries(corsHeaders)) {
    if (typeof res.setHeader === 'function') {
      res.setHeader(key, val);
    }
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  /** @type {unknown} */
  let shareParam = null;
  if (req.query && typeof req.query === 'object') {
    shareParam = req.query.shareId || req.query.url;
  }
  if (!shareParam && req.url) {
    try {
      const parsedUrl = new URL(String(req.url), 'http://localhost');
      shareParam = parsedUrl.searchParams.get('shareId') || parsedUrl.searchParams.get('url');
    } catch {
      // Ignore invalid relative URL
    }
  }
  if (!shareParam && req.body && typeof req.body === 'object') {
    shareParam = req.body.shareId || req.body.url;
  }

  const shareId = extractShareId(shareParam);
  if (!shareId) {
    return sendNodeJson(res, 400, { error: 'Invalid or missing shareId UUID.' });
  }

  const result = await fetchConversation(shareId);
  if (result.success) {
    return sendNodeJson(res, 200, result.data, {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    });
  }

  return sendNodeJson(res, result.status || 500, {
    error: result.error || 'Failed to fetch conversation.',
    details: result.details,
  });
}

/**
 * Handles Web Standard Fetch `Request` invocation (Edge / Bun.serve).
 * @param {Request} request Incoming Web Standard Request.
 * @returns {Promise<Response>} Web Standard Response.
 */
async function handleEdge(request) {
  /** @type {Record<string, string>} */
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url, 'http://localhost');
  /** @type {unknown} */
  let shareParam = url.searchParams.get('shareId') || url.searchParams.get('url');

  if (!shareParam && request.method === 'POST') {
    try {
      const body = /** @type {Record<string, unknown>} */ (await request.json());
      shareParam = body.shareId || body.url;
    } catch {
      // Ignore malformed JSON body
    }
  }

  const shareId = extractShareId(shareParam);
  if (!shareId) {
    return new Response(JSON.stringify({ error: 'Invalid or missing shareId UUID.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const result = await fetchConversation(shareId);
  if (result.success) {
    return new Response(JSON.stringify(result.data), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  }

  return new Response(JSON.stringify({ error: result.error || 'Failed to fetch conversation.', details: result.details }), {
    status: result.status || 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Universal serverless entrypoint compatible with both Vercel Node.js and Web Fetch runtimes.
 * @param {Request | Record<string, any>} request Incoming request.
 * @param {Record<string, any>} [response] Optional Node response object.
 * @returns {Promise<unknown>} Handler response.
 */
async function handler(request, response) {
  try {
    if (response != null) {
      return await handleNode(/** @type {Record<string, any>} */ (request), response);
    }
    return await handleEdge(/** @type {Request} */ (request));
  } catch (fatalErr) {
    const message = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    if (response != null) {
      return sendNodeJson(response, 500, { error: `Server error: ${message}` });
    }
    return new Response(JSON.stringify({ error: `Server error: ${message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

handler.extractShareId = extractShareId;
handler.parseTurboStream = parseTurboStream;
handler.fetchConversation = fetchConversation;
handler.handleNode = handleNode;
handler.handleEdge = handleEdge;

module.exports = handler;
module.exports.default = handler;
