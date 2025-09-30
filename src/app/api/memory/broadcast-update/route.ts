import { NextRequest } from 'next/server';

import { ArtifactType, MemoryNodeType } from '@prisma/client';

import {
  ensureSession,
  logAudit,
  recordArtifact,
  upsertMemoryNode,
} from '@/lib/db';
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

  if (!envelope?.session_id) {
    return badRequest('session_id required');
  }

  try {
    await ensureSession(envelope.session_id, {
      tenantId: envelope.tenant_id,
      metadata: { lastActor: envelope.actor },
    });

    const payload = envelope.payload ?? {};

    if (payload.memory_nodes?.length) {
      for (const node of payload.memory_nodes) {
        await upsertMemoryNode({
          id: node.id,
          sessionId: envelope.session_id,
          content: node.content,
          type: (node.type as MemoryNodeType | undefined) ?? MemoryNodeType.FACT,
          importance: node.importance,
          decayAt: node.decay_at,
          metadata: toRecord(node.metadata),
        });
      }
    }

    if (payload.media_artifacts?.length) {
      for (const artifact of payload.media_artifacts) {
        await recordArtifact({
          id: artifact.id,
          sessionId: envelope.session_id,
          type: ((artifact.type as ArtifactType | undefined) ?? ArtifactType.FILE),
          url: artifact.uri,
          mimeType: artifact.mime_type,
          metadata: toRecord(artifact.metadata),
        });
      }
    }

    await logAudit({
      sessionId: envelope.session_id,
      actor: envelope.actor ?? 'system',
      action: 'MEMORY_BROADCAST',
      payload: {
        domainTags: envelope.domain_tags,
        notes: toRecord(payload)?.notes,
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('memory/broadcast-update error', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
