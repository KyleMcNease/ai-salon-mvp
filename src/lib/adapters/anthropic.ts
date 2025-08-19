// src/lib/adapters/anthropic.ts
// Minimal, robust Anthropic adapter for Claude 4 family.
// Non-stream returns { content: string }.
// Stream returns a ReadableStream suitable for SSE framing in the route.

export type ChatArgs = { prompt: string; stream?: boolean; model?: string };

export const anthropicAdapter = {
  async chat({ prompt, stream = false, model }: ChatArgs): Promise<any> {
    const mdl =
      model ||
      process.env.MODEL_NAME_ANTHROPIC ||
      'claude-sonnet-4-20250514';

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

    const body: any = {
      model: mdl,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    };
    if (stream) body.stream = true;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${errText}`);
    }

    if (stream) {
      // Return the raw ReadableStream; route.ts wraps it as SSE
      const b = res.body;
      if (!b) throw new Error('No stream body from Anthropic');
      return b;
    }

    // Non-stream: normalize to { content: string }
    const json = await res.json().catch(() => ({} as any));
    // Claude Messages API returns content array with blocks; first block is usually the text
    const text =
      Array.isArray(json?.content) && json.content.length
        ? (json.content[0]?.text ?? '')
        : json?.output_text ?? json?.text ?? '';
    return { content: String(text ?? '') };
  },
};

