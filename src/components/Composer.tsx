// src/components/Composer.tsx
'use client';

import { useState } from 'react';

type Props = {
  onSend: (text: string) => Promise<void> | void;
  busy?: boolean;
};

export default function Composer({ onSend, busy = false }: Props) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function handleSend() {
    const v = text.trim();
    if (!v || busy) return;
    setErr(null);
    try {
      await onSend(v);
      setText('');
    } catch (e: any) {
      setErr(e?.message || 'Failed to send');
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-4 gap-2 flex flex-col">
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="Say something… (tip: @gpt, @claude, @grok)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
        />
        <button
          onClick={handleSend}
          disabled={busy || !text.trim()}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="text-xs text-neutral-500">Press ⌘/Ctrl + Enter to send</div>
    </div>
  );
}