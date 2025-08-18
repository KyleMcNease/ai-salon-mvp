// src/app/page.tsx
'use client';

import { useState } from 'react';
import Composer from '../components/Composer';
import { useStreamedChat, type StreamEvent } from '../hooks/useStreamedChat';
import ModelFooter from '@/components/ModelFooter';

type Msg = { role: 'user' | 'assistant'; content: string };

type Provider = 'gpt' | 'claude' | 'grok';

function parseProvider(raw: string, fallback: Provider = 'gpt') {
  const m = raw.match(/^@(gpt|claude|grok)/i);
  if (!m) return { provider: fallback, prompt: raw.trim() };
  return { provider: m[1].toLowerCase() as Provider, prompt: raw.slice(m[0].length).trim() };
}

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const { send, abort, busy, error } = useStreamedChat('/api/chat');

  async function onSend(text: string) {
    const { provider, prompt } = parseProvider(text);

    // Append user + placeholder assistant
    setMessages((m) => [
      ...m,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '' },
    ]);
    const assistantIndex = messages.length + 1; // index of the placeholder we just pushed

    const updateAssistant = (delta: string) => {
      setMessages((m) =>
        m.map((x, i) =>
          i === assistantIndex ? { ...x, content: x.content + delta } : x
        )
      );
    };

    try {
      for await (const ev of send({ prompt, provider })) {
        if (ev.type === 'delta') {
          updateAssistant(ev.value);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <main className="flex flex-col min-h-screen">
      <div className="flex-1 flex flex-col p-4 space-y-2 overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user' ? 'text-blue-600' : 'text-green-700'
            }
          >
            <strong>{m.role}:</strong> {m.content}
          </div>
        ))}
      </div>
      <Composer onSend={onSend} busy={busy} onAbort={abort} error={error} />
      <ModelFooter />
    </main>
  );
}

