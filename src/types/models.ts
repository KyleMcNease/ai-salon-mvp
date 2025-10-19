export type ProviderId = 'gpt' | 'claude' | 'grok' | 'opus' | 'local';

export type ModelOption = {
  name: string;
  display: string;
  providerKey: string;
  providerKind: string;
  modality: string;
  description?: string;
  localOnly: boolean;
  experimental: boolean;
  adapterKey?: ProviderId;
  agentId: ProviderId;
  hasCredentials: boolean;
  disabledReason?: 'missing_credentials' | 'adapter_missing';
};
