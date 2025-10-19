'use client';

import { useMemo } from 'react';

import type { ModelOption } from '@/types/models';

type ProviderHealthMap = Record<string, { ok: boolean; model?: string }>;

type Props = {
  model?: ModelOption | null;
  loading?: boolean;
  providerHealth?: ProviderHealthMap;
};

export default function ModelStatusBadge({ model, loading = false, providerHealth = {} }: Props) {
  const status = useMemo(() => {
    if (loading) {
      return {
        label: 'Loading…',
        color: 'bg-neutral-300',
        title: 'Loading model registry',
      } as const;
    }

    if (!model) {
      return {
        label: 'Choose a model',
        color: 'bg-neutral-300',
        title: 'Select a model to continue',
      } as const;
    }

    const health = providerHealth[model.providerKey];

    if (health && !health.ok) {
      return {
        label: 'Provider down',
        color: 'bg-red-500',
        title: `Provider reported unavailable${health.model ? ` (${health.model})` : ''}`,
      } as const;
    }

    if (model.disabledReason === 'missing_credentials') {
      return {
        label: 'Configure API key',
        color: 'bg-amber-500',
        title: `Set ${model.providerKey.toUpperCase()} credentials to enable this model`,
      } as const;
    }

    if (model.disabledReason === 'adapter_missing') {
      return {
        label: 'Unsupported',
        color: 'bg-neutral-400',
        title: `Adapter for ${model.providerKey} is not available yet`,
      } as const;
    }

    if (model.experimental) {
      return {
        label: 'Experimental',
        color: 'bg-indigo-500',
        title: 'Marked experimental in the registry; expect instability',
      } as const;
    }

    if (model.localOnly) {
      return {
        label: 'Local ready',
        color: 'bg-emerald-500',
        title: 'Runs locally with no cloud dependency',
      } as const;
    }

    return {
      label: 'Ready',
      color: 'bg-sky-500',
      title: health?.model ? `Using ${health.model}` : 'Credentials detected',
    } as const;
  }, [loading, model, providerHealth]);

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span className="flex items-center gap-1" title={status.title}>
        <span className={`inline-block h-2 w-2 rounded-full ${status.color}`} aria-hidden="true" />
        {status.label}
      </span>
      {model?.description && (
        <span className="truncate text-neutral-400" title={model.description}>
          {model.description}
        </span>
      )}
    </div>
  );
}
