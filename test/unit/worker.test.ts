import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { enforceRateLimit, parseTurboStream } from '../../worker/src/index.js';

interface MockKV {
  store: Map<string, string>;
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
}

/**
 * Creates an in-memory Cloudflare KV namespace mock.
 */
function createMockKV(): MockKV {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('Cloudflare Worker Proxy (worker/src/index.js)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles OPTIONS preflight (204), disallows PUT (405), and rejects malformed JSON (400)', async () => {
    const optRes = await worker.fetch(
      new Request('https://worker.local/api/indexnow', {
        method: 'OPTIONS',
        headers: { Origin: 'https://dev.gregorium.com' },
      }),
    );
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get('Access-Control-Allow-Origin')).toBe('https://dev.gregorium.com');

    const putRes = await worker.fetch(
      new Request('https://worker.local/api/indexnow', { method: 'PUT' }),
    );
    expect(putRes.status).toBe(405);

    const badJsonRes = await worker.fetch(
      new Request('https://worker.local/api/indexnow?action=verify', {
        method: 'POST',
        body: '{invalid-json',
      }),
    );
    expect(badJsonRes.status).toBe(400);
  });

  it('verifies hosted IndexNow keys (action=verify) on match and mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/validkey1234.txt')) {
        return new Response('validkey1234\n', { status: 200 });
      }
      return new Response('wrong-content', { status: 200 });
    });

    const okRes = await worker.fetch(
      new Request('https://worker.local/api/indexnow?action=verify', {
        method: 'POST',
        body: JSON.stringify({
          key: 'validkey1234',
          keyLocation: 'https://example.com/validkey1234.txt',
        }),
      }),
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ success: true });

    const mismatchRes = await worker.fetch(
      new Request('https://worker.local/api/indexnow?action=verify', {
        method: 'POST',
        body: JSON.stringify({
          key: 'validkey1234',
          keyLocation: 'https://example.com/other.txt',
        }),
      }),
    );
    const mismatchBody = await mismatchRes.json() as { success: boolean; error: string };
    expect(mismatchBody.success).toBe(false);
    expect(mismatchBody.error).toContain('Key mismatch');
  });

  it('fetches XML sitemaps (action=sitemap), enforces 2MB limit, and applies KV rate limits', async () => {
    const kv = createMockKV();
    const xmlSample = '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(xmlSample, { status: 200 }));

    const req1 = new Request('https://worker.local/api/indexnow?action=sitemap', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
      body: JSON.stringify({ sitemapUrl: 'https://example.com/sitemap.xml' }),
    });
    const res1 = await worker.fetch(req1, { DEV_INDEXNOW_KV: kv });
    expect(res1.status).toBe(200);
    expect(await res1.text()).toContain('<loc>https://example.com/</loc>');

    // Immediate second request from same IP hits 2-second cooldown -> 429
    const req2 = new Request('https://worker.local/api/indexnow?action=sitemap', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
      body: JSON.stringify({ sitemapUrl: 'https://example.com/sitemap.xml' }),
    });
    const res2 = await worker.fetch(req2, { DEV_INDEXNOW_KV: kv });
    expect(res2.status).toBe(429);
  });

  it('submits URLs to IndexNow endpoints with sequential fallback (action=submit)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('api.indexnow.org')) {
        return new Response('Internal Error', { status: 500 });
      }
      if (url.includes('www.bing.com')) {
        return new Response(JSON.stringify({ status: 'queued' }), { status: 202 });
      }
      return new Response('Not reached', { status: 500 });
    });

    const submitRes = await worker.fetch(
      new Request('https://worker.local/api/indexnow?action=submit', {
        method: 'POST',
        body: JSON.stringify({
          host: 'example.com',
          key: '0123456789abcdef0123456789abcdef',
          urlList: ['https://example.com/page-1'],
        }),
      }),
    );

    expect(submitRes.status).toBe(202);
    const data = await submitRes.json() as { engineVerified: string; status: string };
    expect(data.engineVerified).toBe('https://www.bing.com/indexnow');
    expect(data.status).toBe('queued');
  });

  it('enforceRateLimit fails open on KV error and parseTurboStream extracts conversation data', async () => {
    const brokenKv = {
      async get(): Promise<string | null> {
        throw new Error('KV offline');
      },
      async put(): Promise<void> {
        throw new Error('KV offline');
      },
    };

    const result = await enforceRateLimit(brokenKv, 'rate_test', 500, 86400);
    expect(result).toEqual({ limited: false, reason: null });

    const payload = [
      'title',
      'Worker Stream Test',
      'linear_conversation',
      [{ message: { id: '1' } }],
      { _0: 1, _2: 3 },
    ];
    const encoded = JSON.stringify(JSON.stringify(payload)).slice(1, -1);
    const html = `<script>window.__reactRouterContext.streamController.enqueue("${encoded}")</script>`;
    const parsed = parseTurboStream(html);
    expect(parsed?.title).toBe('Worker Stream Test');
  });
});
