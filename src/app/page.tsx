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
const KNOWN_PROVIDERS: Provider[] = ['gpt', 'claude', 'grok', 'opus'];

const isProvider = (value: unknown): value is Provider =>
  typeof value === 'string' && KNOWN_PROVIDERS.includes(value as Provider);

export type Provider = 'gpt' | 'claude' | 'grok' | 'opus';

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentId?: Provider;
  createdAt?: string;
  audioUri?: string;
  voiceId?: string;
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

function parseProvider(raw: string, fallback: Provider = 'gpt') {
  const m = raw.match(/^@(gpt|claude|grok|opus)/i);
  if (!m) return { provider: fallback, prompt: raw.trim() };
  return { provider: m[1].toLowerCase() as Provider, prompt: raw.slice(m[0].length).trim() };
}

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

export default function Page() {
  const searchParams = useSearchParams();
  const sessionParam = searchParams?.get('session');

  const [messages, setMessages] = useState<Msg[]>([]);
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
          setMessages([]);
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
          return {
            id: entry.id,
            role: entry.role,
            content: entry.content,
            createdAt: entry.created_at,
            agentId,
            audioUri: artifact?.uri,
            voiceId: artifact?.voiceId ?? (metadata?.voice_id as string | undefined),
          } satisfies Msg;
        });

      setMessages(chatMessages);
      const lastAssistant = [...chatMessages].reverse().find((msg) => msg.role === 'assistant');
      if (lastAssistant?.agentId) {
        setActiveAgent(lastAssistant.agentId);
      }
      setHistoryLoaded(true);
    } catch (err: any) {
      setHistoryError(err?.message || 'Unable to load history');
      setHistoryLoaded(true);
    }
  }, [sessionId, tenantId]);

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
    [loadHistory, sessionId, tenantId]
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
    [pollHeygenStatus]
  );

  useEffect(() => {
    setVoiceState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const msg of messages) {
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
  }, [messages]);

  useEffect(() => {
    messages.forEach((msg) => {
      if (msg.role !== 'assistant') return;
      if (!msg.content?.trim()) return;
      if (msg.audioUri) return;
      if (!voiceRequests.current.has(msg.id)) {
        voiceRequests.current.add(msg.id);
        requestVoice(msg).catch((err) => console.warn('Voice generation failed', err));
      }
    });
  }, [messages, requestVoice]);

  async function onSend(text: string) {
    const { provider, prompt } = parseProvider(text);
    if (!prompt) return;

    setHistoryError(null);
    setActiveAgent(provider);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: 'user',
        content: prompt,
        agentId: provider,
        createdAt: new Date().toISOString(),
      },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        agentId: provider,
        createdAt: new Date().toISOString(),
      },
    ]);

    const updateAssistant = (delta: string) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content + delta } : msg))
      );
    };

    const handleEvent = (event: StreamEvent) => {
      if (event.type === 'delta') updateAssistant(event.value);
      if (event.type === 'error') setHistoryError(event.data);
    };

    try {
      for await (const ev of send({ prompt, provider, sessionId, tenantId })) {
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
      <header className="p-4 border-b space-y-1 bg-white/70 backdrop-blur">
        <h1 className="text-2xl font-semibold">AI Salon</h1>
        <div className="text-xs text-neutral-500">
          Session: <code>{sessionId}</code>
        </div>
      </header>

      <AgentIdentityCard agentId={activeAgent} />

      <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto">
        {!historyLoaded ? (
          <div className="text-neutral-500">Loading shared memory…</div>
        ) : messages.length === 0 ? (
          <div className="text-neutral-500">Start the conversation below.</div>
        ) : (
          messages.map((msg) => {
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
                          disabled={heygenStatus.status === 'processing' || heygenStatus.status === 'requesting'}
                        >
                          {heygenStatus.status === 'processing' || heygenStatus.status === 'requesting'
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
      </div>

      <Composer onSend={onSend} busy={busy} />
      <ModelFooter />
    </main>
  );
}
