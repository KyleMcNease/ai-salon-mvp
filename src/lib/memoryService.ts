import type { MemoryEnvelope } from '@/types/memory';

/**
 * Minimal client for the Memory Service.
 * This mock implementation targets the Next.js API routes that will emulate
 * the eventual AWS Lambda service during early milestones.
 */
export class MemoryServiceClient {
  constructor(private readonly baseUrl = process.env.MEMORY_SERVICE_URL || '/api/memory') {}

  private async request<T>(path: string, envelope: MemoryEnvelope): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-memory-service-key': process.env.MEMORY_SERVICE_API_KEY || '',
      },
      body: JSON.stringify(envelope),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MemoryService error (${res.status}): ${text}`);
    }

    return (await res.json()) as T;
  }

  saveContext(envelope: MemoryEnvelope) {
    return this.request<{ ok: boolean; context_version?: number }>('/save-context', envelope);
  }

  retrieveContext(envelope: MemoryEnvelope & { payload: { mode?: 'full' | 'summary' | 'delta'; window_target_tokens?: number } }) {
    return this.request<MemoryEnvelope>('/retrieve-context', envelope);
  }

  savePlan(envelope: MemoryEnvelope) {
    return this.request<{ ok: boolean }>('/save-plan', envelope);
  }
}
