import type { ChatMessage } from '@/lib/types';

// TODO: wire real Anthropic SDK call
export async function chat(messages: ChatMessage[]) {
  return { role: 'assistant', content: '[anthropic] stub response' };
}
