// src/lib/adapters/xai.ts
import OpenAI from 'openai';
import type { ChatAdapter, Msg } from './types';

const client = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });

export const xaiAdapter: ChatAdapter = {
  async complete({ messages, stream = false, model }: { messages: Msg[]; stream?: boolean; model?: string }) {
    const mdl = model || process.env.MODEL_NAME_XAI || 'grok-4-0709';

    if (!stream) {
      const resp = await client.chat.completions.create({ model: mdl, messages, stream: false });
      return resp.choices?.[0]?.message?.content ?? '';
    }

    const resp = await client.chat.completions.create({ model: mdl, messages, stream: true });
    async function* run() {
      for await (const chunk of resp) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
    return run();
  },
};

// Legacy chat function for index.ts compatibility
export async function chat({ prompt, stream = false, model }: { prompt: string; stream?: boolean; model?: string }) {
  const messages = [{ role: 'user' as const, content: prompt }];
  
  if (!stream) {
    const result = await xaiAdapter.complete({ messages, stream: false, model });
    return { content: result };
  }

  // For streaming, return ReadableStream in SSE format
  const encoder = new TextEncoder();
  const iterable = await xaiAdapter.complete({ messages, stream: true, model });
  
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of iterable as AsyncIterable<string>) {
          // Format as SSE with data: prefix for consistency
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: chunk })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
}
