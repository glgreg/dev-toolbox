/**
 * Cloudflare Worker for dev.gregorium.com IndexNow and ChatGPT Share Exporter tools.
 * Handles:
 *  - CORS Preflight (OPTIONS) and Response headers.
 *  - Key hosting pre-verification proxy.
 *  - Sitemap XML loader proxy (with size limits).
 *  - IndexNow URL submission proxy.
 *  - ChatGPT Share Exporter fallback proxy.
 *  - IP-based rate limiting on submit/sitemap/chatgpt_share using Cloudflare KV.
 */

/**
 * @typedef {object} KVNamespaceLike
 * @property {(key: string) => Promise<string | null>} get Fetches a value from KV.
 * @property {(key: string, value: string, options?: {expirationTtl?: number}) => Promise<void>} put Stores a value in KV.
 */

/**
 * @typedef {object} WorkerEnv
 * @property {KVNamespaceLike} [DEV_INDEXNOW_KV] Cloudflare KV namespace binding for rate limiting.
 */

const worker = {
  /**
   * Main Cloudflare Worker fetch handler.
   * @param {Request} request Incoming HTTP request.
   * @param {WorkerEnv} [env] Worker environment bindings.
   * @returns {Promise<Response>} HTTP response.
   */
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    // 1. CORS Headers Builder
    /** @type {Record<string, string>} */
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400', // 24 hours preflight cache
    };

    // Respond to CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Allow GET and POST requests for logic
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed. Use GET or POST.' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const action = url.searchParams.get('action');
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Parse request body JSON if POST
    /** @type {Record<string, any>} */
    let body = {};
    if (request.method === 'POST') {
      try {
        body = /** @type {Record<string, any>} */ (await request.json());
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON payload.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ==========================================
    // Action: KEY VERIFICATION PROXY
    // ==========================================
    if (action === 'verify') {
      const { key, keyLocation } = body;
      if (!key || !keyLocation) {
        return new Response(JSON.stringify({ error: 'Missing key or keyLocation' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const response = await fetch(String(keyLocation), {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          return new Response(JSON.stringify({
            success: false,
            error: `Verification file unreachable. Status: ${response.status} ${response.statusText}`,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const bodyText = (await response.text()).trim();
        const targetKey = String(key).trim();

        if (bodyText === targetKey) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else {
          const truncatedContent = bodyText.substring(0, 100);
          return new Response(JSON.stringify({
            success: false,
            error: `Key mismatch. The file at keyLocation contains "${truncatedContent}..." instead of "${targetKey}".`,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const message = err instanceof Error ? err.message : String(err);
        const errorMsg = isAbort ? 'Connection timed out (5s)' : message;
        return new Response(JSON.stringify({
          success: false,
          error: `Could not reach verification URL: ${errorMsg}`,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ==========================================
    // Action: XML SITEMAP LOADER (CORS Proxy)
    // ==========================================
    else if (action === 'sitemap') {
      const { sitemapUrl } = body;
      if (!sitemapUrl) {
        return new Response(JSON.stringify({ error: 'Missing sitemapUrl' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // KV Rate Limiter for Sitemaps: Max 500 fetches per IP per day (86400s) + 2s cooldown
      const sitemapLimitKey = `rate_sitemap_${clientIp}`;
      const limitResult = await enforceRateLimit(env.DEV_INDEXNOW_KV, sitemapLimitKey, 500, 86400);
      if (limitResult.limited) {
        const errorMsg = limitResult.reason === 'cooldown'
          ? 'Too many requests. Please wait at least 2 seconds between requests.'
          : 'Daily limit exceeded: Max 500 sitemap fetches per day.';
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

        const response = await fetch(String(sitemapUrl), {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          return new Response(JSON.stringify({ error: `Sitemap file unreachable. Status: ${response.status}` }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const bodyText = await response.text();
        if (bodyText.length > 2 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'Sitemap size limits exceeded (Max: 2MB).' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(bodyText, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const message = err instanceof Error ? err.message : String(err);
        const errorMsg = isAbort ? 'Connection timed out (8s)' : message;
        return new Response(JSON.stringify({ error: `Could not fetch sitemap: ${errorMsg}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ==========================================
    // Action: INDEXNOW SUBMIT PROXY
    // ==========================================
    else if (action === 'submit') {
      const { host, key, keyLocation, urlList } = body;
      if (!host || !key || !urlList || !Array.isArray(urlList)) {
        return new Response(JSON.stringify({ error: 'Missing required parameters: host, key, and urlList' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (urlList.length === 0) {
        return new Response(JSON.stringify({ error: 'urlList must contain at least one URL.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // KV Rate Limiter for Submissions: Max 500 submissions per IP per day (86400s) + 2s cooldown
      const submitLimitKey = `rate_submit_${clientIp}`;
      const limitResult = await enforceRateLimit(env.DEV_INDEXNOW_KV, submitLimitKey, 500, 86400);
      if (limitResult.limited) {
        const errorMsg = limitResult.reason === 'cooldown'
          ? 'Too many requests. Please wait at least 2 seconds between requests.'
          : 'Daily limit exceeded: Max 500 index submissions per day.';
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      /** @type {Record<string, unknown>} */
      const payload = { host, key, urlList };
      if (keyLocation) {
        payload.keyLocation = keyLocation;
      }

      const endpoints = [
        'https://api.indexnow.org/indexnow',
        'https://www.bing.com/indexnow',
        'https://yandex.com/indexnow',
      ];

      /** @type {Record<string, unknown> | null} */
      let lastResponse = null;
      let lastStatus = 500;
      /** @type {string | null} */
      let lastError = null;

      for (const endpoint of endpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout per endpoint

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          lastStatus = response.status;
          const responseText = await response.text();

          try {
            lastResponse = /** @type {Record<string, unknown>} */ (JSON.parse(responseText));
          } catch {
            lastResponse = { message: responseText || `Status ${response.status} received` };
          }

          // If successful (200 or 202), we stop and return immediately!
          if (response.status === 200 || response.status === 202) {
            lastResponse.engineVerified = endpoint;
            return new Response(JSON.stringify(lastResponse), {
              status: response.status,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          console.warn(`Endpoint ${endpoint} failed with status ${response.status}. Trying next...`);
        } catch (err) {
          const isAbort = err instanceof Error && err.name === 'AbortError';
          const message = err instanceof Error ? err.message : String(err);
          lastError = isAbort ? 'Request timed out (8s)' : message;
          console.error(`Endpoint ${endpoint} failed: ${lastError}. Trying next...`);
        }
      }

      // If all endpoints failed, return the last response or error
      const errorPayload = lastResponse || { error: lastError || 'All IndexNow endpoints failed.' };
      return new Response(JSON.stringify(errorPayload), {
        status: lastStatus,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // Action: CHATGPT SHARE EXPORTER PROXY
    // ==========================================
    else if (action === 'chatgpt_share') {
      let shareId = body.shareId || url.searchParams.get('shareId');
      const shareUrl = body.url || url.searchParams.get('url');

      if (!shareId && shareUrl) {
        const match = String(shareUrl).match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (match) {
          shareId = match[1];
        }
      }

      // Strict UUID validation to prevent SSRF
      const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      if (!shareId || !uuidRegex.test(String(shareId))) {
        return new Response(JSON.stringify({ error: 'Invalid or missing shareId UUID.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // KV Rate Limiter: Max 500 exports per IP per day + 2s cooldown
      const chatgptLimitKey = `rate_chatgpt_${clientIp}`;
      const limitResult = await enforceRateLimit(env.DEV_INDEXNOW_KV, chatgptLimitKey, 500, 86400);
      if (limitResult.limited) {
        const errorMsg = limitResult.reason === 'cooldown'
          ? 'Too many requests. Please wait at least 2 seconds between requests.'
          : 'Daily limit exceeded: Max 500 chat exports per day.';
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        // Attempt 1: Direct backend-api
        const targetApiUrl = `https://chatgpt.com/backend-api/share/${shareId}`;
        const response = await fetch(targetApiUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = /** @type {Record<string, unknown>} */ (await response.json());
          if (data && (data.linear_conversation || data.mapping)) {
            clearTimeout(timeoutId);
            return new Response(JSON.stringify(data), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        // Attempt 2: SSR HTML stream parsing
        const htmlRes = await fetch(`https://chatgpt.com/share/${shareId}`, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Twitterbot/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        clearTimeout(timeoutId);

        if (htmlRes.ok) {
          const htmlText = await htmlRes.text();
          const extracted = parseTurboStream(htmlText);
          if (extracted && (extracted.linear_conversation || extracted.mapping)) {
            return new Response(JSON.stringify(extracted), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        return new Response(JSON.stringify({
          error: `ChatGPT returned HTTP ${htmlRes.status || response.status}. The share link may be private or deleted.`,
        }), {
          status: htmlRes.status || response.status || 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const message = err instanceof Error ? err.message : String(err);
        const errorMsg = isAbort ? 'Connection timed out (10s)' : message;
        return new Response(JSON.stringify({ error: `Could not fetch conversation: ${errorMsg}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Default action fallback
    return new Response(JSON.stringify({ error: 'Invalid action parameter specified.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};

/**
 * Enforces rate limiting and cooldown periods on a specific key using KV store.
 * @param {KVNamespaceLike | undefined} kvNamespace The KV binding instance.
 * @param {string} key The unique limiter key (e.g. action + IP).
 * @param {number} maxCount Maximum allowed requests inside window.
 * @param {number} windowSeconds Timeframe in seconds.
 * @returns {Promise<{limited: boolean, reason: string | null}>} Result object.
 */
export async function enforceRateLimit(kvNamespace, key, maxCount, windowSeconds) {
  if (!kvNamespace) return { limited: false, reason: null }; // Fail open if KV is missing

  try {
    const rawRecord = await kvNamespace.get(key);
    let record = { count: 0, timestamp: Date.now(), lastActive: 0 };

    if (rawRecord) {
      record = /** @type {{count: number, timestamp: number, lastActive: number}} */ (JSON.parse(rawRecord));
    }

    const now = Date.now();

    // 1. Cooldown limit: Enforce at least 2 seconds between consecutive calls from the same IP
    const elapsedCooldown = now - record.lastActive;
    if (record.lastActive > 0 && elapsedCooldown < 2000) {
      return { limited: true, reason: 'cooldown' };
    }

    // 2. Rolling/Window Quota check
    const elapsedWindow = now - record.timestamp;
    if (elapsedWindow > windowSeconds * 1000) {
      // Window expired, reset counter and window start
      record.count = 1;
      record.timestamp = now;
    } else {
      // Within window
      if (record.count >= maxCount) {
        return { limited: true, reason: 'quota' };
      }
      record.count++;
    }

    // Update last active timestamp
    record.lastActive = now;

    // Save record back with matching TTL expiration
    await kvNamespace.put(key, JSON.stringify(record), {
      expirationTtl: Math.max(60, windowSeconds),
    });

    return { limited: false, reason: null };
  } catch (err) {
    console.error('Rate limiter error:', err);
    return { limited: false, reason: null }; // Fail open to keep service running
  }
}

/**
 * Parses React Router Turbo Stream payload embedded in SSR HTML.
 * @param {string} html Raw HTML content.
 * @returns {Record<string, unknown> | null} Extracted conversation data or null.
 */
export function parseTurboStream(html) {
  const match = html.match(/window\.__reactRouterContext\.streamController\.enqueue\("((?:\\.|[^"])*)"\)/);
  if (!match) return null;

  try {
    const rawJson = /** @type {string} */ (JSON.parse('"' + match[1] + '"'));
    const parsed = /** @type {unknown} */ (JSON.parse(rawJson));
    if (!Array.isArray(parsed)) return null;
    const stream = /** @type {unknown[]} */ (parsed);

    /**
     * Resolves flattened index references in the parsed stream array.
     * @param {number} idx Array index to resolve.
     * @param {number} [depth] Current recursion depth.
     * @returns {unknown} Unflattened value.
     */
    function unflatten(idx, depth = 0) {
      if (idx < 0 || idx >= stream.length || depth > 30) return null;
      const val = stream[idx];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        /** @type {Record<string, unknown>} */
        const res = {};
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
        return val.map((x) => (typeof x === 'number' && x >= 0 ? unflatten(x, depth + 1) : x));
      }
      return val;
    }

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
    // Ignore parse errors and return null
  }

  return null;
}

export default worker;
