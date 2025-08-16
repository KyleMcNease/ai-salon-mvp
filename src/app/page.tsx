// src/app/page.tsx
'use client';

import { useState } from 'react';
import Composer from '../components/Composer';
import { useStreamedChat, type StreamEvent } from '../hooks/useStreamedChat';

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
    setMessages((m) => [...m, { role: 'user', content: prompt }, { role: 'assistant', content: '' }]);
    const assistantIndex = messages.length + 1; // index of the placeholder we just pushed

    const updateAssistant = (delta: string) => {
      setMessages((m) => m.map((x, i) => (i === assistantIndex ? { ...x, content: x.content + delta } : x)));
    };

    await send(prompt, (ev: StreamEvent) => {
      if (ev.type === 'delta' && ev.data?.tok) updateAssistant(ev.data.tok);
      if (ev.type === 'error') {
        // Fallback to non-streaming once on error
        fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, provider, stream: false }),
        })
          .then((r) => r.json())
          .then((d) => updateAssistant(String(d.reply ?? '')))
          .catch(() => updateAssistant('[error]'));
      }
    }, { provider });
  }

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">AI Salon — MVP</h1>

      <div className="flex gap-2 items-center text-sm">
        <button onClick={abort} disabled={!busy} className="px-3 py-1 rounded border">
          Cancel
        </button>
        {error && <span className="text-red-600">{String(error)}</span>}
      </div>

      <div className="flex-1 border rounded p-4 space-y-3 bg-white">
        {messages.length === 0 ? (
          <div className="text-neutral-500">Start the conversation below.</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <div className={`inline-block px-3 py-2 rounded-2xl ${m.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                <span className="font-medium mr-2">{m.role === 'user' ? 'You' : 'Assistant'}:</span>
                <span>{m.content}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <Composer onSend={onSend} busy={busy} />
    </main>
  );
}