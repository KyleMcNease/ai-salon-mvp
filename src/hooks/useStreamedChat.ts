// src/hooks/useStreamedChat.ts
'use client';

import { useRef, useState } from 'react';

export type StreamEvent =
  | { type: 'delta'; value: string }
  | { type: 'done' }
  | { type: 'error'; data: string };

type SendArgs = { prompt: string; provider?: string };
type Options = { onEvent?: (e: StreamEvent) => void };

export function useStreamedChat(basePath = '/api/chat', opts: Options = {}) {
  const onEvent =
    typeof opts.onEvent === 'function' ? opts.onEvent : (_e: StreamEvent) => {};
  const ctrlRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function* send({ prompt, provider }: SendArgs) {
    setBusy(true);
    setError(null);

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    try {
      // Always stream in the UI; the API returns Anthropic/OpenAI/xAI SSE verbatim
      const qs = new URLSearchParams({
        prompt,
        stream: '1',
        ...(provider ? { provider } : {}),
      });

      const res = await fetch(`${basePath}?${qs.toString()}`, {
        method: 'GET',
        signal: ctrl.signal,
        headers: { Accept: 'text/event-stream' },
      });

      if (!res.ok || !res.body) {
        const msg = `HTTP ${res.status}`;
        setError(msg);
        onEvent({ type: 'error', data: msg });
        return;
      }

      const reader = res.body.getReader();
      const td = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += td.decode(value, { stream: true });

        // Split SSE frames on blank line
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);

          // Parse lines like:
          // event: content_block_delta
          // data: {"type":"content_block_delta",...}
          let eventType: string | null = null;
          let dataLine: string | null = null;

          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              // keep last data line if multiple
              dataLine = line.slice(5).trim();
            }
          }

          if (!dataLine) continue;

          // Anthropic sends JSON in data
          try {
            const obj = JSON.parse(dataLine);

            // Most useful incremental text lives in content_block_delta
            if (
              (eventType === 'content_block_delta' || obj?.type === 'content_block_delta') &&
              obj?.delta?.type === 'text_delta' &&
              typeof obj?.delta?.text === 'string'
            ) {
              const chunk = obj.delta.text as string;
              onEvent({ type: 'delta', value: chunk });
              yield { type: 'delta', value: chunk } as StreamEvent;
            }

            if (eventType === 'message_stop' || obj?.type === 'message_stop') {
              onEvent({ type: 'done' });
              yield { type: 'done' } as StreamEvent;
            }
          } catch {
            // If not JSON (some providers send plain text chunks), forward as delta
            onEvent({ type: 'delta', value: dataLine });
            yield { type: 'delta', value: dataLine } as StreamEvent;
          }
        }
      }

      onEvent({ type: 'done' });
      yield { type: 'done' } as StreamEvent;
    } catch (e: any) {
      const message = e?.message || 'Stream failed';
      setError(message);
      onEvent({ type: 'error', data: message });
      yield { type: 'error', data: message } as StreamEvent;
    } finally {
      setBusy(false);
      ctrlRef.current = null;
    }
  }

  function abort() {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setBusy(false);
  }

  return { send, abort, busy, error };
}

