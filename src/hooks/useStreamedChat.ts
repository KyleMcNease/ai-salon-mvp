// src/hooks/useStreamedChat.ts
'use client';

import { useRef, useState } from 'react';

export type StreamEvent = { type: 'start' | 'delta' | 'done' | 'error'; data?: any };

export function useStreamedChat(endpoint = '/api/chat') {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  async function send(prompt: string, onEvent: (ev: StreamEvent) => void, opts?: { model?: string; provider?: string }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const res = await fetch(`${endpoint}?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: opts?.model, provider: opts?.provider, stream: true }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '');
        throw new Error(raw || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          if (!part.startsWith('data:')) continue;
          const payload = part.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') { onEvent({ type: 'done' }); continue; }
          try {
            const msg = JSON.parse(payload);
            if (msg.type === 'start') onEvent({ type: 'start', data: msg });
            else if (msg.type === 'delta') onEvent({ type: 'delta', data: msg });
            else if (msg.type === 'error') onEvent({ type: 'error', data: msg });
          } catch {
            // ignore
          }
        }
      }
    } catch (e: any) {
      const message = e?.message || 'Stream failed';
      setError(message);
      onEvent({ type: 'error', data: message });
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