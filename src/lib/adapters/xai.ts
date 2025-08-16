// src/lib/adapters/xai.ts
import OpenAI from 'openai';
import type { ChatAdapter, Msg } from './types';

const client = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });

export const xaiAdapter: ChatAdapter = {
  async complete({ messages, stream = false, model }: { messages: Msg[]; stream?: boolean; model?: string }) {
    const mdl = model || process.env.MODEL_NAME_XAI || 'grok-beta';

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