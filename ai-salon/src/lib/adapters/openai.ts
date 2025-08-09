import type { ChatMessage } from '@/lib/types';

// TODO: wire real OpenAI SDK call
export async function chat(messages: ChatMessage[]) {
  return { role: 'assistant', content: '[openai] stub response' };
}
