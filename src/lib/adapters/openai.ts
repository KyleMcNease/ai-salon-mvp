// src/lib/adapters/openai.ts
import OpenAI from 'openai';
import type { ChatAdapter, Msg } from './types';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const openaiAdapter: ChatAdapter = {
  async complete({ messages, stream = false, model }: { messages: Msg[]; stream?: boolean; model?: string }) {
    const mdl = model || process.env.MODEL_NAME_OPENAI || 'gpt-4o-mini';

    if (!stream) {
      const resp = await client.chat.completions.create({ model: mdl, messages, stream: false });
      return resp.choices?.[0]?.message?.content ?? '';
    }

    // streaming
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