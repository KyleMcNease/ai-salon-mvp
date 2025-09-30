// src/lib/adapters/types.ts
export type Role = 'system' | 'user' | 'assistant';
export type Msg = { role: Role; content: string };

export interface ChatAdapter {
  // Returns a promise that resolves to either the full response or an async iterable for streaming tokens.
  complete(opts: {
    messages: Msg[];
    stream?: boolean;
    model?: string;
  }): Promise<string | AsyncIterable<string>>;
}

export type Provider = 'gpt' | 'claude' | 'grok';
