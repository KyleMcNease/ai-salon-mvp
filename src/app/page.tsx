// src/app/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';

import AgentIdentityCard from '@/components/AgentIdentityCard';
import Composer from '@/components/Composer';
import ModelFooter from '@/components/ModelFooter';
import ModelStatusBadge from '@/components/ModelStatusBadge';
import { getAgentDisplay } from '@/config/agents';
import { useStreamedChat, type StreamEvent } from '@/hooks/useStreamedChat';
import type { ModelOption, ProviderId } from '@/types/models';
import { scanPromptTokens } from '@/lib/promptParsing';
import {
  PanelLeft,
  PanelLeftOpen,
  PanelLeftClose,
  MessageSquarePlus,
  Bot,
  FlaskConical,
  History,
  Shield,
  Lightbulb,
} from 'lucide-react';

const MEMORY_VERSION = '2025-09-01';
const DEFAULT_TENANT = 'default';
const KNOWN_PROVIDERS: Provider[] = ['gpt', 'claude', 'grok', 'opus', 'local'];

const isProvider = (value: unknown): value is Provider =>
  typeof value === 'string' && KNOWN_PROVIDERS.includes(value as Provider);

export type Provider = ProviderId;

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

type Suggestion = {
  id: string;
  title: string;
  body: string;
  prompt: string;
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

const createSessionId = () => {
  const globalCrypto = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export default function Page() {
  const searchParams = useSearchParams();
  const sessionParam = searchParams?.get('session');

  const [sessionId, setSessionId] = useState<string | null>(() =>
    sessionParam && sessionParam.length > 10 ? sessionParam : null
  );
  const [railCollapsed, setRailCollapsed] = useState(false);
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const visibleMessages = useMemo(
    () => (safeMode ? allMessages : allMessages.filter((msg) => msg.scope !== 'local-safe')),
    [allMessages, safeMode]
  );
  const safeShelfEntries = useMemo(
    () => allMessages.filter((msg) => msg.scope === 'local-safe'),
    [allMessages]
  );
  const safeShelfPreview = useMemo(
    () => safeShelfEntries.slice().reverse().slice(0, 3),
    [safeShelfEntries]
  );
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<Provider>('gpt');
  const { send, busy, error } = useStreamedChat('/api/chat');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const [composerDraft, setComposerDraft] = useState('');
  const [draftHydrated, setDraftHydrated] = useState(false);

  useEffect(() => {
    if (sessionParam && sessionParam.length > 10) {
      setSessionId(sessionParam);
      return;
    }
    setSessionId((prev) => prev ?? createSessionId());
  }, [sessionParam]);
  const handleRailToggle = useCallback(() => setRailCollapsed((prev) => !prev), []);
  const handleNewChat = useCallback(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('session');
    window.location.assign(url.pathname);
  }, []);
  const handleAgents = useCallback(() => {
    console.info('Agents library entry point coming soon.');
  }, []);
  const handleResearch = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.location.assign('/narrator');
  }, []);
  const handleSessions = useCallback(() => {
    console.info('Sessions list UI coming soon.');
  }, []);
  const handleUploadClick = useCallback(() => {
    console.info('Upload flow coming soon.');
  }, []);
  const handleMicClick = useCallback(() => {
    console.info('Microphone capture coming soon.');
  }, []);
  const handleSuggestionSelect = useCallback((prompt: string) => {
    setComposerDraft((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n\n${prompt}` : prompt;
    });
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => composerRef.current?.focus());
    } else {
      composerRef.current?.focus();
    }
  }, []);
  const railItems = useMemo(
    () => [
      {
        key: 'new-chat',
        label: 'New Chat',
        icon: MessageSquarePlus,
        onClick: handleNewChat,
        hint: 'Start a fresh session',
      },
      {
        key: 'agents',
        label: 'Agents',
        icon: Bot,
        onClick: handleAgents,
        hint: 'Browse saved specialist agents',
      },
      {
        key: 'research',
        label: 'Research',
        icon: FlaskConical,
        onClick: handleResearch,
        hint: 'Jump to the Research board',
      },
      {
        key: 'sessions',
        label: 'Sessions',
        icon: History,
        onClick: handleSessions,
        hint: 'Review prior conversations',
      },
    ],
    [handleAgents, handleNewChat, handleResearch, handleSessions]
  );

  const draftKey = useMemo(() => (sessionId ? `chat-draft-${sessionId}` : null), [sessionId]);
  const tenantId = DEFAULT_TENANT;
  const selectedModelOption = useMemo(() => {
    if (!selectedModel) return null;
    return modelOptions.find((option) => option.name === selectedModel) ?? null;
  }, [modelOptions, selectedModel]);
  useEffect(() => {
    setDraftHydrated(false);
    if (typeof window === 'undefined') return;
    if (!draftKey) {
      setComposerDraft('');
      setDraftHydrated(true);
      return;
    }
    try {
      const stored = window.localStorage.getItem(draftKey);
      setComposerDraft(stored ?? '');
    } catch (err) {
      console.warn('Unable to load composer draft', err);
      setComposerDraft('');
    } finally {
      setDraftHydrated(true);
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftHydrated || typeof window === 'undefined' || !draftKey) return;
    try {
      if (composerDraft) {
        window.localStorage.setItem(draftKey, composerDraft);
      } else {
        window.localStorage.removeItem(draftKey);
      }
    } catch (err) {
      console.warn('Unable to persist composer draft', err);
    }
  }, [composerDraft, draftHydrated, draftKey]);

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
    let active = true;
    setSuggestionsLoading(true);
    const timer = typeof window !== 'undefined' ? window.setTimeout(() => {
      if (!active) return;
      const presetSuggestions: Suggestion[] = [
        {
          id: 'plan-scout',
          title: 'Spin up a research plan',
          body: 'Map the next steps for the Research board with cite-able sources.',
          prompt:
            'Draft a concise research plan outlining three focus areas and key sources for evaluating frontier AI safety updates this week.',
        },
        {
          id: 'agent-handshake',
          title: 'Compose a multi-agent brief',
          body: 'Prep Claude + GPT hand-off notes with goals, tone, and guardrails.',
          prompt:
            'Write a shared brief that aligns Claude and GPT on tone, goals, and safety guidelines for assisting a startup founder exploring AI copilots.',
        },
        {
          id: 'memory-digest',
          title: 'Summarize Safe Shelf memories',
          body: 'Review local-safe context and highlight what should ship upstream.',
          prompt:
            'Summarize the local-safe memories in the Safe Shelf and recommend which items are ready to share with the global workspace.',
        },
        {
          id: 'session-retro',
          title: 'Retro the last session',
          body: 'Turn the previous chat into action items with owners and due dates.',
          prompt:
            'Convert the most recent session transcript into a list of action items with suggested owners and deadlines.',
        },
      ];
      setSuggestions(presetSuggestions);
      setSuggestionsLoading(false);
    }, 150) : undefined;
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const element = messageListRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visibleMessages.length]);

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
      const mentionSet = new Set<string>();
      const toolSet = new Set<string>();
      const { mentionTokens, toolTokens } = scanPromptTokens(input);

      for (const { raw, token } of mentionTokens) {
        const option = resolveMention(token);
        if (!option) continue;
        mentionSet.add(option.name);
        cleaned = cleaned.replace(raw, ' ');
      }

      for (const { raw, token } of toolTokens) {
        toolSet.add(token);
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
    if (!sessionId) {
      setHistoryLoaded(false);
      return;
    }
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
  }, [sessionId, tenantId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, safeMode]);

  const requestVoice = useCallback(
    async (message: Msg, options: { force?: boolean } = {}) => {
      if (message.role !== 'assistant') return;
      if (!message.content?.trim()) return;
      if (!sessionId) return;

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
    if (!prompt) return false;
    if (!sessionId) {
      setHistoryError('Session is initializing. Please try again in a moment.');
      return false;
    }

    if (!selectedModelOption) {
      setHistoryError('No model selected');
      return false;
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

    let success = true;
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
      success = false;
    } finally {
      voiceRequests.current.delete(assistantId);
      await loadHistory();
    }
    return success;
  }


  return (
    <main className="flex h-screen bg-[#f6f0ea] text-neutral-900">
      <aside
        className={`${
          railCollapsed ? 'w-14' : 'w-64'
        } flex h-full flex-col border-r border-[#eadfce] bg-[#fdf7f1]/90 backdrop-blur transition-all duration-300`}
      >
        <div className="flex items-center justify-between border-b border-[#eadfce] px-3 py-4">
          {!railCollapsed && <span className="text-sm font-semibold text-neutral-600">Workspace</span>}
          <button
            type="button"
            onClick={handleRailToggle}
            className="rounded-lg border border-[#e7d7c2] bg-white p-2 text-neutral-500 transition hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            aria-label={railCollapsed ? 'Expand rail' : 'Collapse rail'}
          >
            {railCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-4">
          <div className="space-y-1">
            {railItems.map(({ key, label, icon: Icon, onClick, hint }) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-[#f2e7d8] hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347] ${railCollapsed ? 'justify-center px-2' : ''}`}
                title={hint}
              >
                <Icon className="h-4 w-4" />
                {!railCollapsed && <span>{label}</span>}
              </button>
            ))}
          </div>
          {!railCollapsed &&
            (suggestionsLoading ? (
              <div className="space-y-2 rounded-xl border border-[#e9dcc9] bg-[#f9f3eb] p-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#a2703d]">
                  <Lightbulb className="h-4 w-4" />
                  Quick actions
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-10 animate-pulse rounded-lg border border-[#e7d7c2] bg-[#f5ede1]"
                    />
                  ))}
                </div>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="space-y-2 rounded-xl border border-[#e9dcc9] bg-[#fefbf7] p-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#a2703d]">
                  <Lightbulb className="h-4 w-4" />
                  Quick actions
                </div>
                <div className="space-y-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => handleSuggestionSelect(suggestion.prompt)}
                      className="w-full rounded-lg border border-[#e2cfb7] bg-white px-3 py-2 text-left text-sm text-[#443629] shadow-sm transition hover:border-[#cfb48d] hover:bg-[#fff9ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                    >
                      <div className="font-semibold">{suggestion.title}</div>
                      <p className="text-xs text-neutral-500">{suggestion.body}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null)}
          <div
            className={`rounded-xl border border-[#e7d7c2] bg-[#f9f1e4]/90 p-3 transition ${
              railCollapsed ? 'px-2 text-center' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              {!railCollapsed && (
                <span className="text-xs font-semibold uppercase tracking-wide text-[#a2703d]">
                  Safe Shelf
                </span>
              )}
              <div className="flex items-center gap-1 text-xs text-[#a2703d]">
                <Shield className="h-3 w-3" />
                <span>{safeShelfEntries.length}</span>
              </div>
            </div>
            {railCollapsed ? (
              <p className="mt-2 text-[10px] text-[#a2703d]">Expand to review local-safe notes.</p>
            ) : safeShelfEntries.length === 0 ? (
              <p className="mt-3 text-xs text-[#a2703d]">No local-safe memories captured yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-xs text-[#5f4a34]">
                {safeShelfPreview.map((entry) => {
                  const created = entry.createdAt ? new Date(entry.createdAt) : null;
                  const timestamp =
                    created && !Number.isNaN(created.getTime()) ? created.toLocaleTimeString() : 'recently';
                  return (
                    <li
                      key={entry.id}
                      className="rounded-lg border border-[#e4d4c0] bg-[#fdfaf6] p-2 shadow-sm"
                    >
                      <div className="flex items-center justify-between text-[11px] text-[#7d6041]">
                        <span className="font-semibold">
                          {entry.role === 'assistant' ? 'Assistant' : 'You'}
                        </span>
                        <span>{timestamp}</span>
                      </div>
                      {entry.modelName && (
                        <div className="text-[10px] uppercase text-[#b3844e]">{entry.modelName}</div>
                      )}
                      <p className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap break-words text-[#5f4a34]">
                        {entry.content}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 border-b border-[#eadfce] bg-[#fdf9f4]/90 backdrop-blur">
          <div className="flex flex-col gap-3 px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={handleRailToggle}
                  className="inline-flex items-center justify-center rounded-lg border border-[#e7d7c2] bg-white p-2 text-neutral-500 transition hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347] md:hidden"
                  aria-label="Toggle rail"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
                <h1 className="text-lg font-semibold md:text-2xl">AI Salon</h1>
                <div className="text-xs text-neutral-500">
                  Session:{' '}
                  <code className="rounded bg-[#f1e7da] px-1 py-[1px] text-[#6d5b45]">
                    {sessionId ?? 'initializing…'}
                  </code>
                </div>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="model-picker"
                    className="text-xs uppercase tracking-wide text-neutral-500"
                  >
                    Model
                  </label>
                  <select
                    id="model-picker"
                    className="min-w-[10rem] rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-sm shadow-sm disabled:bg-neutral-100"
                    value={selectedModel ?? ''}
                    onChange={(event) => setSelectedModel(event.target.value || null)}
                    disabled={modelsLoading || busy || modelOptions.length === 0}
                  >
                    {modelOptions.length === 0 ? (
                      <option value="" disabled>
                        {modelsLoading ? 'Loading models…' : 'No models available'}
                      </option>
                    ) : (
                      modelOptions.map((model) => (
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
                <ModelStatusBadge
                  model={selectedModelOption}
                  loading={modelsLoading}
                  providerHealth={providerHealth}
                />
                <button
                  type="button"
                  onClick={toggleSafeMode}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347] ${
                    safeMode
                      ? 'border border-emerald-500/70 bg-emerald-500 text-white hover:bg-emerald-400'
                      : 'border border-[#e0d5c2] bg-white text-neutral-600 hover:bg-[#f8f1e7]'
                  }`}
                  aria-pressed={safeMode}
                >
                  {safeMode ? 'Safe Mode Enabled' : 'Safe Mode Off'}
                </button>
              </div>
            </div>
            {safeMode ? (
              <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/90 px-3 py-2 text-sm text-emerald-700">
                Local-only • Cloud providers disabled • Memories stay in Safe Shelf
              </div>
            ) : safeShelfEntries.length > 0 ? (
              <div className="rounded-lg border border-[#ecd7b5] bg-[#fff3da] px-3 py-2 text-sm text-[#b37a32]">
                {safeShelfEntries.length} local-safe memories hidden until you enable Safe Mode or share them.
              </div>
            ) : null}
          </div>
        </header>
        <div className="flex flex-1 flex-col overflow-hidden bg-[#f8f2eb]">
          <AgentIdentityCard agentId={activeAgent} />
          <div className="flex flex-1 flex-col gap-6 overflow-hidden px-4 pb-6 pt-6 md:px-6">
            {visibleMessages.length === 0 && (
              <div className="rounded-2xl border border-[#eadfce] bg-[#fdf9f4] px-5 py-6 text-sm text-[#5f4a34] shadow-sm">
                Ready when you are. Type a prompt below or open the left rail for quick actions.
              </div>
            )}
            <div
              ref={messageListRef}
              className="flex-1 space-y-4 overflow-y-auto pr-1 will-change-transform"
            >
              {!historyLoaded ? (
                <div className="rounded-lg border border-[#eadfce] bg-[#fdf9f4] px-4 py-3 text-neutral-500 shadow-sm">
                  Loading shared memory…
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="rounded-lg border border-[#eadfce] bg-[#fdf9f4] px-4 py-6 text-sm text-neutral-500 shadow-sm">
                  No sessions yet—start a new chat or open the Research board.
                </div>
              ) : (
                visibleMessages.map((msg) => {
                  if (msg.role === 'assistant') {
                    const identity = getAgentDisplay(msg.agentId);
                    const voiceStatus = voiceState[msg.id];
                    const heygenStatus = heygenState[msg.id] ?? { status: 'idle' };
                    const playable =
                      msg.audioUri || (voiceStatus?.status === 'ready' ? voiceStatus.url : undefined);

                    return (
                      <div
                        key={msg.id}
                        className="flex gap-4 rounded-2xl border border-[#eadfce] bg-[#fefbf7] p-4 shadow-sm transition hover:shadow-md"
                      >
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
                            className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold text-white"
                            style={{ backgroundColor: identity.color }}
                          >
                            {identity.displayName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-neutral-800" style={{ color: identity.color }}>
                              {identity.displayName}
                            </span>
                            <span className="text-xs uppercase tracking-wide text-neutral-400">
                              {identity.providerName}
                            </span>
                            {msg.modelName && (
                              <span className="text-[10px] uppercase text-neutral-400">{msg.modelName}</span>
                            )}
                            <span className="text-xs text-neutral-400">
                              {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'moments ago'}
                            </span>
                            {msg.scope === 'local-safe' && (
                              <span className="text-[10px] uppercase tracking-wide text-[#8a693c]">
                                Local Safe
                              </span>
                            )}
                          </div>
                          <div className="whitespace-pre-wrap text-neutral-800 leading-relaxed">
                            {msg.content || '…'}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <button
                              type="button"
                              className="rounded-lg border border-[#dfd3c1] px-3 py-1 text-neutral-600 transition hover:border-[#cbb79a] hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#806444]"
                              onClick={() => requestVoice(msg)}
                              disabled={voiceStatus?.status === 'loading'}
                            >
                              {voiceStatus?.status === 'loading'
                                ? 'Generating audio…'
                                : voiceStatus?.status === 'ready'
                                ? 'Replay voice'
                                : voiceStatus?.status === 'error'
                                ? 'Retry voice'
                                : msg.audioUri
                                ? 'Play voice'
                                : 'Generate voice'}
                            </button>
                            {voiceStatus?.status === 'error' && (
                              <span className="text-red-600">{voiceStatus.error}</span>
                            )}
                            {playable && (
                              <audio
                                controls
                                src={playable}
                                className="w-full max-w-md rounded-lg border border-[#eadfce]"
                              />
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
                              className="rounded-lg border border-[#dfd3c1] px-3 py-1 text-neutral-600 transition hover:border-[#cbb79a] hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#806444]"
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
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className="ml-auto max-w-3xl rounded-2xl border border-[#d9e4ff] bg-[#eef4ff] px-4 py-3 text-right shadow-sm"
                    >
                      <div className="text-sm font-semibold text-blue-600">You</div>
                      <div className="whitespace-pre-wrap text-neutral-800">{msg.content}</div>
                    </div>
                  );
                })
              )}
            </div>
            {historyError && <div className="text-sm text-red-600">{historyError}</div>}
            {error && <div className="text-sm text-red-600">{error}</div>}
          </div>
        </div>
        <Composer
          value={composerDraft}
          onChange={setComposerDraft}
          onSend={onSend}
          busy={busy}
          safeMode={safeMode}
          textareaRef={composerRef}
          onUploadClick={handleUploadClick}
          onMicClick={handleMicClick}
        />
        <ModelFooter />
      </div>
    </main>
  );
}
