// src/lib/adapters/types.ts
export type Role = 'system' | 'user' | 'assistant';
export type Msg = { role: Role; content: string };

export interface ChatAdapter {
  // If stream=true, returns an AsyncIterable of text tokens.
  // If stream=false, returns the full text as a string.
  complete(opts: { messages: Msg[]; stream?: boolean; model?: string }): AsyncIterable<string> | Promise<string>;
}

export type Provider = 'gpt' | 'claude' | 'grok';