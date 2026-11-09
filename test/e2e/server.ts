import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import chatgptHandler from '../../dist/api/chatgpt.js';
import worker from '../../worker/src/index.js';

const PORT = Number(process.env.PORT || 4173);
const WORKER_PORT = Number(process.env.WORKER_PORT || 8787);
const DIST_ROOT = join(process.cwd(), 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8',
};

const FIXTURE_SHARE_ID = '6aa1d178-350c-83e9-a514-4cd6e6698087';

const FIXTURE_CONVERSATION = {
  title: 'Keystone Context Architecture',
  create_time: 1731168000,
  default_model_slug: 'gpt-4o',
  linear_conversation: [
    {
      message: {
        id: 'msg-user-1',
        author: { role: 'user' },
        create_time: 1731168001,
        content: { parts: ['Explain the Keystone context protocol for AI agents.'] },
      },
    },
    {
      message: {
        id: 'msg-assistant-1',
        author: { role: 'assistant' },
        create_time: 1731168005,
        metadata: { model_slug: 'gpt-4o' },
        content: {
          parts: [
            'Keystone stores architectural decisions in co-located .stone.<id>.md files next to the code.',
          ],
        },
      },
    },
  ],
};

const originalFetch = globalThis.fetch;

/**
 * Intercepts outbound upstream calls during E2E tests so real proxy handlers run deterministically in CI.
 */
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;

  if (url === `https://chatgpt.com/backend-api/share/${FIXTURE_SHARE_ID}`) {
    return new Response(JSON.stringify(FIXTURE_CONVERSATION), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (url === `https://chatgpt.com/share/${FIXTURE_SHARE_ID}`) {
    const streamPayload = [
      'data',
      FIXTURE_CONVERSATION,
      { _0: 1 },
    ];
    const encoded = JSON.stringify(JSON.stringify(streamPayload)).slice(1, -1);
    const html = `<!DOCTYPE html><html><body><script>window.__reactRouterContext.streamController.enqueue("${encoded}");</script></body></html>`;
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (url.startsWith('https://chatgpt.com/')) {
    return new Response('Not Found', { status: 404 });
  }

  const keyFileMatch = url.match(/^https:\/\/example\.com\/([a-f0-9]{8,32})\.txt$/i);
  if (keyFileMatch) {
    return new Response(keyFileMatch[1], {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (url === 'https://example.com/sitemap.xml') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/docs</loc></url>
</urlset>`;
    return new Response(xml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }

  if (url === 'https://api.indexnow.org/indexnow') {
    return new Response(JSON.stringify({ status: 'ok', submitted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return originalFetch(input, init);
};

/**
 * Reads the request body from a Node IncomingMessage into a Buffer.
 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Converts a Node IncomingMessage into a Web Standard Request.
 */
async function toWebRequest(req: IncomingMessage, baseOrigin: string): Promise<Request> {
  const url = new URL(req.url || '/', baseOrigin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      headers.set(k, v.join(', '));
    } else if (typeof v === 'string') {
      headers.set(k, v);
    }
  }
  const method = req.method || 'GET';
  const body = method !== 'GET' && method !== 'HEAD' ? await readBody(req) : undefined;
  return new Request(url.toString(), {
    method,
    headers,
    body: body && body.length > 0 ? new Uint8Array(body) : undefined,
  });
}

/**
 * Writes a Web Standard Response to a Node ServerResponse.
 */
async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((val, key) => {
    res.setHeader(key, val);
  });
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

const frontendServer = createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

    if (parsedUrl.pathname.startsWith('/api/chatgpt')) {
      const webReq = await toWebRequest(req, `http://127.0.0.1:${PORT}`);
      const webRes = await (chatgptHandler as (r: Request) => Promise<Response>)(webReq);
      await sendWebResponse(res, webRes);
      return;
    }

    const safeRelPath = normalize(parsedUrl.pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    let candidate = join(DIST_ROOT, safeRelPath);

    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      candidate = join(candidate, 'index.html');
    } else if (!existsSync(candidate) && existsSync(`${candidate}.html`)) {
      candidate = `${candidate}.html`;
    } else if (!existsSync(candidate) && existsSync(join(candidate, 'index.html'))) {
      candidate = join(candidate, 'index.html');
    }

    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const ext = extname(candidate).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.end(readFileSync(candidate));
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  } catch (err) {
    res.statusCode = 500;
    res.end(err instanceof Error ? err.message : String(err));
  }
});

const workerServer = createServer(async (req, res) => {
  try {
    const webReq = await toWebRequest(req, `http://127.0.0.1:${WORKER_PORT}`);
    const webRes = await worker.fetch(webReq, {});
    await sendWebResponse(res, webRes);
  } catch (err) {
    res.statusCode = 500;
    res.end(err instanceof Error ? err.message : String(err));
  }
});

workerServer.on('error', () => {
  // Ignore if port 8787 is already bound by another instance
});
workerServer.listen(WORKER_PORT, '127.0.0.1');

frontendServer.listen(PORT, '127.0.0.1', () => {
  console.log(`E2E server listening on http://127.0.0.1:${PORT} (worker on :${WORKER_PORT})`);
});
