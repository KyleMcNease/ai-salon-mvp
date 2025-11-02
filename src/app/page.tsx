// src/app/page.tsx
'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useVirtualizer } from '@tanstack/react-virtual';

const MEMORY_VERSION = '2025-09-01';
const DEFAULT_TENANT = 'default';
const KNOWN_PROVIDERS: Provider[] = ['gpt', 'claude', 'grok', 'opus', 'local'];
const RAIL_V2_ENABLED = process.env.NEXT_PUBLIC_UI_RAIL_V2 !== 'off';
const RAIL_STORAGE_KEY = 'ai-salon:rail';
const MODEL_STORAGE_KEY = 'ai-salon:model';
const JUMPSTART_STORAGE_KEY = 'ai-salon:jumpstart';
const VOICE_PREF_STORAGE_KEY = 'ai-salon:voice-enabled';

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

function SessionParamListener({ onChange }: { onChange: (value: string | null) => void }) {
  const searchParams = useSearchParams();

  useEffect(() => {
    onChange(searchParams.get('session'));
  }, [searchParams, onChange]);

  return null;
}

export default function Page() {
  const [sessionParam, setSessionParam] = useState<string | null>(null);
  const railV2Enabled = RAIL_V2_ENABLED;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(true);
  const [railAnnouncement, setRailAnnouncement] = useState('');
  const [safeMode, setSafeMode] = useState(false);
  const lastGlobalModelRef = useRef<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [providerHealth, setProviderHealth] = useState<Record<string, { ok: boolean; model?: string }>>({});
  const [healthTimestamp, setHealthTimestamp] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
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
  const [jumpstartExpanded, setJumpstartExpanded] = useState<boolean>(false);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(false);
  const [sessionCopyStatus, setSessionCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const copyTimeoutRef = useRef<number | null>(null);
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
  const useWindowing = visibleMessages.length > 150;
  const messageVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => messageListRef.current,
    estimateSize: () => 220,
    overscan: 12,
  });
  const [composerDraft, setComposerDraft] = useState('');
  const [draftHydrated, setDraftHydrated] = useState(false);
  const sessionDisplay = useMemo(() => {
    if (!sessionId) return 'initializing…';
    if (sessionId.length <= 16) return sessionId;
    return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
  }, [sessionId]);
  const statusSignalClass = useMemo(() => {
    const hasData = Object.keys(providerHealth).length > 0;
    if (!hasData) return 'bg-neutral-400';
    const isHealthy = Object.values(providerHealth).every((provider) => provider.ok);
    return isHealthy ? 'bg-emerald-500' : 'bg-amber-500';
  }, [providerHealth]);

  useEffect(() => {
    if (sessionParam && sessionParam.length > 10) {
      setSessionId(sessionParam);
      return;
    }
    setSessionId((prev) => prev ?? createSessionId());
  }, [sessionParam]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(RAIL_STORAGE_KEY);
    if (stored === 'open') {
      setRailCollapsed(false);
    } else if (stored === 'closed') {
      setRailCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(JUMPSTART_STORAGE_KEY);

    if (stored === 'open') {
      setJumpstartExpanded(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(VOICE_PREF_STORAGE_KEY);
    if (stored === 'off') {
      setVoiceEnabled(false);
    } else if (stored === 'on') {
      setVoiceEnabled(true);
    }
  }, []);

  const handleSessionParamChange = useCallback((value: string | null) => {
    setSessionParam(value && value.length > 0 ? value : null);
  }, []);
  const storedModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    storedModelRef.current = window.localStorage.getItem(MODEL_STORAGE_KEY);
  }, []);
  const toggleRail = useCallback((forced?: boolean) => {
    setRailCollapsed((prev) => {
      const target = typeof forced === 'boolean' ? forced : !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(RAIL_STORAGE_KEY, target ? 'closed' : 'open');
      }
      setRailAnnouncement(target ? 'Sidebar collapsed' : 'Sidebar expanded');
      return target;
    });
  }, []);
  const handleRailToggle = useCallback(() => toggleRail(), [toggleRail]);
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
  const handleCopySession = useCallback(async () => {
    if (!sessionId) return;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(sessionId);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = sessionId;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setSessionCopyStatus('copied');
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setSessionCopyStatus('idle'), 1600);
    } catch (error) {
      console.warn('Unable to copy session ID', error);
      setSessionCopyStatus('error');
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setSessionCopyStatus('idle'), 2200);
    }
  }, [sessionId]);
  const handleJumpstartToggle = useCallback(() => {
    setJumpstartExpanded((prev) => !prev);
  }, []);
  const handleVoiceToggle = useCallback(() => {
    setVoiceEnabled((prev) => !prev);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        toggleRail();
      }
      if (event.key === 'Escape' && !railCollapsed && window.matchMedia('(max-width: 1023px)').matches) {
        toggleRail(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [railCollapsed, toggleRail]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(JUMPSTART_STORAGE_KEY, jumpstartExpanded ? 'open' : 'closed');
  }, [jumpstartExpanded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VOICE_PREF_STORAGE_KEY, voiceEnabled ? 'on' : 'off');
  }, [voiceEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedModel) return;
    window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    storedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

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
    setHealthLoading(true);
    setHealthError(null);
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
      setHealthTimestamp(typeof data?.time === 'string' ? data.time : new Date().toISOString());
    } catch (error) {
      setProviderHealth((prev) =>
        Object.keys(prev).length
          ? prev
          : {
              openai: { ok: false },
              anthropic: { ok: false },
              xai: { ok: false },
              vllm: { ok: true },
              local: { ok: true },
              hf: { ok: false },
            }
      );
      setHealthTimestamp(null);
      setHealthError(error instanceof Error ? error.message : 'Unable to reach health service');
    }
    setHealthLoading(false);
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

        const storedPreference = storedModelRef.current
          ? options.find((option) => option.name === storedModelRef.current && !option.disabledReason)
          : undefined;

        if (mode) {
          const localOption =
            storedPreference && storedPreference.localOnly ? storedPreference : options.find((option) => option.localOnly);
          setSelectedModel(localOption?.name ?? pickFirstEnabled());
        } else {
          const target = storedPreference
            ? storedPreference
            : lastGlobalModelRef.current
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

      setAllMessages((prev) => {
        if (chatMessages.length === 0) {
          return prev;
        }
        return chatMessages;
      });

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
      if (!voiceEnabled) {
        return;
      }
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
    [loadHistory, safeMode, sessionId, tenantId, voiceEnabled]
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
    if (!voiceEnabled) return;
    visibleMessages.forEach((msg) => {
      if (msg.role !== 'assistant') return;
      if (!msg.content?.trim()) return;
      if (msg.audioUri) return;
      if (!voiceRequests.current.has(msg.id)) {
        voiceRequests.current.add(msg.id);
        requestVoice(msg).catch((err) => console.warn('Voice generation failed', err));
      }
    });
  }, [visibleMessages, requestVoice, voiceEnabled]);

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

    let streamingStarted = false;

    const handleEvent = (event: StreamEvent) => {
      if (event.type === 'delta') {
        if (!streamingStarted) {
          streamingStarted = true;
          setLiveAnnouncement('Assistant responding…');
        }
        updateAssistant(event.value);
      }
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
      if (streamingStarted) {
        setLiveAnnouncement('Assistant response ready.');
      }
    }
    return success;
  }

  const renderMessage = (msg: Msg) => {
    if (msg.role === 'assistant') {
      const identity = getAgentDisplay(msg.agentId);
      const voiceStatus = voiceState[msg.id];
      const heygenStatus = heygenState[msg.id] ?? { status: 'idle' };
      const playable = msg.audioUri || (voiceStatus?.status === 'ready' ? voiceStatus.url : undefined);

      return (
        <div className="flex max-w-3xl flex-col gap-3 rounded-2xl border border-[#eadfce] bg-[#fdf9f4] px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 overflow-hidden rounded-full border border-[#eadfce] bg-white shadow-sm">
                  <Image
                    src={identity.avatarUrl ?? '/avatars/default.png'}
                  alt={`${identity.displayName} avatar`}
                  fill
                  sizes="40px"
                  className="object-cover"
                />
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-neutral-700" style={{ color: identity.color }}>
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
                    <span className="text-[10px] uppercase tracking-wide text-[#8a693c]">Local Safe</span>
                  )}
                </div>
                {identity.voiceStyle && (
                  <div className="text-xs text-neutral-400">
                    Voice: <span className="text-neutral-600">{identity.voiceStyle}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="whitespace-pre-wrap text-neutral-800 leading-relaxed">{msg.content || '…'}</div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              className="rounded-lg border border-[#dfd3c1] px-3 py-1 text-neutral-600 transition hover:border-[#cbb79a] hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#806444]"
              onClick={() => requestVoice(msg)}
              disabled={voiceStatus?.status === 'loading' || !voiceEnabled}
              aria-disabled={voiceEnabled ? undefined : true}
            >
              {!voiceEnabled
                ? 'Voice disabled'
                : voiceStatus?.status === 'loading'
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
              <span className="text-red-600">
                {voiceStatus.error}{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => requestVoice(msg, { force: true })}
                >
                  Retry
                </button>
              </span>
            )}
            {playable && (
              <audio controls src={playable} className="w-full max-w-md rounded-lg border border-[#eadfce]" />
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
              disabled={safeMode || heygenStatus.status === 'processing' || heygenStatus.status === 'requesting'}
            >
              {safeMode
                ? 'Locked in Safe Mode'
                : heygenStatus.status === 'processing' || heygenStatus.status === 'requesting'
                ? 'Working…'
                : 'Generate clip'}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="ml-auto max-w-3xl rounded-2xl border border-[#d9e4ff] bg-[#eef4ff] px-4 py-3 text-right shadow-sm">
        <div className="text-sm font-semibold text-blue-600">You</div>
        <div className="whitespace-pre-wrap text-neutral-800">{msg.content}</div>
      </div>
    );
  };


  const renderLegacyLayout = () => (
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

  const renderRailLayout = () => {
    const activeIdentity = getAgentDisplay(activeAgent);
    const statusProviders = [
      { key: 'openai', label: 'GPT' },
      { key: 'anthropic', label: 'Claude' },
      { key: 'xai', label: 'Grok' },
      { key: 'local', label: 'Local' },
    ] as const;

    return (
      <main className="relative flex h-screen bg-[#f6f0ea] text-neutral-900">
        <span aria-live="polite" className="sr-only">
          {railAnnouncement}
        </span>
        <span aria-live="polite" className="sr-only">
          {liveAnnouncement}
        </span>
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-72 transform transition-transform duration-200 ease-out md:w-80 ${
            railCollapsed ? '-translate-x-full md:-translate-x-full' : 'translate-x-0 md:translate-x-0'
          }`}
          aria-hidden={railCollapsed ? 'true' : 'false'}
        >
          <div className="flex h-full flex-col border-r border-[#eadfce] bg-[#fdf7f1]/95 backdrop-blur">
            <div className="flex items-start justify-between gap-3 border-b border-[#eadfce] px-4 py-4">
              <div className="space-y-1">
                <span className="text-sm font-semibold text-neutral-600">Workspace</span>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <span className={`h-2 w-2 rounded-full ${statusSignalClass}`} aria-hidden="true" />
                  <span>Status</span>
                  {healthTimestamp && (
                    <span className="text-[10px] uppercase text-neutral-400">
                      {new Date(healthTimestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-500">
                  Safe Shelf: {safeShelfEntries.length}{' '}
                  <span className={safeMode ? 'text-emerald-600' : 'text-neutral-500'}>
                    {safeMode ? '• Safe Mode on' : '• Safe Mode off'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRailToggle}
                className="rounded-lg border border-[#e7d7c2] bg-white p-2 text-neutral-500 transition hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                aria-label="Collapse sidebar"
                aria-expanded={!railCollapsed}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
              <section className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-[#a2703d]">
                  <span>Session</span>
                  <span className="text-[11px] font-medium text-neutral-500">
                    {sessionCopyStatus === 'copied'
                      ? 'Copied'
                      : sessionCopyStatus === 'error'
                      ? 'Copy failed'
                      : 'Copy ID'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopySession}
                  disabled={!sessionId}
                  className="flex w-full items-center justify-between rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-left text-sm font-mono text-neutral-700 transition hover:border-[#cfb48d] hover:bg-[#fff9ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{sessionDisplay}</span>
                  <span className="text-xs text-neutral-400">Copy</span>
                </button>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-700">Models</h2>
                  {modelsLoading && <span className="text-xs text-neutral-400">Loading…</span>}
                </div>
                <p className="text-xs text-neutral-500">Pick where responses stream from.</p>
                <select
                  id="model-picker-rail"
                  className="w-full rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-sm shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347] disabled:bg-neutral-100"
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
                <ModelStatusBadge
                  model={selectedModelOption}
                  loading={modelsLoading}
                  providerHealth={providerHealth}
                />
                {selectedModelOption?.description && (
                  <p className="text-xs text-neutral-500">{selectedModelOption.description}</p>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-700">Jump-start</h2>
                  <button
                    type="button"
                    onClick={handleJumpstartToggle}
                    className="text-xs font-medium text-[#a2703d] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                  >
                    {jumpstartExpanded ? 'Show less' : 'Show more'}
                  </button>
                </div>
                {suggestionsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: jumpstartExpanded ? 4 : 2 }).map((_, index) => (
                      <div key={index} className="h-12 animate-pulse rounded-lg border border-[#e7d7c2] bg-[#f5ede1]" />
                    ))}
                  </div>
                ) : suggestions.length > 0 ? (
                  <div className="space-y-2">
                    {(jumpstartExpanded ? suggestions : suggestions.slice(0, 2)).map((suggestion) => (
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
                ) : (
                  <p className="text-xs text-neutral-500">Add prompts to get started quickly.</p>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-700">Active agent</h2>
                  <button
                    type="button"
                    onClick={handleAgents}
                    className="text-xs font-medium text-[#a2703d] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                  >
                    Switch agent
                  </button>
                </div>
                <AgentIdentityCard agentId={activeAgent} />
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-700">Research board</h2>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleResearch}
                    className="flex items-center justify-between rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-left text-sm transition hover:border-[#cfb48d] hover:bg-[#fff9ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                    disabled={safeMode}
                    title={safeMode ? 'Unavailable while Safe Mode is on' : undefined}
                  >
                    <span>Deep Survey</span>
                    {safeMode && <span className="text-xs text-neutral-400">Safe Mode</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => console.info('Idea Spark coming soon.')}
                    className="flex items-center justify-between rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-left text-sm transition hover:border-[#cfb48d] hover:bg-[#fff9ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                    disabled={safeMode}
                    title={safeMode ? 'Unavailable while Safe Mode is on' : 'Open Idea Spark'}
                  >
                    <span>Idea Spark</span>
                    {safeMode && <span className="text-xs text-neutral-400">Safe Mode</span>}
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-neutral-700">Library</h2>
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={handleResearch}
                    className="flex items-center justify-between rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-left text-sm transition hover:border-[#cfb48d] hover:bg-[#fff9ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                  >
                    <span>Papers &amp; Notes</span>
                    <span className="text-xs text-neutral-400">Open</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSessions}
                    className="flex items-center justify-between rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-left text-sm transition hover:border-[#cfb48d] hover:bg-[#fff9ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                  >
                    <span>Sessions</span>
                    <span className="text-xs text-neutral-400">History</span>
                  </button>
                  <div className="rounded-lg border border-[#e7d7c2] bg-[#f9f1e4]/70 px-3 py-2 text-sm text-[#5f4a34]">
                    Safe Shelf keeps {safeShelfEntries.length} local notes ready to resurface.
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-700">Status</h2>
                  <button
                    type="button"
                    onClick={loadHealth}
                    className="rounded border border-[#e7d7c2] px-2 py-1 text-xs text-neutral-600 transition hover:border-[#cfb48d] hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                    disabled={healthLoading}
                  >
                    {healthLoading ? 'Checking…' : 'Refresh'}
                  </button>
                </div>
                {healthError && <p className="text-xs text-red-600">{healthError}</p>}
                <ul className="space-y-2">
                  {statusProviders.map((provider) => {
                    const entry = providerHealth[provider.key] ?? null;
                    return (
                      <li
                        key={provider.key}
                        className="flex items-center justify-between rounded-lg border border-[#e7d7c2] bg-white px-3 py-2 text-sm"
                      >
                        <span className="font-medium text-neutral-700">{provider.label}</span>
                        <span className="flex items-center gap-2 text-xs text-neutral-500">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              entry ? (entry.ok ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-neutral-400'
                            }`}
                          />
                          <span>{entry?.model ?? '—'}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {healthTimestamp && (
                  <p className="text-xs text-neutral-400">Last check {new Date(healthTimestamp).toLocaleTimeString()}</p>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-neutral-700">Settings</h2>
                <div className="space-y-2 text-sm text-neutral-600">
                  <button
                    type="button"
                    onClick={handleVoiceToggle}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347] ${
                      voiceEnabled ? 'border-[#dfd3c1] bg-white hover:border-[#cfb48d]' : 'border-dashed border-[#dfd3c1] bg-[#faf4eb]'
                    }`}
                    aria-pressed={voiceEnabled}
                  >
                    <span>Voice responses</span>
                    <span className="text-xs text-neutral-500">{voiceEnabled ? 'On' : 'Off'}</span>
                  </button>
                  <p className="text-xs text-neutral-500">
                    Mic shortcuts: ⌘/Ctrl+U to attach files, Esc to cancel recording.
                  </p>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-[#a2703d]">
                  <span>Safe Shelf</span>
                  <span>{safeShelfEntries.length}</span>
                </div>
                {safeShelfEntries.length === 0 ? (
                  <p className="text-xs text-neutral-500">No local-safe memories captured yet.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-neutral-600">
                    {safeShelfPreview.map((entry) => {
                      const created = entry.createdAt ? new Date(entry.createdAt) : null;
                      const timestamp =
                        created && !Number.isNaN(created.getTime()) ? created.toLocaleTimeString() : 'recently';
                      return (
                        <li key={entry.id} className="rounded-lg border border-[#e4d4c0] bg-[#fdfaf6] p-2 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{entry.role === 'assistant' ? 'Assistant' : 'You'}</span>
                            <span className="text-[11px] text-neutral-400">{timestamp}</span>
                          </div>
                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[#5f4a34]">{entry.content}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </nav>
          </div>
        </aside>
        {!railCollapsed && (
          <button
            type="button"
            className="fixed inset-0 z-20 bg-black/20 backdrop-blur-sm md:hidden"
            onClick={() => toggleRail(true)}
            aria-label="Dismiss sidebar"
          />
        )}
        <div
          className={`flex w-full flex-col overflow-hidden bg-[#f8f2eb] transition-transform duration-200 ease-out ${
            railCollapsed ? 'md:translate-x-0' : 'md:translate-x-[20rem]'
          }`}
        >
          <header className="sticky top-0 z-10 border-b border-[#eadfce] bg-[#fdf9f4]/90 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-3 md:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRailToggle}
                  className="inline-flex items-center justify-center rounded-lg border border-[#e7d7c2] bg-white p-2 text-neutral-500 transition hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c6347]"
                  aria-label={railCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
                  aria-expanded={!railCollapsed}
                >
                  {railCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
                <h1 className="text-lg font-semibold md:text-2xl">AI Salon</h1>
                {railCollapsed && <span className={`ml-1 h-2 w-2 rounded-full ${statusSignalClass}`} aria-hidden="true" />}
              </div>
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
          </header>
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              ref={messageListRef}
              className="relative flex-1 overflow-y-auto px-4 py-4 md:px-6"
              aria-live="polite"
            >
              {!historyLoaded ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-2xl border border-[#eadfce] bg-[#fdf9f4]" />
                  ))}
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-[#eadfce] bg-[#fdf9f4] px-5 py-6 text-center text-sm text-[#5f4a34] shadow-sm">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#eadfce] bg-white px-3 py-1 text-xs text-neutral-600">
                    <span className="font-medium">{activeIdentity.displayName}</span>
                    <span className="text-neutral-400">{activeIdentity.providerName}</span>
                  </div>
                  Ready when you are. Open the sidebar for quick actions.
                </div>
              ) : useWindowing ? (
                <div style={{ height: messageVirtualizer.getTotalSize() }} className="relative">
                  {messageVirtualizer.getVirtualItems().map((virtualRow) => {
                    const msg = visibleMessages[virtualRow.index];
                    return (
                      <div
                        key={msg.id}
                        className="absolute left-0 right-0 pb-4"
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        {renderMessage(msg)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleMessages.map((msg) => (
                    <div key={msg.id}>{renderMessage(msg)}</div>
                  ))}
                </div>
              )}
              {historyError && <div className="mt-4 text-sm text-red-600">{historyError}</div>}
              {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
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
              voiceEnabled={voiceEnabled}
            />
          </div>
        </div>
      </main>
    );
  };

  const layout = railV2Enabled ? renderRailLayout() : renderLegacyLayout();

  return (
    <>
      <Suspense fallback={null}>
        <SessionParamListener onChange={handleSessionParamChange} />
      </Suspense>
      {layout}
    </>
  );
}
