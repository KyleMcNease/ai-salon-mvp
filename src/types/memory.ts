export type PlanStepStatus = 'PENDING' | 'RUNNING' | 'VERIFYING' | 'DONE' | 'FAILED' | 'INTERRUPTED';

export type PlanStatus = 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';

export type MemoryNodeType = 'FACT' | 'PREFERENCE' | 'WORKFLOW' | 'ERROR' | 'SUMMARY';

export interface ContextEntry {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  summary?: string;
  importance?: number;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface PlanStep {
  id: string;
  seq: number;
  title: string;
  status: PlanStepStatus;
  owner_model?: string;
  payload?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface PlanUpdate {
  plan_id: string;
  status: PlanStatus;
  steps?: PlanStep[];
  increments?: Record<string, unknown>[];
}

export interface MemoryNode {
  id: string;
  type: MemoryNodeType;
  content: string;
  importance?: number;
  decay_at?: string;
  metadata?: Record<string, unknown>;
}

export type EventAction =
  | 'PLAN'
  | 'EXECUTE'
  | 'VERIFY'
  | 'INTERRUPT'
  | 'VOICE_READY'
  | 'BROADCAST'
  | string;

export interface EventRecord {
  id: string;
  action: EventAction;
  created_at: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

export interface MediaArtifact {
  id: string;
  type: 'AUDIO' | 'IMAGE' | 'VIDEO' | 'FILE' | 'TEXT' | 'DATASET' | 'CODE';
  uri: string;
  mime_type?: string;
  duration_ms?: number;
  message_id?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryPayload {
  context_entries?: ContextEntry[];
  plan_updates?: PlanUpdate[];
  memory_nodes?: MemoryNode[];
  events?: EventRecord[];
  media_artifacts?: MediaArtifact[];
  mode?: 'full' | 'summary' | 'delta';
  window_target_tokens?: number;
}

export interface ModelCapabilities {
  max_context_tokens?: number;
  modalities?: string[];
  supports_tools?: boolean;
  supports_audio?: boolean;
}

export interface MemoryEnvelope {
  version: string;
  tenant_id: string;
  session_id: string;
  actor: string;
  domain_tags?: string[];
  model_caps?: ModelCapabilities;
  context_version?: number;
  compression?: 'none' | 'gzip' | 'brotli';
  payload: MemoryPayload;
}
