import {
  ArtifactType,
  MemoryNodeType,
  MessageRole,
  PlanStatus,
  PlanStepStatus,
  Prisma,
  PrismaClient,
  SessionStatus,
} from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

type JsonRecord = Record<string, unknown>;

type MessageInput = {
  id?: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number | string;
  metadata?: JsonRecord;
};

type MemoryNodeInput = {
  id?: string;
  sessionId: string;
  type?: MemoryNodeType;
  content: string;
  importance?: number;
  decayAt?: Date | string | null;
  metadata?: JsonRecord;
  embedding?: number[];
};

type PlanInput = {
  id?: string;
  sessionId: string;
  title?: string;
  status?: PlanStatus;
  ownerModel?: string;
  description?: string;
  currentStep?: number | null;
  metadata?: JsonRecord;
};

type PlanStepInput = {
  id?: string;
  planId: string;
  seq: number;
  title: string;
  status?: PlanStepStatus;
  ownerModel?: string;
  payload?: JsonRecord;
  output?: JsonRecord;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

type ArtifactInput = {
  id?: string;
  sessionId: string;
  messageId?: string | null;
  type: ArtifactType;
  url?: string;
  storageKey?: string;
  mimeType?: string;
  metadata?: JsonRecord;
};

type AuditInput = {
  sessionId: string;
  actor: string;
  action: string;
  payload?: JsonRecord;
};

const toJson = (value?: JsonRecord): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (value as Prisma.InputJsonValue);

const toJsonObject = (value: Prisma.JsonValue | null | undefined): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
};

const toDecimal = (value?: number | string) =>
  value === undefined || value === null ? undefined : new Prisma.Decimal(value);

export async function ensureProfile(id: string | null | undefined) {
  if (!id) return null;
  return prisma.profile.upsert({
    where: { id },
    update: {},
    create: { id },
  });
}

export async function ensureSession(
  sessionId: string,
  options: {
    tenantId?: string;
    title?: string;
    status?: SessionStatus;
    metadata?: JsonRecord;
  } = {}
) {
  const owner = await ensureProfile(options.tenantId);
  const existing = await prisma.session.findUnique({ where: { id: sessionId } });

  if (existing) {
    const mergedMetadata = {
      ...toJsonObject(existing.metadata),
      ...(options.metadata ?? {}),
    };
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        title: options.title ?? existing.title,
        status: options.status ?? existing.status,
        metadata: toJson(mergedMetadata) ?? Prisma.JsonNull,
      },
    });
  }

  return prisma.session.create({
    data: {
      id: sessionId,
      title: options.title,
      status: options.status ?? SessionStatus.ACTIVE,
      ownerId: owner?.id,
      metadata: toJson(options.metadata) ?? Prisma.JsonNull,
    },
  });
}

export async function updateSessionMetadata(sessionId: string, metadata: JsonRecord) {
  return prisma.session.update({
    where: { id: sessionId },
    data: { metadata: toJson(metadata) ?? Prisma.JsonNull },
  });
}

export async function upsertMessage(input: MessageInput) {
  const payload: Prisma.MessageCreateInput = {
    id: input.id,
    session: { connect: { id: input.sessionId } },
    role: input.role,
    content: input.content,
    model: input.model,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    cost: toDecimal(input.cost),
    metadata: toJson(input.metadata),
  };

  if (input.id) {
    return prisma.message.upsert({
      where: { id: input.id },
      update: {
        role: input.role,
        content: input.content,
        model: input.model,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        cost: toDecimal(input.cost),
        metadata: toJson(input.metadata),
      },
      create: payload,
    });
  }

  return prisma.message.create({ data: payload });
}

export async function upsertMemoryNode(input: MemoryNodeInput) {
  const data = {
    session: { connect: { id: input.sessionId } },
    type: input.type ?? MemoryNodeType.FACT,
    content: input.content,
    importance: input.importance,
    decayAt: input.decayAt ? new Date(input.decayAt) : null,
    metadata: toJson(input.metadata),
    embedding: input.embedding,
  } satisfies Prisma.MemoryNodeCreateInput;

  if (input.id) {
    return prisma.memoryNode.upsert({
      where: { id: input.id },
      update: {
        type: input.type ?? MemoryNodeType.FACT,
        content: input.content,
        importance: input.importance,
        decayAt: input.decayAt ? new Date(input.decayAt) : null,
        metadata: toJson(input.metadata),
        embedding: input.embedding,
      },
      create: { id: input.id, ...data },
    });
  }

  return prisma.memoryNode.create({ data });
}

export async function upsertPlan(input: PlanInput) {
  const data: Prisma.PlanCreateInput = {
    id: input.id,
    session: { connect: { id: input.sessionId } },
    title: input.title,
    status: input.status ?? PlanStatus.PENDING,
    ownerModel: input.ownerModel,
    description: input.description,
    currentStep: input.currentStep ?? 0,
    metadata: toJson(input.metadata),
  };

  if (input.id) {
    return prisma.plan.upsert({
      where: { id: input.id },
      update: {
        title: input.title,
        status: input.status ?? PlanStatus.PENDING,
        ownerModel: input.ownerModel,
        description: input.description,
        currentStep: input.currentStep ?? 0,
        metadata: toJson(input.metadata),
      },
      create: data,
    });
  }

  return prisma.plan.create({ data });
}

export async function upsertPlanStep(input: PlanStepInput) {
  const data: Prisma.PlanStepCreateInput = {
    id: input.id,
    plan: { connect: { id: input.planId } },
    seq: input.seq,
    title: input.title,
    status: input.status ?? PlanStepStatus.PENDING,
    ownerModel: input.ownerModel,
    payload: toJson(input.payload),
    output: toJson(input.output),
    startedAt: input.startedAt ?? undefined,
    completedAt: input.completedAt ?? undefined,
  };

  if (input.id) {
    return prisma.planStep.upsert({
      where: { id: input.id },
      update: {
        seq: input.seq,
        title: input.title,
        status: input.status ?? PlanStepStatus.PENDING,
        ownerModel: input.ownerModel,
        payload: toJson(input.payload),
        output: toJson(input.output),
        startedAt: input.startedAt ?? undefined,
        completedAt: input.completedAt ?? undefined,
      },
      create: data,
    });
  }

  return prisma.planStep.create({ data });
}

export async function recordArtifact(input: ArtifactInput) {
  const data: Prisma.ArtifactCreateInput = {
    id: input.id,
    session: { connect: { id: input.sessionId } },
    message: input.messageId ? { connect: { id: input.messageId } } : undefined,
    type: input.type,
    url: input.url,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    metadata: toJson(input.metadata),
  };

  if (input.id) {
    return prisma.artifact.upsert({
      where: { id: input.id },
      update: {
        message: input.messageId ? { connect: { id: input.messageId } } : undefined,
        type: input.type,
        url: input.url,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        metadata: toJson(input.metadata),
      },
      create: data,
    });
  }

  return prisma.artifact.create({ data });
}

export async function logAudit(input: AuditInput) {
  return prisma.auditLog.create({
    data: {
      session: { connect: { id: input.sessionId } },
      actor: input.actor,
      action: input.action,
      payload: toJson(input.payload),
    },
  });
}

export async function getSessionSnapshot(
  sessionId: string,
  options: {
    messageLimit?: number;
    memoryLimit?: number;
    planLimit?: number;
    artifactLimit?: number;
    eventLimit?: number;
  } = {}
) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: options.messageLimit ?? 100,
      },
      memoryNodes: {
        orderBy: { createdAt: 'desc' },
        take: options.memoryLimit ?? 100,
      },
      plans: {
        orderBy: { createdAt: 'asc' },
        take: options.planLimit ?? 10,
        include: {
          steps: { orderBy: { seq: 'asc' } },
        },
      },
      artifacts: {
        orderBy: { createdAt: 'desc' },
        take: options.artifactLimit ?? 20,
      },
      audits: {
        orderBy: { createdAt: 'desc' },
        take: options.eventLimit ?? 50,
      },
    },
  });
}

export function extractSessionMetadata(session: { metadata: Prisma.JsonValue | null }): JsonRecord {
  return toJsonObject(session.metadata);
}
