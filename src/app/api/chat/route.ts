// src/app/api/chat/route.ts
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';

import { adapters } from '@/lib/adapters';
import { MemoryServiceClient } from '@/lib/memoryService';
import { deriveScope, isLocalSafeScope, SAFE_MODE_PROVIDER } from '@/config/safeMode';

export const runtime = 'nodejs';

type ChatRequest = {
  prompt: string;
  provider?: string;
  stream?: boolean;
  sessionId?: string;
  tenantId?: string;
  model?: string;
  safeMode?: boolean;
};

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function toAsyncIterable(src: any): AsyncIterable<Uint8Array | string> {
  if (src && typeof src[Symbol.asyncIterator] === 'function') {
    return src as AsyncIterable<Uint8Array | string>;
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
    return {
      async *[Symbol.asyncIterator]() {
        yield src;
      },
    };
  }
  return { async *[Symbol.asyncIterator]() {} };
}

function encodeChunk(chunk: Uint8Array | string) {
  if (typeof chunk === 'string') {
    return TEXT_ENCODER.encode(chunk);
  }
  return chunk;
}

function extractDelta(frame: string): string | null {
  const lines = frame.split('\n');
  let dataLine: string | null = null;
  let eventType: string | null = null;

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLine = line.slice(5).trim();
    }
  }

  if (!dataLine || dataLine === '[DONE]') return null;

  try {
    const obj = JSON.parse(dataLine);
    if (
      (eventType === 'content_block_delta' || obj?.type === 'content_block_delta') &&
      obj?.delta?.type === 'text_delta' &&
      typeof obj?.delta?.text === 'string'
    ) {
      return obj.delta.text;
    }
    if (obj?.type === 'delta' && typeof obj?.content === 'string') {
      return obj.content;
    }
  } catch {
    return dataLine;
  }

  return null;
}

function renderHistoryPrompt(entries: { role: string; content: string }[], latest: string) {
  if (!entries.length) return latest;
  const conversation = entries
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join('\n');
  return `${conversation}\nUSER: ${latest}`;
}

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch (error) {
    return new Response('Invalid JSON payload', { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? '';
  if (!prompt) {
    return new Response('prompt required', { status: 400 });
  }

  const safeMode = Boolean(body.safeMode);
  const scope = deriveScope(safeMode);

  let provider = (body.provider || 'gpt').toLowerCase();
  if (safeMode && provider !== SAFE_MODE_PROVIDER) {
    provider = SAFE_MODE_PROVIDER;
  }

  const adapter = adapters[provider];
  if (!adapter) {
    return new Response('Unknown provider: ' + provider, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const sessionId = body.sessionId || randomUUID();
  const tenantId = body.tenantId || 'default';
  const stream = body.stream !== false;
  const effectiveModel =
    safeMode && (!body.model || body.model.trim().length === 0)
      ? process.env.LOCAL_MODEL_NAME || 'gpt-oss-120b'
      : body.model;

  const memoryClient = new MemoryServiceClient();
  const now = new Date().toISOString();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();

  try {
    await memoryClient.saveContext({
      version: '2025-09-01',
      tenant_id: tenantId,
      session_id: sessionId,
      actor: tenantId,
      payload: {
        context_entries: [
          {
            id: userMessageId,
            role: 'user',
            content: prompt,
            created_at: now,
            metadata: { source: 'chat-api', provider, scope },
          },
        ],
      },
    });
  } catch (error) {
    console.error('failed to persist user message', error);
  }

  let historyPrompt = prompt;
  try {
    const envelope = await memoryClient.retrieveContext({
      version: '2025-09-01',
      tenant_id: tenantId,
      session_id: sessionId,
      actor: provider,
      payload: { mode: 'summary', window_target_tokens: 4000 },
    });
    const entries = envelope.payload?.context_entries ?? [];
    const formatted = entries
      .filter((entry) => entry.id !== userMessageId)
      .filter((entry) => {
        if (safeMode) return true;
        const meta = toRecord(entry.metadata);
        return !isLocalSafeScope(meta?.scope);
      })
      .map((entry) => ({ role: entry.role, content: entry.content }));
    historyPrompt = renderHistoryPrompt(formatted, prompt);
  } catch (error) {
    console.warn('retrieve-context failed, proceeding with user prompt only', error);
  }

  try {
    if (!stream) {
      const result = await adapter({ prompt: historyPrompt, stream: false, model: effectiveModel });

      const content =
        typeof result === 'string'
          ? result
          : (result && typeof result === 'object' && 'content' in result)
          ? String((result as any).content ?? '')
          : (result && typeof result === 'object' && 'text' in result)
          ? String((result as any).text ?? '')
          : String(result ?? '');

      await memoryClient.saveContext({
        version: '2025-09-01',
        tenant_id: tenantId,
        session_id: sessionId,
        actor: provider,
        payload: {
          context_entries: [
            {
              id: assistantMessageId,
              role: 'assistant',
              content,
              created_at: new Date().toISOString(),
              metadata: { provider, scope },
            },
          ],
        },
      });

      return Response.json({ content, sessionId, tenantId }, { status: 200 });
    }

    const raw = await adapter({ prompt: historyPrompt, stream: true, model: effectiveModel });
    const iterable = toAsyncIterable(raw);
    let buffer = '';
    let assistantContent = '';

    const bodyStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of iterable) {
            const bytes = encodeChunk(chunk);
            controller.enqueue(bytes);

            const text = typeof chunk === 'string' ? chunk : TEXT_DECODER.decode(bytes, { stream: true });
            buffer += text;

            const frames = buffer.split('\n\n');
            buffer = frames.pop() || '';
            for (const frame of frames) {
              const delta = extractDelta(frame);
              if (delta) assistantContent += delta;
            }
          }
          if (buffer) {
            const delta = extractDelta(buffer);
            if (delta) assistantContent += delta;
          }
        } catch (error) {
          console.error('stream relay error', error);
          controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`));
        } finally {
          controller.enqueue(TEXT_ENCODER.encode('data: [DONE]\n\n'));
          controller.close();
          try {
            if (assistantContent.trim()) {
              await memoryClient.saveContext({
                version: '2025-09-01',
                tenant_id: tenantId,
                session_id: sessionId,
                actor: provider,
                payload: {
                  context_entries: [
                    {
                      id: assistantMessageId,
                      role: 'assistant',
                      content: assistantContent,
                      created_at: new Date().toISOString(),
                      metadata: { provider, scope },
                    },
                  ],
                },
              });
            }
          } catch (error) {
            console.error('failed to persist assistant message', error);
          }
        }
      },
    });

    return new Response(bodyStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Session-Id': sessionId,
        'X-Tenant-Id': tenantId,
      },
    });
  } catch (error: any) {
    console.error('chat route failed', error);
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const payload: ChatRequest = {
    prompt: searchParams.get('prompt') || '',
    provider: searchParams.get('provider') || undefined,
    stream: searchParams.get('stream') === '1',
    sessionId: searchParams.get('sessionId') || undefined,
    tenantId: searchParams.get('tenantId') || undefined,
  };

  const request = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(payload),
  });

  return POST(request as unknown as NextRequest);
}
