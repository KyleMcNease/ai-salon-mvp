export type Provider = 'openai' | 'anthropic' | 'xai';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
