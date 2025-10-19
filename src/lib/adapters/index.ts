// src/lib/adapters/index.ts
import { chat as openaiChat } from './openai';
import { anthropicAdapter } from './anthropic';
import { chat as xaiChat } from './xai';
import { chat as localChat } from './local';

type ChatArgs = { prompt: string; stream?: boolean; model?: string };
type ChatFn = (args: ChatArgs) => Promise<any>;

export const adapters: Record<string, ChatFn> = {
  gpt: openaiChat,
  claude: (args) => anthropicAdapter.chat(args),
  grok: xaiChat,
  // Alias: @opus -> Anthropic Opus 4.1
  opus: (args) =>
    anthropicAdapter.chat({ ...args, model: 'claude-opus-4-1-20250805' }),
  local: localChat,
};
