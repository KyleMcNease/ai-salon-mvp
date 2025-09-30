import { NextRequest } from 'next/server';

import { ensureSession, logAudit } from '@/lib/db';
import type { MemoryEnvelope } from '@/types/memory';

const API_KEY = process.env.MEMORY_SERVICE_API_KEY;

const unauthorized = () =>
  new Response('Unauthorized', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

const badRequest = (message: string) =>
  new Response(message, {
    status: 400,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  if (API_KEY && req.headers.get('x-memory-service-key') !== API_KEY) {
    return unauthorized();
  }

  let envelope: MemoryEnvelope;
  try {
    envelope = (await req.json()) as MemoryEnvelope;
  } catch (error) {
    return badRequest('Invalid JSON payload');
  }

  const payload = envelope.payload as unknown;
  const resolution = toRecord(payload)?.resolution as string | undefined;
  if (!resolution) {
    return badRequest('resolution required');
  }

  if (!envelope.session_id) {
    return badRequest('session_id required');
  }

  try {
    await ensureSession(envelope.session_id, {
      tenantId: envelope.tenant_id,
      metadata: { lastActor: envelope.actor },
    });

    await logAudit({
      sessionId: envelope.session_id,
      actor: envelope.actor ?? 'system',
      action: 'MEMORY_RESOLVE_CONFLICT',
      payload: {
        conflictId: toRecord(payload)?.conflict_id,
        resolution,
        notes: toRecord(payload)?.notes,
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('memory/resolve-conflict error', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
