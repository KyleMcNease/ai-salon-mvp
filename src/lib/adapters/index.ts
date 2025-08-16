// src/lib/adapters/index.ts
import { openaiAdapter } from './openai';
import { anthropicAdapter } from './anthropic';
import { xaiAdapter } from './xai';
import type { ChatAdapter, Provider } from './types';

export function getAdapter(provider: string | undefined): ChatAdapter {
  const p = String(provider || '').toLowerCase();
  if (p === 'claude') return anthropicAdapter;
  if (p === 'grok') return xaiAdapter;
  return openaiAdapter; // default: OpenAI
}

export type { ChatAdapter, Provider } from './types';