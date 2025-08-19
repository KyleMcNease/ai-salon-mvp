// src/lib/adapters/index.ts
import { chat as openaiChat } from './openai';
import { anthropicAdapter } from './anthropic';
import { chat as xaiChat } from './xai';

type ChatFn = (args: { prompt: string; stream?: boolean; model?: string }) => Promise<any>;

export const adapters: Record<string, ChatFn> = {
  gpt: openaiChat,
  claude: (args) => anthropicAdapter.chat(args),
  grok: xaiChat,
};

