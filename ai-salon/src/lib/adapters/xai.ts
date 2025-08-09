import type { ChatMessage } from '@/lib/types';

// TODO: wire real xAI SDK call
export async function chat(messages: ChatMessage[]) {
  return { role: 'assistant', content: '[xai] stub response' };
}
