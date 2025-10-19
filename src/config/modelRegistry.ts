import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import type { AgentId } from './agents';

const REGISTRY_PATH = path.join(process.cwd(), 'config/models.yml');

export type ProviderConfig = {
  key: string;
  kind: string;
  base_url: string;
  env_key?: string;
  local_only?: boolean;
  experimental?: boolean;
};

export type ModelConfig = {
  name: string;
  display: string;
  provider: string;
  modality: string;
  description?: string;
  local_only?: boolean;
  experimental?: boolean;
  default?: boolean;
};

export type ModelRegistry = {
  providers: ProviderConfig[];
  models: ModelConfig[];
  updatedAt: number;
};

export type ModelOption = {
  name: string;
  display: string;
  providerKey: string;
  providerKind: string;
  modality: string;
  description?: string;
  localOnly: boolean;
  experimental: boolean;
  adapterKey?: string;
  agentId: AgentId;
  hasCredentials: boolean;
  disabledReason?: 'missing_credentials' | 'adapter_missing';
};

type RawRegistry = {
  providers?: ProviderConfig[];
  models?: ModelConfig[];
};

const PROVIDER_TO_ADAPTER: Record<string, string | undefined> = {
  openai: 'gpt',
  anthropic: 'claude',
  xai: 'grok',
  vllm: 'local',
  hf: undefined, // HF chat not wired yet
  tinker: undefined,
};

const PROVIDER_TO_AGENT: Record<string, AgentId> = {
  openai: 'gpt',
  anthropic: 'claude',
  xai: 'grok',
  vllm: 'local',
  hf: 'gpt',
  tinker: 'gpt',
};

let cachedRegistry: ModelRegistry | null = null;
let cachedMtime = 0;

function readRegistryFromDisk(): ModelRegistry {
  try {
    const stat = fs.statSync(REGISTRY_PATH);
    const rawContent = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = (yaml.load(rawContent) as RawRegistry) ?? {};
    const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    return {
      providers,
      models,
      updatedAt: stat.mtimeMs,
    };
  } catch (error) {
    console.warn('model registry load failed', error);
    return { providers: [], models: [], updatedAt: Date.now() };
  }
}

export function loadModelRegistry(): ModelRegistry {
  try {
    const stat = fs.statSync(REGISTRY_PATH);
    if (!cachedRegistry || stat.mtimeMs !== cachedMtime) {
      cachedRegistry = readRegistryFromDisk();
      cachedMtime = cachedRegistry.updatedAt;
    }
  } catch (error) {
    if (!cachedRegistry) {
      cachedRegistry = readRegistryFromDisk();
      cachedMtime = cachedRegistry.updatedAt;
    }
  }
  return cachedRegistry!;
}

export function getModelOptions(params: { safeMode?: boolean; modality?: string } = {}): ModelOption[] {
  const { safeMode = false, modality = 'chat' } = params;
  const registry = loadModelRegistry();
  const providerMap = new Map(registry.providers.map((provider) => [provider.key, provider]));

  return registry.models
    .filter((model) => !modality || model.modality === modality)
    .map((model) => {
      const provider = providerMap.get(model.provider);
      if (!provider) {
        return null;
      }
      const localOnly = Boolean(model.local_only || provider.local_only);
      if (safeMode && !localOnly) {
        return null;
      }

      const adapterKey = PROVIDER_TO_ADAPTER[provider.key];
      const agentId = PROVIDER_TO_AGENT[provider.key] ?? 'gpt';
      const hasCredentials = provider.env_key ? Boolean(process.env[provider.env_key]) : true;

      let disabledReason: ModelOption['disabledReason'];
      if (!adapterKey) {
        disabledReason = 'adapter_missing';
      } else if (!hasCredentials && !localOnly) {
        disabledReason = 'missing_credentials';
      }

      return {
        name: model.name,
        display: model.display,
        providerKey: provider.key,
        providerKind: provider.kind,
        modality: model.modality,
        description: model.description,
        localOnly,
        experimental: Boolean(model.experimental || provider.experimental),
        adapterKey,
        agentId,
        hasCredentials,
        disabledReason,
      } satisfies ModelOption;
    })
    .filter((option): option is ModelOption => Boolean(option));
}

export function getModelDescriptor(name: string) {
  const registry = loadModelRegistry();
  const model = registry.models.find(
    (entry) => entry.name.toLowerCase() === name.toLowerCase()
  );
  if (!model) {
    return null;
  }
  const provider = registry.providers.find((entry) => entry.key === model.provider);
  if (!provider) {
    return null;
  }
  const adapterKey = PROVIDER_TO_ADAPTER[provider.key];
  const agentId = PROVIDER_TO_AGENT[provider.key] ?? 'gpt';
  const localOnly = Boolean(model.local_only || provider.local_only);
  const hasCredentials = provider.env_key ? Boolean(process.env[provider.env_key]) : true;
  return {
    model,
    provider,
    adapterKey,
    agentId,
    localOnly,
    hasCredentials,
  } as const;
}
