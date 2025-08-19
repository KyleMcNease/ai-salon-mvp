// src/lib/adapters/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import type { ChatAdapter, Msg } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function mapToAnthropic(messages: Msg[]) {
  const sys: string[] = [];
  const mapped: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') sys.push(m.content);
    else if (m.role === 'user' || m.role === 'assistant') mapped.push({ role: m.role, content: m.content });
  }
  const system = sys.length ? sys.join('\n') : undefined;
  return { system, messages: mapped };
}

export const anthropicAdapter: ChatAdapter = {
  async complete({ messages, stream = false, model }: { messages: Msg[]; stream?: boolean; model?: string }) {
    const mdl = model || process.env.MODEL_NAME_ANTHROPIC || 'claude-sonnet-4-20250514';
    const { system, messages: mapped } = mapToAnthropic(messages);

    if (!stream) {
      const resp = await client.messages.create({ model: mdl, max_tokens: 1024, stream: false, system, messages: mapped });
      const parts = resp.content?.map((c: any) => (c.type === 'text' ? c.text : '')).join('') ?? '';
      return parts;
    }

    const streamResp = await client.messages.create({ model: mdl, max_tokens: 1024, stream: true, system, messages: mapped });
    async function* run() {
      for await (const ev of streamResp) {
        if (ev.type === 'content_block_delta' && (ev as any).delta?.type === 'text_delta') {
          yield (ev as any).delta.text as string;
        }
      }
    }
    return run();
  },
};
