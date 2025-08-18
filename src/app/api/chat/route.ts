// src/app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { adapters } from '@/lib/adapters';

export const runtime = 'edge';

function toAsyncIterable(stream: any): AsyncIterable<Uint8Array> {
  // If already an async iterable, just return it
  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    return stream as AsyncIterable<Uint8Array>;
  }

  // If it's a Response body (ReadableStream), wrap it
  if (stream && typeof (stream as any).getReader === 'function') {
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
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

  // If it's a plain string, yield it
  if (typeof stream === 'string') {
    return {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode(stream);
      },
    };
  }

  // Fallback: nothing to stream
  return {
    async *[Symbol.asyncIterator]() {},
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get('prompt') || '';
  const provider = searchParams.get('provider') || 'gpt';
  const stream = searchParams.get('stream') === '1';

  const adapter = adapters[provider];
  if (!adapter) {
    return new Response(`Unknown provider: ${provider}`, { status: 400 });
  }

  try {
    if (stream) {
      const raw = await adapter({ prompt, stream: true });
      const iterable = toAsyncIterable(raw);

      const encoder = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          for await (const chunk of iterable) {
            controller.enqueue(
              typeof chunk === 'string'
                ? encoder.encode(`data: ${chunk}\n\n`)
                : chunk
            );
          }
          controller.close();
        },
      });

      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    } else {
      const result = await adapter({ prompt, stream: false });
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err: any) {
    console.error(err);
    return new Response(`Error: ${err.message || String(err)}`, { status: 500 });
  }
}

