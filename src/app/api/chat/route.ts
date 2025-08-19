// src/app/api/chat/route.ts
import type { NextRequest } from 'next/server';
import { adapters } from '@/lib/adapters';

export const runtime = 'edge';

// Normalize any provider output into an AsyncIterable<Uint8Array>
function toAsyncIterable(src: any): AsyncIterable<Uint8Array> {
  if (src && typeof src[Symbol.asyncIterator] === 'function') {
    return src as AsyncIterable<Uint8Array>;
  }
  if (src && typeof src.getReader === 'function') {
    const reader = (src as ReadableStream<Uint8Array>).getReader();
    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      },
    };
  }
  if (typeof src === 'string') {
    const enc = new TextEncoder();
    return {
      async *[Symbol.asyncIterator]() {
        yield enc.encode(src);
      },
    };
  }
  return { async *[Symbol.asyncIterator]() {} };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get('prompt') || '';
  const provider = (searchParams.get('provider') || 'gpt').toLowerCase();
  const stream = searchParams.get('stream') === '1';

  const adapter = adapters[provider];
  if (!adapter) {
    return new Response('Unknown provider: ' + provider, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
    });
  }

  try {
    if (stream) {
      // STREAMING: forward provider SSE verbatim (no extra "data:" prefixing)
      const raw = await adapter({ prompt, stream: true });
      const iterable = toAsyncIterable(raw);

      const body = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of iterable) {
              // Most providers (Anthropic/OpenAI/xAI) already emit SSE lines.
              // Pass chunks through unchanged to avoid "data: event: ..." corruption.
              controller.enqueue(
                chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk))
              );
            }
          } finally {
            controller.close();
          }
        },
      });

      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    // NON-STREAM: always return JSON { content: string }
    const result = await adapter({ prompt, stream: false });

    const content =
      typeof result === 'string'
        ? result
        : (result && typeof result === 'object' && 'content' in result)
        ? String((result as any).content ?? '')
        : (result && typeof result === 'object' && 'text' in result)
        ? String((result as any).text ?? '')
        : String(result ?? '');

    return Response.json({ content }, { status: 200 });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

