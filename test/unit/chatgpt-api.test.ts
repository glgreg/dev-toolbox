import { afterEach, describe, expect, it, vi } from 'vitest';
import chatgptHandler from '../../dist/api/chatgpt.js';

interface ChatGptHandlerModule {
  (req: Request | Record<string, unknown>, res?: Record<string, unknown>): Promise<Response | unknown>;
  extractShareId: (input: unknown) => string | null;
  parseTurboStream: (html: string) => Record<string, unknown> | null;
  fetchConversation: (shareId: string) => Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    status?: number;
    error?: string;
    details?: Array<Record<string, unknown>>;
  }>;
  handleNode: (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<unknown>;
  handleEdge: (req: Request) => Promise<Response>;
}

const api = chatgptHandler as unknown as ChatGptHandlerModule;
const VALID_UUID = '6aa1d178-350c-83e9-a514-4cd6e6698087';

/**
 * Builds a minimal React Router Turbo Stream HTML page embedding the provided payload.
 */
function buildTurboStreamHtml(payload: unknown[]): string {
  const innerJson = JSON.stringify(payload);
  const escaped = JSON.stringify(innerJson).slice(1, -1);
  return `<!DOCTYPE html><html><body><script>window.__reactRouterContext.streamController.enqueue("${escaped}");</script></body></html>`;
}

describe('ChatGPT Serverless Proxy (dist/api/chatgpt.js)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extractShareId validates UUID v4 from URLs and raw strings', () => {
    expect(api.extractShareId(`https://chatgpt.com/share/${VALID_UUID}`)).toBe(VALID_UUID);
    expect(api.extractShareId(VALID_UUID.toUpperCase())).toBe(VALID_UUID.toUpperCase());
    expect(api.extractShareId('https://chatgpt.com/share/not-a-uuid')).toBeNull();
    expect(api.extractShareId('')).toBeNull();
    expect(api.extractShareId(null)).toBeNull();
  });

  it('parseTurboStream decodes flattened React Router stream payloads', () => {
    const streamArray = [
      'root',
      'data',
      'title',
      'Keystone Architecture',
      'linear_conversation',
      [{ message: { id: 'm1', author: { role: 'user' }, content: { parts: ['Hello'] } } }],
      { _2: 3, _4: 5 },
      'unrelated',
      { _1: 6 },
    ];
    const html = buildTurboStreamHtml(streamArray);
    const parsed = api.parseTurboStream(html);

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('Keystone Architecture');
    expect(Array.isArray(parsed?.linear_conversation)).toBe(true);
  });

  it('parseTurboStream returns null on HTML without stream or malformed JSON', () => {
    expect(api.parseTurboStream('<html><body>No stream</body></html>')).toBeNull();
    expect(api.parseTurboStream('window.__reactRouterContext.streamController.enqueue("not-json")')).toBeNull();
  });

  it('handleEdge responds to OPTIONS preflight and rejects invalid UUIDs with 400', async () => {
    const preflight = await api(new Request('http://localhost/api/chatgpt', { method: 'OPTIONS' })) as Response;
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const badReq = await api(new Request('http://localhost/api/chatgpt?shareId=invalid')) as Response;
    expect(badReq.status).toBe(400);
    const body = await badReq.json() as { error: string };
    expect(body.error).toContain('Invalid or missing shareId UUID');
  });

  it('handleEdge falls back to backend-api when SSR HTML fails and returns 200 with Cache-Control', async () => {
    const mockConversation = {
      title: 'Test Share',
      linear_conversation: [
        { message: { id: '1', author: { role: 'user' }, content: { parts: ['Prompt'] } } },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/backend-api/share/')) {
        return new Response(JSON.stringify(mockConversation), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Forbidden', { status: 403 });
    });

    const res = await api(
      new Request(`http://localhost/api/chatgpt?shareId=${VALID_UUID}`, { method: 'GET' }),
    ) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
    const data = await res.json() as { title: string };
    expect(data.title).toBe('Test Share');
  });

  it('handleNode supports Vercel/Node (req, res) invocations', async () => {
    const mockConversation = {
      title: 'Node Handler Chat',
      mapping: { node1: { message: null } },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        buildTurboStreamHtml([
          'title',
          'Node Handler Chat',
          'mapping',
          mockConversation.mapping,
          { _0: 1, _2: 3 },
        ]),
        { status: 200 },
      ),
    );

    const headers: Record<string, string> = {};
    let statusCode = 0;
    let payload: unknown = null;

    const req = {
      method: 'GET',
      query: { shareId: VALID_UUID },
    };
    const res = {
      setHeader(k: string, v: string) {
        headers[k] = v;
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: unknown) {
        payload = data;
        return this;
      },
    };

    await api(req, res);
    expect(statusCode).toBe(200);
    expect(headers['Cache-Control']).toContain('s-maxage=3600');
    expect((payload as { title: string }).title).toBe('Node Handler Chat');
  });
});
