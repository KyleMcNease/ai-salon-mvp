// src/components/Composer.tsx
'use client';

import { useState } from 'react';
import type { Ref } from 'react';

import { Mic, Paperclip, Send as SendIcon } from 'lucide-react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => Promise<boolean | void> | boolean | void;
  busy?: boolean;
  safeMode?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onUploadClick?: () => void;
  onMicClick?: () => void;
  voiceEnabled?: boolean;
};

export default function Composer({
  value,
  onChange,
  onSend,
  busy = false,
  safeMode = false,
  textareaRef,
  onUploadClick,
  onMicClick,
  voiceEnabled = true,
}: Props) {
  const [err, setErr] = useState<string | null>(null);

  async function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setErr(null);
    try {
      const result = await onSend(trimmed);
      if (result === false) return;
      onChange('');
    } catch (e: any) {
      setErr(e?.message || 'Failed to send');
    }
  }

  return (
    <div className="border-t border-[#eadfce] bg-[#fdf7f1]/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-4">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span />
          <span className="hidden sm:block">
            Mention models with <code>@model</code>
          </span>
        </div>
        <div className="flex items-end gap-3 rounded-xl border border-[#e7d7c2] bg-[#fefbf7] px-3 py-2 shadow-sm">
          <button
            type="button"
            onClick={onUploadClick}
            className="rounded-lg p-2 text-neutral-500 transition hover:bg-[#f2e7d8] hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c6347]"
            title="Attach files"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
            placeholder={
              safeMode
                ? 'Safe Mode on — your prompts stay local…'
                : 'Ask anything… (tip: @gpt, @claude, @grok, @local)'
            }
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              if (event.shiftKey) return;
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              handleSend();
            }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={voiceEnabled ? onMicClick : undefined}
              className={`rounded-lg p-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c6347] ${
                voiceEnabled
                  ? 'text-neutral-500 hover:bg-[#f2e7d8] hover:text-neutral-800'
                  : 'cursor-not-allowed text-neutral-300 opacity-70'
              }`}
              title={voiceEnabled ? 'Start voice capture' : 'Voice responses are disabled'}
              aria-disabled={!voiceEnabled}
            >
              <Mic className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || !value.trim()}
              className="flex items-center gap-1 rounded-lg bg-[#1f1a17] px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50 disabled:hover:bg-[#1f1a17] hover:bg-[#3a2f25] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
            >
              {busy ? 'Sending…' : 'Send'}
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
      </div>
    </div>
  );
}
