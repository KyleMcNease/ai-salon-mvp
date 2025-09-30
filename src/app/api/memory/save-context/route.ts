import { NextRequest } from 'next/server';
import {
  ArtifactType,
  MemoryNodeType,
  MessageRole,
  PlanStatus,
  PlanStepStatus,
} from '@prisma/client';

import {
  ensureSession,
  extractSessionMetadata,
  logAudit,
  recordArtifact,
  updateSessionMetadata,
  upsertMemoryNode,
  upsertMessage,
  upsertPlan,
  upsertPlanStep,
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

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function coerceRecord(value: unknown): Record<string, unknown> | undefined {
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
  if (!envelope?.tenant_id) {
    return badRequest('tenant_id required');
  }

  try {
    const session = await ensureSession(envelope.session_id, {
      tenantId: envelope.tenant_id,
      metadata: {
        lastActor: envelope.actor,
        lastDomainTags: envelope.domain_tags,
      },
    });

    const sessionMetadata = extractSessionMetadata(session);
    const previousVersion = Number(sessionMetadata.lastContextVersion ?? 0);
    const requestedVersion = envelope.context_version ?? 0;
    const nextVersion = Math.max(previousVersion, requestedVersion) + 1;

    sessionMetadata.lastContextVersion = nextVersion;
    sessionMetadata.lastActor = envelope.actor;
    sessionMetadata.lastUpdatedAt = new Date().toISOString();
    if (envelope.domain_tags?.length) {
      sessionMetadata.lastDomainTags = envelope.domain_tags;
    }

    const payload = envelope.payload ?? {};

    let messageCount = 0;
    if (payload.context_entries?.length) {
      for (const entry of payload.context_entries) {
        await upsertMessage({
          id: entry.id,
          sessionId: envelope.session_id,
          role: (entry.role ?? 'assistant') as MessageRole,
          content: entry.content,
          model: coerceRecord(entry.metadata)?.model as string | undefined,
          tokensIn: coerceNumber(coerceRecord(entry.metadata)?.tokens_in),
          tokensOut: coerceNumber(coerceRecord(entry.metadata)?.tokens_out),
          cost: coerceRecord(entry.metadata)?.cost as number | string | undefined,
          metadata: coerceRecord(entry.metadata),
        });
        messageCount += 1;
      }
    }

    let memoryCount = 0;
    if (payload.memory_nodes?.length) {
      for (const node of payload.memory_nodes) {
        await upsertMemoryNode({
          id: node.id,
          sessionId: envelope.session_id,
          type: (node.type ?? 'FACT') as MemoryNodeType,
          content: node.content,
          importance: node.importance,
          decayAt: node.decay_at ?? null,
          metadata: coerceRecord(node.metadata),
        });
        memoryCount += 1;
      }
    }

    let planCount = 0;
    if (payload.plan_updates?.length) {
      for (const plan of payload.plan_updates) {
        await upsertPlan({
          id: plan.plan_id,
          sessionId: envelope.session_id,
          status: plan.status as PlanStatus | undefined,
          metadata: plan.increments?.length ? { increments: plan.increments } : undefined,
        });
        if (plan.steps?.length) {
          for (const step of plan.steps) {
            await upsertPlanStep({
              id: step.id,
              planId: plan.plan_id,
              seq: step.seq,
              title: step.title,
              status: step.status as PlanStepStatus | undefined,
              ownerModel: step.owner_model,
              payload: coerceRecord(step.payload),
              output: coerceRecord(step.output),
            });
          }
        }
        planCount += 1;
      }
    }

    let artifactCount = 0;
    if (payload.media_artifacts?.length) {
      for (const artifact of payload.media_artifacts) {
        const artifactMetadata = coerceRecord(artifact.metadata);
        const messageId =
          (artifact as { message_id?: string }).message_id ??
          (artifactMetadata?.message_id as string | undefined) ??
          (artifactMetadata?.messageId as string | undefined);
        await recordArtifact({
          id: artifact.id,
          sessionId: envelope.session_id,
           messageId,
          type: (artifact.type ?? 'FILE') as ArtifactType,
          url: artifact.uri,
          mimeType: artifact.mime_type,
          metadata: artifactMetadata,
        });
        artifactCount += 1;
      }
    }

    let eventCount = 0;
    if (payload.events?.length) {
      for (const event of payload.events) {
        await logAudit({
          sessionId: envelope.session_id,
          actor: event.actor ?? envelope.actor ?? 'unknown',
          action: event.action ?? 'EVENT',
          payload: {
            ...coerceRecord(event.payload),
            eventId: event.id,
          },
        });
        eventCount += 1;
      }
    }

    await updateSessionMetadata(envelope.session_id, sessionMetadata);

    await logAudit({
      sessionId: envelope.session_id,
      actor: envelope.actor ?? 'system',
      action: 'MEMORY_SAVE_CONTEXT',
      payload: {
        messageCount,
        memoryCount,
        planCount,
        artifactCount,
        eventCount,
        contextVersion: nextVersion,
      },
    });

    return Response.json({ ok: true, context_version: nextVersion });
  } catch (error) {
    console.error('memory/save-context error', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
