import type { ChatMessage, Provider } from '@/lib/types';
import { chat as openaiChat } from '@/lib/adapters/openai';
import { chat as anthropicChat } from '@/lib/adapters/anthropic';
import { chat as xaiChat } from '@/lib/adapters/xai';

export async function chat(provider: Provider, messages: ChatMessage[]) {
  switch (provider) {
    case 'openai': return openaiChat(messages);
    case 'anthropic': return anthropicChat(messages);
    case 'xai': return xaiChat(messages);
    default: throw new Error('unknown provider');
  }
}
