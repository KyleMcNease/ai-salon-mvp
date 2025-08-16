// src/app/api/chat/route.ts (provider-aware, robust streaming)
import { getAdapter } from '../../../lib/adapters';
import type { Msg } from '../../../lib/adapters/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  } as Record<string, string>;
}

function isAsyncIterable(v: any): v is AsyncIterable<string> {
  return v && typeof v[Symbol.asyncIterator] === 'function';
}

// Normalize adapter output (AsyncIterable<string> | Promise<...> | string) into AsyncIterable<string>
function toAsyncIterable(out: unknown): AsyncIterable<string> {
  return (async function* () {
    const val = await out as any; // handles Promise-wrapped results
    if (isAsyncIterable(val)) {
      for await (const tok of val) {
        if (tok != null) yield String(tok);
      }
      return;
    }
    if (val != null) yield String(val);
  })();
}

async function streamAdapter(messages: Msg[], provider?: string, model?: string) {
  const adapter = getAdapter(provider);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', provider })}\n\n`));
      try {
        const out = adapter.complete({ messages, stream: true, model });
        const iter = toAsyncIterable(out);
        for await (const tok of iter) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', tok })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (err: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err?.message || err) })}\n\n`));
      } finally {
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

// --- Handlers ---
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const prompt = String(body?.prompt || '').trim();
    const stream = body?.stream ?? true;
    const provider = (String(body?.provider || '').trim() || undefined) as string | undefined;
    const model = (body?.model as string | undefined) || undefined;
    if (!prompt) return json({ error: "Missing 'prompt' in body" }, 400);

    const messages: Msg[] = [{ role: 'user', content: prompt }];

    if (stream) return streamAdapter(messages, provider, model);

    const adapter = getAdapter(provider);
    const text = await adapter.complete({ messages, stream: false, model });
    return json({ reply: String(text || ''), provider, model });
  } catch (err: any) {
    console.error('POST /api/chat error:', err?.message || err);
    return json({ error: 'Internal error' }, 500);
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const prompt = (url.searchParams.get('prompt') || '').trim();
    const stream = url.searchParams.get('stream') === '1';
    const provider = (url.searchParams.get('provider') || undefined) as string | undefined;
    const model = (url.searchParams.get('model') || undefined) as string | undefined;
    if (!prompt) return json({ error: 'Missing ?prompt' }, 400);

    const messages: Msg[] = [{ role: 'user', content: prompt }];

    if (stream) return streamAdapter(messages, provider, model);

    const adapter = getAdapter(provider);
    const text = await adapter.complete({ messages, stream: false, model });
    return json({ reply: String(text || ''), provider, model, via: 'GET' });
  } catch (err: any) {
    console.error('GET /api/chat error:', err?.message || err);
    return json({ error: 'Internal error' }, 500);
  }
}

