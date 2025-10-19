// src/components/Composer.tsx
'use client';

import { useMemo, useState } from 'react';

type ModelOption = {
  name: string;
  display: string;
  providerKey: string;
  adapterKey?: string;
  localOnly?: boolean;
  experimental?: boolean;
  disabledReason?: string;
  description?: string;
};

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

  const selectedOption = useMemo(
    () => models.find((option) => option.name === selectedModel) ?? null,
    [models, selectedModel]
  );

  const statusInfo = useMemo(() => {
    const health = selectedOption ? providerHealth[selectedOption.providerKey] : undefined;
    if (modelsLoading) {
      return { label: 'Loading…', color: 'bg-neutral-300', title: 'Loading model registry' };
    }
    if (!selectedOption) {
      return { label: 'Choose a model', color: 'bg-neutral-300', title: 'Select a model to continue' };
    }
    if (health && !health.ok) {
      return {
        label: 'Provider down',
        color: 'bg-red-500',
        title: `Provider reported as unavailable${health.model ? ` (${health.model})` : ''}`,
      };
    }
    if (selectedOption.disabledReason === 'missing_credentials') {
      return {
        label: 'Configure API key',
        color: 'bg-amber-500',
        title: `Set ${selectedOption.providerKey.toUpperCase()} credentials to enable this model`,
      };
    }
    if (selectedOption.disabledReason === 'adapter_missing') {
      return {
        label: 'Unsupported',
        color: 'bg-neutral-400',
        title: `Adapter for ${selectedOption.providerKey} is not available yet`,
      };
    }
    if (selectedOption.experimental) {
      return {
        label: 'Experimental',
        color: 'bg-indigo-500',
        title: 'Marked experimental in the registry; expect instability',
      };
    }
    if (selectedOption.localOnly) {
      return {
        label: 'Local ready',
        color: 'bg-emerald-500',
        title: 'Runs locally with no cloud dependency',
      };
    }
    return {
      label: 'Ready',
      color: 'bg-sky-500',
      title: health?.model ? `Using ${health.model}` : 'Credentials detected',
    };
  }, [modelsLoading, selectedOption, providerHealth]);

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
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className="flex items-center gap-1" title={statusInfo.title}>
          <span className={`inline-block h-2 w-2 rounded-full ${statusInfo.color}`} aria-hidden="true" />
          {statusInfo.label}
        </span>
        {selectedOption?.description && (
          <span className="truncate text-neutral-400" title={selectedOption.description}>
            {selectedOption.description}
          </span>
        )}
      </div>
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
