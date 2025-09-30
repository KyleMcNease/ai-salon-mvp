import { NextRequest } from 'next/server';
import { PlanStatus, PlanStepStatus } from '@prisma/client';

import {
  ensureSession,
  logAudit,
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
  if (!envelope?.payload?.plan_updates?.length) {
    return badRequest('plan_updates required');
  }

  try {
    await ensureSession(envelope.session_id, {
      tenantId: envelope.tenant_id,
      metadata: { lastActor: envelope.actor },
    });

    let updated = 0;
    for (const plan of envelope.payload.plan_updates) {
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
            payload: toRecord(step.payload),
            output: toRecord(step.output),
          });
        }
      }

      updated += 1;
    }

    await logAudit({
      sessionId: envelope.session_id,
      actor: envelope.actor ?? 'system',
      action: 'MEMORY_SAVE_PLAN',
      payload: {
        planCount: updated,
      },
    });

    return Response.json({ ok: true, plan_updates: updated });
  } catch (error) {
    console.error('memory/save-plan error', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
