import { NextRequest } from 'next/server';

import { extractSessionMetadata, getSessionSnapshot } from '@/lib/db';
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

  const mode = envelope.payload?.mode ?? 'full';
  const messageLimit = mode === 'summary' ? 20 : mode === 'delta' ? 40 : 100;
  const memoryLimit = mode === 'summary' ? 20 : 100;
  const eventLimit = 50;

  try {
    const snapshot = await getSessionSnapshot(envelope.session_id, {
      messageLimit,
      memoryLimit,
      eventLimit,
    });

    if (!snapshot) {
      return new Response('Session not found', { status: 404 });
    }

    const metadata = extractSessionMetadata(snapshot);
    const contextVersion = Number(metadata.lastContextVersion ?? 0);

    const responseEnvelope: MemoryEnvelope = {
      version: envelope.version ?? '2025-09-01',
      tenant_id: envelope.tenant_id ?? metadata.ownerTenantId ?? 'default',
      session_id: envelope.session_id,
      actor: envelope.actor ?? 'system',
      domain_tags: (metadata.lastDomainTags as string[] | undefined) ?? envelope.domain_tags,
      model_caps: envelope.model_caps,
      compression: 'none',
      context_version: contextVersion,
      payload: {
        context_entries: snapshot.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          summary: toRecord(message.metadata)?.summary as string | undefined,
          importance: toRecord(message.metadata)?.importance as number | undefined,
          created_at: message.createdAt.toISOString(),
          metadata: toRecord(message.metadata),
        })),
        memory_nodes: snapshot.memoryNodes.map((node) => ({
          id: node.id,
          type: node.type,
          content: node.content,
          importance: node.importance ?? undefined,
          decay_at: node.decayAt?.toISOString(),
          metadata: toRecord(node.metadata),
        })),
        plan_updates: snapshot.plans.map((plan) => ({
          plan_id: plan.id,
          status: plan.status,
          increments: undefined,
          steps: plan.steps.map((step) => ({
            id: step.id,
            seq: step.seq,
            title: step.title,
            status: step.status,
            owner_model: step.ownerModel ?? undefined,
            payload: toRecord(step.payload),
            output: toRecord(step.output),
          })),
        })),
        events: snapshot.audits.map((audit) => ({
          id: audit.id,
          action: audit.action,
          created_at: audit.createdAt.toISOString(),
          actor: audit.actor,
          payload: toRecord(audit.payload),
        })),
        media_artifacts: snapshot.artifacts.map((artifact) => ({
          id: artifact.id,
          type: artifact.type,
          uri: artifact.url ?? '',
          mime_type: artifact.mimeType ?? undefined,
          message_id: artifact.messageId ?? undefined,
          metadata: toRecord(artifact.metadata),
        })),
        mode,
        window_target_tokens: envelope.payload?.window_target_tokens,
      },
    };

    return Response.json(responseEnvelope);
  } catch (error) {
    console.error('memory/retrieve-context error', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
