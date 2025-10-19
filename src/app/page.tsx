// src/app/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';

import AgentIdentityCard from '@/components/AgentIdentityCard';
import Composer from '@/components/Composer';
import ModelFooter from '@/components/ModelFooter';
import { getAgentDisplay } from '@/config/agents';
import { useStreamedChat, type StreamEvent } from '@/hooks/useStreamedChat';

const MEMORY_VERSION = '2025-09-01';
const DEFAULT_TENANT = 'default';
const KNOWN_PROVIDERS: Provider[] = ['gpt', 'claude', 'grok', 'opus', 'local'];

const isProvider = (value: unknown): value is Provider =>
  typeof value === 'string' && KNOWN_PROVIDERS.includes(value as Provider);

export type Provider = 'gpt' | 'claude' | 'grok' | 'opus' | 'local';

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentId?: Provider;
  createdAt?: string;
  audioUri?: string;
  voiceId?: string;
  scope?: 'local-safe' | 'global';
  metadata?: Record<string, unknown>;
  modelName?: string;
};

type HistoryResponse = {
  payload?: {
    context_entries?: Array<{
      id: string;
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      created_at: string;
      metadata?: Record<string, unknown>;
    }>;
    media_artifacts?: Array<{
      id: string;
      type: string;
      uri: string;
      mime_type?: string;
      message_id?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
};

type ModelOption = {
  name: string;
  display: string;
  providerKey: string;
  providerKind: string;
  modality: string;
  description?: string;
  localOnly: boolean;
  experimental: boolean;
  adapterKey?: Provider;
  agentId: Provider;
  hasCredentials: boolean;
  disabledReason?: 'missing_credentials' | 'adapter_missing';
};

type VoiceStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string; source: 'artifact' | 'local'; voiceId?: string }
  | { status: 'error'; error: string };

type HeygenStatus =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'processing'; videoId?: string }
  | { status: 'ready'; videoId?: string; videoUrl?: string }
  | { status: 'error'; error: string; videoId?: string };

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

export default function Page() {
  const searchParams = useSearchParams();
  const sessionParam = searchParams?.get('session');

  const [safeMode, setSafeMode] = useState(false);
  const lastGlobalModelRef = useRef<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [providerHealth, setProviderHealth] = useState<Record<string, { ok: boolean; model?: string }>>({});
  const toggleSafeMode = useCallback(() => {
    setSafeMode((prev) => {
      if (!prev) {
        lastGlobalModelRef.current = selectedModel;
      }
      return !prev;
    });
  }, [selectedModel]);
  const [allMessages, setAllMessages] = useState<Msg[]>([]);
  const visibleMessages = useMemo(
    () => (safeMode ? allMessages : allMessages.filter((msg) => msg.scope !== 'local-safe')),
    [allMessages, safeMode]
  );
  const safeShelfEntries = useMemo(
    () => allMessages.filter((msg) => msg.scope === 'local-safe'),
    [allMessages]
  );
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<Provider>('gpt');
  const { send, busy, error } = useStreamedChat('/api/chat');

  const sessionId = useMemo(
    () =>
      sessionParam && sessionParam.length > 10
        ? sessionParam
        : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    [sessionParam]
  );

  const tenantId = DEFAULT_TENANT;
  const selectedModelOption = useMemo(() => {
    if (!selectedModel) return null;
    return modelOptions.find((option) => option.name === selectedModel) ?? null;
  }, [modelOptions, selectedModel]);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const providers = data?.providers ?? {};
      const map: Record<string, { ok: boolean; model?: string }> = {
        openai: { ok: Boolean(providers?.gpt?.ok), model: providers?.gpt?.model },
        anthropic: { ok: Boolean(providers?.claude?.ok), model: providers?.claude?.model },
        xai: { ok: Boolean(providers?.grok?.ok), model: providers?.grok?.model },
        vllm: { ok: true, model: 'local-vllm' },
        local: { ok: true, model: 'local' },
        hf: { ok: true, model: providers?.hf?.model ?? 'hf' },
      };
      setProviderHealth(map);
    } catch (error) {
      setProviderHealth((prev) => (Object.keys(prev).length ? prev : {
        openai: { ok: false },
        anthropic: { ok: false },
        xai: { ok: false },
        vllm: { ok: true },
        local: { ok: true },
        hf: { ok: false },
      }));
    }
  }, []);

  const loadModels = useCallback(
    async (mode: boolean) => {
      setModelsLoading(true);
      try {
        const res = await fetch(`/api/models?modality=chat&safeMode=${mode ? '1' : '0'}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const rawModels = Array.isArray(data?.models) ? data.models : [];
        const options: ModelOption[] = rawModels.map((model: any) => ({
          name: String(model.name ?? ''),
          display: String(model.display ?? model.name ?? ''),
          providerKey: String(model.providerKey ?? model.provider ?? ''),
          providerKind: String(model.providerKind ?? ''),
          modality: String(model.modality ?? 'chat'),
          description: typeof model.description === 'string' ? model.description : undefined,
          localOnly: Boolean(model.localOnly),
          experimental: Boolean(model.experimental),
          adapterKey: model.adapterKey ? (String(model.adapterKey).toLowerCase() as Provider) : undefined,
          agentId: (model.agentId ? String(model.agentId).toLowerCase() : 'gpt') as Provider,
          hasCredentials: Boolean(model.hasCredentials ?? true),
          disabledReason: model.disabledReason,
        }));

        setModelOptions(options);

        const pickFirstEnabled = () => {
          const enabled = options.find((option) => !option.disabledReason);
          return enabled?.name ?? (options[0]?.name ?? null);
        };

        if (mode) {
          setSelectedModel(pickFirstEnabled());
        } else {
          const target = lastGlobalModelRef.current
            ? options.find(
                (option) => option.name === lastGlobalModelRef.current && !option.disabledReason
              )
            : undefined;
          setSelectedModel(target?.name ?? pickFirstEnabled());
        }
      } catch (error) {
        console.error('Failed to load models', error);
        setModelOptions([]);
        setSelectedModel(null);
      } finally {
        setModelsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadModels(safeMode);
  }, [loadModels, safeMode]);

  useEffect(() => {
    loadHealth();
    const id = setInterval(loadHealth, 60_000);
    return () => clearInterval(id);
  }, [loadHealth]);

  useEffect(() => {
    if (!safeMode && selectedModelOption?.name) {
      lastGlobalModelRef.current = selectedModelOption.name;
    }
  }, [safeMode, selectedModelOption?.name]);

  useEffect(() => {
    if (selectedModelOption?.agentId) {
      setActiveAgent(selectedModelOption.agentId);
    } else if (safeMode) {
      setActiveAgent('local');
    } else {
      setActiveAgent('gpt');
    }
  }, [selectedModelOption, safeMode]);

  const resolveMention = useCallback(
    (token: string): ModelOption | null => {
      const normalized = token.toLowerCase();
      const direct = modelOptions.find((option) => option.name.toLowerCase() === normalized);
      if (direct && !direct.disabledReason) {
        return direct;
      }
      const alias = modelOptions.find(
        (option) => option.adapterKey === normalized && !option.disabledReason
      );
      if (alias) {
        return alias;
      }
      if (normalized.startsWith('hf/')) {
        const name = normalized.slice(3);
        const hfOption = modelOptions.find(
          (option) => option.name.toLowerCase() === name && !option.disabledReason
        );
        if (hfOption) {
          return hfOption;
        }
      }
      return null;
    },
    [modelOptions]
  );

  const extractMentions = useCallback(
    (input: string) => {
      let cleaned = input;
      const mentionRegex = /@([A-Za-z0-9_.\-/]+)/g;
      const toolRegex = /#(?:tool|tools)[:=]([A-Za-z0-9_.-]+)/gi;

      const mentionSet = new Set<string>();
      const toolSet = new Set<string>();

      for (const match of input.matchAll(mentionRegex)) {
        const raw = match[0];
        const token = match[1];
        const option = resolveMention(token);
        if (!option) continue;
        mentionSet.add(option.name);
        cleaned = cleaned.replace(raw, ' ');
      }

      for (const match of input.matchAll(toolRegex)) {
        const raw = match[0];
        const token = match[1];
        if (!token) continue;
        toolSet.add(token.toLowerCase());
        cleaned = cleaned.replace(raw, ' ');
      }

      cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
      return {
        prompt: cleaned,
        modelMentions: Array.from(mentionSet),
        toolOverrides: Array.from(toolSet),
      };
    },
    [resolveMention]
  );

  const [voiceState, setVoiceState] = useState<Record<string, VoiceStatus>>({});
  const [heygenState, setHeygenState] = useState<Record<string, HeygenStatus>>({});
  const voiceRequests = useRef(new Set<string>());
  const voiceStateRef = useRef<Record<string, VoiceStatus>>({});
  const heygenTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  const releaseResources = useCallback(() => {
    const voiceSnapshot = voiceStateRef.current;
    Object.values(voiceSnapshot).forEach((state) => {
      if (state?.status === 'ready' && state.source === 'local' && state.url) {
        URL.revokeObjectURL(state.url);
      }
    });
    const timersSnapshot = heygenTimers.current;
    Object.values(timersSnapshot).forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => releaseResources, [releaseResources]);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    setHistoryLoaded((prev) => (prev ? prev : false));
    try {
      const res = await fetch('/api/memory/retrieve-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: MEMORY_VERSION,
          tenant_id: tenantId,
          session_id: sessionId,
          actor: 'ui-client',
          payload: { mode: 'full', window_target_tokens: 4000 },
        }),
      });

      if (!res.ok) {
        if (res.status === 404) {
          setAllMessages([]);
          setHistoryLoaded(true);
          return;
        }
        throw new Error(`Memory fetch failed (${res.status})`);
      }

      const data = (await res.json()) as HistoryResponse;

      const artifactMap = new Map<
        string,
        { uri: string; voiceId?: string; meta?: Record<string, unknown> }
      >();
      for (const artifact of data.payload?.media_artifacts ?? []) {
        if (!artifact || artifact.type !== 'AUDIO' || !artifact.uri) continue;
        const meta = toRecord(artifact.metadata);
        const messageId =
          artifact.message_id ??
          (meta?.message_id as string | undefined) ??
          (meta?.messageId as string | undefined);
        if (!messageId) continue;
        artifactMap.set(messageId, {
          uri: artifact.uri,
          voiceId: (meta?.voice_id as string | undefined) ?? (meta?.voiceId as string | undefined),
          meta,
        });
      }

      const chatMessages: Msg[] = (data.payload?.context_entries ?? [])
        .filter(
          (entry): entry is typeof entry & { role: 'user' | 'assistant' } =>
            entry.role === 'user' || entry.role === 'assistant'
        )
        .map((entry) => {
          const metadata = toRecord(entry.metadata);
          const providerRaw = (metadata?.provider as string | undefined)?.toLowerCase();
          const agentId = providerRaw && isProvider(providerRaw) ? providerRaw : entry.role === 'assistant' ? 'gpt' : undefined;
          const artifact = artifactMap.get(entry.id);
          const scope =
            (metadata?.scope as string | undefined) === 'local-safe' ? ('local-safe' as const) : ('global' as const);
          const modelName = typeof metadata?.model === 'string' ? (metadata.model as string) : undefined;
          return {
            id: entry.id,
            role: entry.role,
            content: entry.content,
            createdAt: entry.created_at,
            agentId,
            audioUri: artifact?.uri,
            voiceId: artifact?.voiceId ?? (metadata?.voice_id as string | undefined),
            scope,
            metadata: metadata ?? undefined,
            modelName,
          } satisfies Msg;
        });

      setAllMessages(chatMessages);

      const lastAssistantWithModel = [...chatMessages]
        .reverse()
        .find((msg) => msg.role === 'assistant' && msg.modelName);
      if (lastAssistantWithModel?.modelName) {
        setSelectedModel((prev) => lastAssistantWithModel.modelName ?? prev);
      }
      setHistoryLoaded(true);
    } catch (err: any) {
      setHistoryError(err?.message || 'Unable to load history');
      setHistoryLoaded(true);
    }
  }, [sessionId, tenantId, safeMode]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const requestVoice = useCallback(
    async (message: Msg, options: { force?: boolean } = {}) => {
      if (message.role !== 'assistant') return;
      if (!message.content?.trim()) return;

      const current = voiceStateRef.current[message.id];
      if (!options.force && current?.status === 'loading') {
        return;
      }

      setVoiceState((prev) => {
        const next = { ...prev };
        const existing = next[message.id];
        if (existing?.status === 'ready' && existing.source === 'local' && existing.url) {
          URL.revokeObjectURL(existing.url);
        }
        next[message.id] = { status: 'loading' };
        return next;
      });

      try {
        const res = await fetch('/api/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: message.content,
            agentId: message.agentId,
            sessionId,
            messageId: message.id,
            tenantId,
            safeMode,
          }),
        });

        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const errJson = await res.json();
            if (errJson?.error) detail = errJson.error as string;
          } catch (_) {
            /* swallow */
          }
          throw new Error(detail);
        }

        const contentType = res.headers.get('Content-Type') ?? '';
        if (contentType.includes('application/json')) {
          const body = await res.json();
          throw new Error(body?.error || 'Voice synthesis failed');
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const voiceId = res.headers.get('X-Voice-Id') ?? undefined;

        setVoiceState((prev) => {
          const next = { ...prev };
          const existing = next[message.id];
          if (existing?.status === 'ready' && existing.source === 'local' && existing.url) {
            URL.revokeObjectURL(existing.url);
          }
          next[message.id] = { status: 'ready', url, source: 'local', voiceId };
          return next;
        });
        voiceRequests.current.add(message.id);
        await loadHistory();
      } catch (err: any) {
        setVoiceState((prev) => ({
          ...prev,
          [message.id]: {
            status: 'error',
            error: err?.message || 'Voice synthesis failed',
          },
        }));
        voiceRequests.current.delete(message.id);
        throw err;
      }
    },
    [loadHistory, safeMode, sessionId, tenantId]
  );

  const pollHeygenStatus = useCallback(
    (messageId: string, videoId: string) => {
      const tick = async () => {
        try {
          const res = await fetch(`/api/heygen/talk?videoId=${encodeURIComponent(videoId)}`, {
            cache: 'no-store',
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json();
          const statusPayload = toRecord(data?.status);
          const job = toRecord(statusPayload?.data) ?? statusPayload;
          const state = (job?.status as string | undefined) ?? (statusPayload?.status as string | undefined);
          const videoUrl = job?.video_url as string | undefined;

          if (state && state.toLowerCase() === 'completed') {
            setHeygenState((prev) => ({
              ...prev,
              [messageId]: { status: 'ready', videoId, videoUrl },
            }));
            if (heygenTimers.current[messageId]) {
              clearTimeout(heygenTimers.current[messageId]);
              delete heygenTimers.current[messageId];
            }
            return;
          }

          if (state && state.toLowerCase() === 'failed') {
            setHeygenState((prev) => ({
              ...prev,
              [messageId]: {
                status: 'error',
                error: 'HeyGen reported failure',
                videoId,
              },
            }));
            if (heygenTimers.current[messageId]) {
              clearTimeout(heygenTimers.current[messageId]);
              delete heygenTimers.current[messageId];
            }
            return;
          }

          setHeygenState((prev) => ({
            ...prev,
            [messageId]: { status: 'processing', videoId },
          }));

          const timer = setTimeout(tick, 5000);
          heygenTimers.current[messageId] = timer;
        } catch (err: any) {
          setHeygenState((prev) => ({
            ...prev,
            [messageId]: {
              status: 'error',
              error: err?.message || 'Unable to fetch HeyGen status',
              videoId,
            },
          }));
          if (heygenTimers.current[messageId]) {
            clearTimeout(heygenTimers.current[messageId]);
            delete heygenTimers.current[messageId];
          }
        }
      };

      tick();
    },
    []
  );

  const requestHeygen = useCallback(
    async (message: Msg) => {
      if (message.role !== 'assistant') return;
      if (!message.content?.trim()) return;

      if (safeMode) {
        setHeygenState((prev) => ({
          ...prev,
          [message.id]: {
            status: 'error',
            error: 'HeyGen rendering is disabled while Safe Mode is active.',
          },
        }));
        return;
      }

      if (heygenTimers.current[message.id]) {
        clearTimeout(heygenTimers.current[message.id]);
        delete heygenTimers.current[message.id];
      }

      setHeygenState((prev) => ({ ...prev, [message.id]: { status: 'requesting' } }));
      try {
        const res = await fetch('/api/heygen/talk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: message.content,
            agentId: message.agentId,
          }),
        });

        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) detail = body.error as string;
          } catch (_) {
            /* empty */
          }
          throw new Error(detail);
        }

        const data = await res.json();
        const videoId = data?.videoId as string | undefined;

        setHeygenState((prev) => ({
          ...prev,
          [message.id]: { status: 'processing', videoId },
        }));

        if (videoId) {
          pollHeygenStatus(message.id, videoId);
        }
      } catch (err: any) {
        setHeygenState((prev) => ({
          ...prev,
          [message.id]: {
            status: 'error',
            error: err?.message || 'Unable to start HeyGen render',
          },
        }));
      }
    },
    [pollHeygenStatus, safeMode]
  );

  useEffect(() => {
    setVoiceState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const msg of visibleMessages) {
        if (!msg.audioUri) continue;
        const existing = next[msg.id];
        if (
          !existing ||
          existing.status !== 'ready' ||
          existing.source !== 'artifact' ||
          existing.url !== msg.audioUri
        ) {
          if (existing?.status === 'ready' && existing.source === 'local' && existing.url) {
            URL.revokeObjectURL(existing.url);
          }
          next[msg.id] = {
            status: 'ready',
            url: msg.audioUri,
            source: 'artifact',
            voiceId: msg.voiceId,
          };
          changed = true;
        }
        voiceRequests.current.add(msg.id);
      }
      return changed ? next : prev;
    });
  }, [visibleMessages]);

  useEffect(() => {
    visibleMessages.forEach((msg) => {
      if (msg.role !== 'assistant') return;
      if (!msg.content?.trim()) return;
      if (msg.audioUri) return;
      if (!voiceRequests.current.has(msg.id)) {
        voiceRequests.current.add(msg.id);
        requestVoice(msg).catch((err) => console.warn('Voice generation failed', err));
      }
    });
  }, [visibleMessages, requestVoice]);

  async function onSend(text: string) {
    const { prompt, modelMentions, toolOverrides } = extractMentions(text);
    if (!prompt) return;

    if (!selectedModelOption) {
      setHistoryError('No model selected');
      return;
    }

    setHistoryError(null);
    const scope: 'local-safe' | 'global' = safeMode ? 'local-safe' : 'global';
    const modelName = selectedModelOption.name;
    const effectiveProvider: Provider = safeMode ? 'local' : selectedModelOption.adapterKey ?? 'gpt';
    const mentionsToSend = modelMentions.filter((name) => name !== modelName);
    const toolsToSend = (() => {
      if (safeMode) {
        return toolOverrides.filter((tool) => tool !== 'web.search');
      }
      return toolOverrides;
    })();
    const blockedTools = safeMode ? toolOverrides.filter((tool) => tool === 'web.search') : [];

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    if (blockedTools.length > 0) {
      setHistoryError(`Safe Mode blocked tools: ${blockedTools.join(', ')}`);
    }

    setAllMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: 'user',
        content: prompt,
        agentId: effectiveProvider,
        createdAt: new Date().toISOString(),
        scope,
        modelName,
        metadata:
          mentionsToSend.length > 0 || toolsToSend.length > 0 || blockedTools.length > 0
            ? {
                mentions: mentionsToSend.length > 0 ? mentionsToSend : undefined,
                tools: toolsToSend.length > 0 ? toolsToSend : undefined,
                blocked_tools: blockedTools.length > 0 ? blockedTools : undefined,
              }
            : undefined,
      },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        agentId: effectiveProvider,
        createdAt: new Date().toISOString(),
        scope,
        modelName,
        metadata:
          mentionsToSend.length > 0 || toolsToSend.length > 0 || blockedTools.length > 0
            ? {
                mentions: mentionsToSend.length > 0 ? mentionsToSend : undefined,
                tools: toolsToSend.length > 0 ? toolsToSend : undefined,
                blocked_tools: blockedTools.length > 0 ? blockedTools : undefined,
              }
            : undefined,
      },
    ]);

    const updateAssistant = (delta: string) => {
      setAllMessages((prev) =>
        prev.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content + delta } : msg))
      );
    };

    const handleEvent = (event: StreamEvent) => {
      if (event.type === 'delta') updateAssistant(event.value);
      if (event.type === 'error') setHistoryError(event.data);
      if (event.type === 'attribution') {
        const label = event.name ?? event.model;
        updateAssistant(`\n\n[${label}]\n`);
      }
    };

    try {
      for await (const ev of send({
        prompt,
        provider: effectiveProvider,
        sessionId,
        tenantId,
        safeMode,
        model: modelName,
        mentions: mentionsToSend,
        tools: toolsToSend,
      })) {
        handleEvent(ev);
      }
    } catch (err) {
      console.error(err);
      setHistoryError((err as Error)?.message || 'Streaming failed');
    } finally {
      voiceRequests.current.delete(assistantId);
      await loadHistory();
    }
  }

  return (
    <main className="flex flex-col min-h-screen bg-neutral-50">
      <header className="p-4 border-b bg-white/70 backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">AI Salon</h1>
            <div className="text-xs text-neutral-500">
              Session: <code>{sessionId}</code>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-semibold tracking-wide ${
                safeMode ? 'text-emerald-600' : 'text-neutral-500'
              }`}
            >
              {safeMode ? 'Safe Mode Enabled' : 'Safe Mode Off'}
            </span>
            <button
              onClick={toggleSafeMode}
              className={`px-3 py-1 rounded border text-sm font-medium transition ${
                safeMode
                  ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'border-neutral-400 text-neutral-700 hover:bg-neutral-100'
              }`}
              aria-pressed={safeMode}
            >
              {safeMode ? 'Disable Safe Mode' : 'Enable Safe Mode'}
            </button>
          </div>
        </div>
        {safeMode ? (
          <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            Local-only • Cloud providers disabled • Memories stay in Safe Shelf
          </div>
        ) : safeShelfEntries.length > 0 ? (
          <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {safeShelfEntries.length} local-safe memories hidden until you enable Safe Mode or share them.
          </div>
        ) : null}
      </header>

      <AgentIdentityCard agentId={activeAgent} />

      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4">
        <section className="flex-1 flex flex-col space-y-4 overflow-y-auto pr-1">
          {!historyLoaded ? (
            <div className="text-neutral-500">Loading shared memory…</div>
          ) : visibleMessages.length === 0 ? (
            <div className="text-neutral-500">Start the conversation below.</div>
          ) : (
            visibleMessages.map((msg) => {
              if (msg.role === 'assistant') {
                const identity = getAgentDisplay(msg.agentId);
                const voiceStatus = voiceState[msg.id];
                const heygenStatus = heygenState[msg.id] ?? { status: 'idle' };
                const playable =
                  msg.audioUri || (voiceStatus?.status === 'ready' ? voiceStatus.url : undefined);

                return (
                  <div key={msg.id} className="flex gap-4 items-start bg-white p-4 rounded-lg shadow-sm border">
                    {identity.avatarUrl ? (
                      <Image
                        src={identity.avatarUrl}
                        alt={`${identity.displayName} avatar`}
                        width={48}
                        height={48}
                        className="h-12 w-12 rounded-full object-cover border"
                        style={{ borderColor: identity.color }}
                        unoptimized
                      />
                    ) : (
                      <div
                        className="h-12 w-12 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                        style={{ backgroundColor: identity.color }}
                      >
                        {identity.displayName.slice(0, 2).toUpperCase()}
                      </div>
                    )}

                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" style={{ color: identity.color }}>
                          {identity.displayName}
                        </span>
                        <span className="text-xs uppercase tracking-wide text-neutral-400">
                          {identity.providerName}
                        </span>
                        {msg.scope === 'local-safe' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase">
                            Local Safe
                          </span>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap text-neutral-800 leading-relaxed">
                        {msg.content || '…'}
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-col gap-2">
                          {voiceStatus?.status === 'loading' && (
                            <span className="text-xs text-neutral-500">Generating narration…</span>
                          )}
                          {voiceStatus?.status === 'error' && (
                            <div className="text-xs text-red-600 flex items-center gap-2">
                              Voice failed: {voiceStatus.error}
                              <button
                                type="button"
                                className="underline"
                                onClick={() => requestVoice(msg, { force: true }).catch(() => {})}
                              >
                                Retry
                              </button>
                            </div>
                          )}
                          {playable && (
                            <audio controls src={playable} className="w-full max-w-md" />
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                          <span>HeyGen avatar:</span>
                          {heygenStatus.status === 'ready' && heygenStatus.videoUrl ? (
                            <a
                              href={heygenStatus.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline text-neutral-700"
                            >
                              Open clip
                            </a>
                          ) : heygenStatus.status === 'processing' ? (
                            <span>Rendering…</span>
                          ) : heygenStatus.status === 'error' ? (
                            <span className="text-red-600">{heygenStatus.error}</span>
                          ) : (
                            <span className="text-neutral-400">Not generated</span>
                          )}
                          <button
                            type="button"
                            className="px-2 py-1 border rounded"
                            onClick={() => requestHeygen(msg)}
                            disabled={
                              safeMode ||
                              heygenStatus.status === 'processing' ||
                              heygenStatus.status === 'requesting'
                            }
                          >
                            {safeMode
                              ? 'Locked in Safe Mode'
                              : heygenStatus.status === 'processing' || heygenStatus.status === 'requesting'
                              ? 'Working…'
                              : 'Generate clip'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="ml-auto max-w-3xl text-right bg-blue-50 border border-blue-100 p-3 rounded-lg">
                  <div className="text-sm font-semibold text-blue-600">You</div>
                  <div className="whitespace-pre-wrap text-neutral-800">{msg.content}</div>
                </div>
              );
            })
          )}
          {historyError && <div className="text-red-600 text-sm">{historyError}</div>}
          {error && <div className="text-red-600 text-sm">{error}</div>}
        </section>
        <aside className="w-full lg:w-80 border border-emerald-200 bg-white/70 backdrop-blur rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700">Safe Shelf</h2>
            <span className="text-xs text-neutral-500">{safeShelfEntries.length}</span>
          </div>
          {safeShelfEntries.length === 0 ? (
            <p className="text-xs text-neutral-500">No local-safe memories captured yet.</p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {safeShelfEntries
                .slice()
                .reverse()
                .map((entry) => {
                  const created = entry.createdAt ? new Date(entry.createdAt) : null;
                  const timestamp = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : null;
                  return (
                    <li
                      key={entry.id}
                      className="border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-md p-2 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{entry.role === 'assistant' ? 'Assistant' : 'User'}</span>
                        <div className="flex items-center gap-2">
                          {entry.modelName && (
                            <span className="text-[10px] uppercase text-emerald-500">{entry.modelName}</span>
                          )}
                          {timestamp && <span className="text-[10px] text-emerald-600">{timestamp}</span>}
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap break-words max-h-24 overflow-hidden">{entry.content}</p>
                    </li>
                  );
                })}
            </ul>
          )}
          {!safeMode && safeShelfEntries.length > 0 && (
            <p className="text-[11px] text-neutral-500">
              Enable Safe Mode to bring these memories back into the thread or share them manually.
            </p>
          )}
        </aside>
      </div>

      <Composer
        onSend={onSend}
        busy={busy}
        models={modelOptions}
        selectedModel={selectedModel}
        onModelChange={(name) => setSelectedModel(name || null)}
        safeMode={safeMode}
        modelsLoading={modelsLoading}
        providerHealth={providerHealth}
      />
      <ModelFooter />
    </main>
  );
}
