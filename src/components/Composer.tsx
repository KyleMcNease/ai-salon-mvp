// src/components/Composer.tsx
'use client';

import { useState } from 'react';

import type { ModelOption } from '@/types/models';
import ModelStatusBadge from '@/components/ModelStatusBadge';

type Props = {
  onSend: (text: string) => Promise<void> | void;
  busy?: boolean;
  models?: ModelOption[];
  selectedModel?: string | null;
  onModelChange?: (modelName: string) => void;
  safeMode?: boolean;
  modelsLoading?: boolean;
  providerHealth?: Record<string, { ok: boolean; model?: string }>;
};

export default function Composer({
  onSend,
  busy = false,
  models = [],
  selectedModel,
  onModelChange,
  safeMode = false,
  modelsLoading = false,
  providerHealth = {},
}: Props) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const selectedOption = models.find((option) => option.name === selectedModel) ?? null;

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
    <div className="w-full max-w-3xl mx-auto p-4 gap-3 flex flex-col">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <label className="text-xs uppercase tracking-wide text-neutral-500" htmlFor="model-picker">
          Model
        </label>
        <select
          id="model-picker"
          className="flex-1 border rounded px-3 py-2 text-sm disabled:bg-neutral-100"
          value={selectedModel ?? ''}
          onChange={(event) => onModelChange?.(event.target.value)}
          disabled={modelsLoading || busy || models.length === 0}
        >
          {models.length === 0 ? (
            <option value="" disabled>
              {modelsLoading ? 'Loading models…' : 'No models available'}
            </option>
          ) : (
            models.map((model) => (
              <option key={model.name} value={model.name} disabled={Boolean(model.disabledReason)}>
                {model.display}
                {model.disabledReason === 'missing_credentials'
                  ? ' (configure API key)'
                  : model.disabledReason === 'adapter_missing'
                  ? ' (unsupported)'
                  : model.experimental
                  ? ' (experimental)'
                  : ''}
              </option>
            ))
          )}
        </select>
      </div>
      <ModelStatusBadge model={selectedOption} loading={modelsLoading} providerHealth={providerHealth} />
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder={
            safeMode
              ? 'Safe Mode on — ask your local OSS co-researcher…'
              : 'Ask anything… (tip: @gpt, @claude, @grok, @local)'
          }
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
      <div className="text-xs text-neutral-500">
        Press ⌘/Ctrl + Enter to send. Mention specific models with <code>@model</code>.
      </div>
    </div>
  );
}
