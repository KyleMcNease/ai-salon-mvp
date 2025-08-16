import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

// Helper functions for database operations

export async function createConversation(title?: string) {
  return await prisma.conversation.create({
    data: {
      title: title || 'New Conversation',
      metadata: {},
    },
    include: {
      messages: true,
    },
  });
}

export async function getConversation(id: string) {
  return await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function getAllConversations() {
  return await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function saveMessage(
  conversationId: string,
  message: {
    role: string;
    content: string;
    provider?: string;
    model?: string;
    tokenCount?: number;
    cost?: number;
    metadata?: any;
  }
) {
  const savedMessage = await prisma.message.create({
    data: {
      ...message,
      conversationId,
    },
  });

  // Update conversation's updatedAt
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return savedMessage;
}

export async function deleteConversation(id: string) {
  return await prisma.conversation.delete({
    where: { id },
  });
}

export async function updateConversationTitle(id: string, title: string) {
  return await prisma.conversation.update({
    where: { id },
    data: { title },
  });
}

// Memory operations
export async function saveMemory(key: string, value: string, metadata?: any) {
  return await prisma.memory.upsert({
    where: { key },
    update: { value, metadata },
    create: { key, value, metadata },
  });
}

export async function getMemory(key: string) {
  return await prisma.memory.findUnique({
    where: { key },
  });
}

export async function getAllMemories() {
  return await prisma.memory.findMany({
    orderBy: { updatedAt: 'desc' },
  });
}

export async function deleteMemory(key: string) {
  return await prisma.memory.delete({
    where: { key },
  });
}

// Embedding operations
export async function saveEmbedding(content: string, embedding: number[], metadata?: any) {
  return await prisma.embedding.create({
    data: {
      content,
      embedding,
      metadata,
    },
  });
}

export async function searchEmbeddings(embedding: number[], limit: number = 10) {
  // This would typically use a vector similarity search
  // For now, returning recent embeddings
  return await prisma.embedding.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
  });
}
