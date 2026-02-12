"use client";

import { useEffect, useMemo, useState } from "react";
import { Cinzel, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

type SessionMessage = {
  role: "user" | "assistant" | string;
  speaker: string;
  content: string;
  provider?: string;
  model?: string;
  timestamp?: string;
};

type SessionPayload = {
  session_id: string;
  messages: SessionMessage[];
  memory?: SessionMemory;
  updated_at?: string | null;
};

type SessionMemory = {
  summary: string;
  key_facts: string[];
  user_preferences: string[];
  agent_notes: string[];
  updated_at?: string | null;
};

type ProviderProfile = {
  id: string;
  provider: string;
  auth_mode: string;
  enabled: boolean;
};

type Persona = {
  id: string;
  name: string;
  role: string;
  voice_id?: string | null;
  description?: string;
};

type ResearchMode = "hybrid" | "novix" | "llnl" | "google";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-duet",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-duet-mono",
});
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["500", "700"],
});

function randomSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
}

function emptyMemory(): SessionMemory {
  return {
    summary: "",
    key_facts: [],
    user_preferences: [],
    agent_notes: [],
    updated_at: null,
  };
}

function normalizeMemory(memory: unknown): SessionMemory {
  const fallback = emptyMemory();
  if (!memory || typeof memory !== "object") {
    return fallback;
  }
  const value = memory as Partial<SessionMemory>;
  const cleanList = (items: unknown): string[] =>
    Array.isArray(items)
      ? items.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];
  return {
    summary: typeof value.summary === "string" ? value.summary : "",
    key_facts: cleanList(value.key_facts),
    user_preferences: cleanList(value.user_preferences),
    agent_notes: cleanList(value.agent_notes),
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
  };
}

function safeBuildUrl(base: string, params: Record<string, string>): string {
  try {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  } catch {
    const query = new URLSearchParams(params).toString();
    if (!query) {
      return base;
    }
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  }
}

export default function DuetWorkbench() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const researchAppDefault = process.env.NEXT_PUBLIC_RESEARCH_APP_URL || "";

  const [quickMode, setQuickMode] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [showPersonas, setShowPersonas] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [embedResearch, setEmbedResearch] = useState(false);

  const [sessionId, setSessionId] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are part of a private SCRIBE duet. Keep responses concise, concrete, and build on prior turns."
  );
  const [researchUrl, setResearchUrl] = useState(researchAppDefault);
  const [researchMode, setResearchMode] = useState<ResearchMode>("hybrid");
  const [researchQuery, setResearchQuery] = useState("");
  const [researchHandoffId, setResearchHandoffId] = useState<string>("");
  const [handoffStatus, setHandoffStatus] = useState<string>("");

  const [ingestText, setIngestText] = useState("");
  const [ingestStatus, setIngestStatus] = useState<string>("");

  const [message, setMessage] = useState("");
  const [loopRounds, setLoopRounds] = useState(2);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload>({
    session_id: sessionId,
    messages: [],
  });
  const [memory, setMemory] = useState<SessionMemory>(emptyMemory());
  const [memorySummaryInput, setMemorySummaryInput] = useState("");
  const [memoryFactsInput, setMemoryFactsInput] = useState("");
  const [memoryPrefsInput, setMemoryPrefsInput] = useState("");
  const [memoryNotesInput, setMemoryNotesInput] = useState("");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [openaiProfile, setOpenaiProfile] = useState("openai:default");
  const [anthropicProfile, setAnthropicProfile] = useState("anthropic:default");
  const [openaiModel, setOpenaiModel] = useState("gpt-5");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-5");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [voices, setVoices] = useState<string[]>([]);

  const sortedMessages = useMemo(() => [...session.messages], [session.messages]);
  const hasResearchUrl = researchUrl.trim().length > 0;

  const latestUserPrompt = useMemo(() => {
    if (researchQuery.trim()) {
      return researchQuery.trim();
    }
    if (message.trim()) {
      return message.trim();
    }
    for (let index = sortedMessages.length - 1; index >= 0; index -= 1) {
      const candidate = sortedMessages[index];
      if (candidate.role === "user" && candidate.content?.trim()) {
        return candidate.content.trim();
      }
    }
    return "";
  }, [researchQuery, message, sortedMessages]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/provider-profiles`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { profiles?: ProviderProfile[] };
        setProfiles(payload.profiles || []);
      } catch {
        // local bootstrap can proceed without profile endpoint
      }
    })();
  }, [apiBase]);

  useEffect(() => {
    void (async () => {
      try {
        const [personaResponse, voiceResponse] = await Promise.all([
          fetch(`${apiBase}/api/personas`),
          fetch(`${apiBase}/api/voices`),
        ]);
        if (personaResponse.ok) {
          const payload = (await personaResponse.json()) as { personas?: Persona[] };
          setPersonas(payload.personas || []);
        }
        if (voiceResponse.ok) {
          const payload = (await voiceResponse.json()) as { voices?: string[] };
          setVoices(payload.voices || []);
        }
      } catch {
        // optional metadata endpoints
      }
    })();
  }, [apiBase]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    setSession((previous) => ({ ...previous, session_id: sessionId }));
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) {
      return;
    }
    setSessionId(randomSessionId());
  }, [sessionId]);

  useEffect(() => {
    setMemorySummaryInput(memory.summary || "");
    setMemoryFactsInput(memory.key_facts.join("\n"));
    setMemoryPrefsInput(memory.user_preferences.join("\n"));
    setMemoryNotesInput(memory.agent_notes.join("\n"));
  }, [memory]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/sessions/${sessionId}/memory`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { memory?: SessionMemory };
        setMemory(normalizeMemory(payload.memory));
      } catch {
        // memory endpoint is optional during bootstrap
      }
    })();
  }, [apiBase, sessionId]);

  async function loadSession(targetSessionId: string) {
    const trimmed = targetSessionId.trim();
    if (!trimmed) {
      return;
    }
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/sessions/${trimmed}`);
      if (!response.ok) {
        throw new Error(`Failed to load session (${response.status})`);
      }
      const payload = (await response.json()) as SessionPayload;
      setSession(payload);
      setMemory(normalizeMemory(payload.memory));
      setSessionId(trimmed);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Unable to load session";
      setError(messageText);
    }
  }

  function activeAgents() {
    const activeOpenAIModel = quickMode ? "gpt-5" : openaiModel;
    const activeAnthropicModel = quickMode ? "claude-sonnet-4-5" : anthropicModel;
    const activeOpenAIProfile = quickMode ? "openai:default" : openaiProfile;
    const activeAnthropicProfile = quickMode ? "anthropic:default" : anthropicProfile;
    return [
      {
        provider: "openai",
        model: activeOpenAIModel,
        profile_id: activeOpenAIProfile,
        label: "Codex",
      },
      {
        provider: "anthropic",
        model: activeAnthropicModel,
        profile_id: activeAnthropicProfile,
        label: "Claude",
      },
    ];
  }

  async function submitTurn() {
    const trimmed = message.trim();
    if (!trimmed || isRunning) {
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      const response = await fetch(`${apiBase}/api/duet/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_message: trimmed,
          system_prompt: systemPrompt,
          agents: activeAgents(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Request failed (${response.status})`);
      }
      const payload = (await response.json()) as { session: SessionPayload };
      setSession(payload.session);
      setMemory(normalizeMemory(payload.session.memory));
      setMessage("");
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Turn failed";
      setError(messageText);
    } finally {
      setIsRunning(false);
    }
  }

  async function runAgenticLoop() {
    if (isRunning) {
      return;
    }
    setIsRunning(true);
    setError(null);
    const seed = message.trim();
    try {
      const response = await fetch(`${apiBase}/api/duet/converse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          seed_user_message: seed || undefined,
          rounds: loopRounds,
          system_prompt: systemPrompt,
          agents: activeAgents(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Agentic loop failed (${response.status})`);
      }
      const payload = (await response.json()) as { session: SessionPayload };
      setSession(payload.session);
      setMemory(normalizeMemory(payload.session.memory));
      setMessage("");
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Agentic loop failed";
      setError(messageText);
    } finally {
      setIsRunning(false);
    }
  }

  async function refreshMemory() {
    setMemoryStatus("Refreshing memory...");
    try {
      const response = await fetch(`${apiBase}/api/sessions/${sessionId}/memory`);
      if (!response.ok) {
        throw new Error(`Unable to load memory (${response.status})`);
      }
      const payload = (await response.json()) as { memory?: SessionMemory };
      setMemory(normalizeMemory(payload.memory));
      setMemoryStatus("Memory refreshed.");
    } catch (err) {
      setMemoryStatus(err instanceof Error ? err.message : "Unable to refresh memory");
    }
  }

  async function saveMemory() {
    setMemoryStatus("Saving memory...");
    const parseLines = (value: string) =>
      value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    try {
      const response = await fetch(`${apiBase}/api/sessions/${sessionId}/memory`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: memorySummaryInput,
          key_facts: parseLines(memoryFactsInput),
          user_preferences: parseLines(memoryPrefsInput),
          agent_notes: parseLines(memoryNotesInput),
          merge: false,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Unable to save memory (${response.status})`);
      }
      const payload = (await response.json()) as { memory?: SessionMemory };
      setMemory(normalizeMemory(payload.memory));
      setMemoryStatus("Memory saved.");
    } catch (err) {
      setMemoryStatus(err instanceof Error ? err.message : "Unable to save memory");
    }
  }

  async function createResearchHandoff() {
    setHandoffStatus("Creating handoff...");
    try {
      const response = await fetch(`${apiBase}/api/research/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          mode: researchMode,
          query: latestUserPrompt,
          research_url: researchUrl,
          include_recent_messages: 10,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Failed to create handoff (${response.status})`);
      }
      const payload = (await response.json()) as {
        handoff?: {
          handoff_id?: string;
          query?: string;
        };
      };
      const handoffId = payload.handoff?.handoff_id || "";
      if (!handoffId) {
        throw new Error("Missing handoff_id in response");
      }
      setResearchHandoffId(handoffId);
      if (!researchQuery.trim() && payload.handoff?.query) {
        setResearchQuery(String(payload.handoff.query));
      }
      setHandoffStatus(`Handoff ready: ${handoffId}`);
    } catch (err) {
      setHandoffStatus(err instanceof Error ? err.message : "Unable to create handoff");
    }
  }

  function buildResearchLaunchUrl(mode: ResearchMode): string {
    if (!hasResearchUrl) {
      return "";
    }
    const base = researchUrl.trim();
    const modePath = `${base.replace(/\/$/, "")}/research/${mode}`;
    return safeBuildUrl(modePath, {
      source: "scribe",
      session_id: sessionId,
      scribe_api: apiBase,
      q: latestUserPrompt,
      handoff_id: researchHandoffId,
    });
  }

  function openResearch(mode: ResearchMode) {
    const launchUrl = buildResearchLaunchUrl(mode);
    if (!launchUrl) {
      return;
    }
    window.open(launchUrl, "_blank", "noopener,noreferrer");
  }

  async function ingestResearch() {
    const trimmed = ingestText.trim();
    if (!trimmed) {
      setIngestStatus("Paste a JSON payload or summary text first.");
      return;
    }

    setIngestStatus("Ingesting research output...");
    try {
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        payload = parsed;
      } catch {
        payload = { summary: trimmed };
      }

      const response = await fetch(`${apiBase}/api/research/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          source: "research-app",
          mode: researchMode,
          ...payload,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `Ingest failed (${response.status})`);
      }
      const data = (await response.json()) as { session: SessionPayload };
      setSession(data.session);
      setMemory(normalizeMemory(data.session.memory));
      setIngestStatus("Research result ingested into shared transcript.");
      setIngestText("");
    } catch (err) {
      setIngestStatus(err instanceof Error ? err.message : "Unable to ingest research output");
    }
  }

  async function setPersonaVoice(personaId: string, voiceId: string) {
    try {
      const response = await fetch(`${apiBase}/api/personas/${personaId}/voice`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voiceId }),
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { persona?: Persona };
      if (!payload.persona) {
        return;
      }
      setPersonas((previous) => previous.map((item) => (item.id === personaId ? payload.persona as Persona : item)));
    } catch {
      // keep UI responsive even if endpoint unavailable
    }
  }

  const openaiProfiles = profiles.filter((profile) => profile.provider === "openai");
  const anthropicProfiles = profiles.filter((profile) => profile.provider === "anthropic");

  return (
    <main
      className={`${spaceGrotesk.className} ${plexMono.variable} scribe-stage relative min-h-screen overflow-x-hidden text-[#f2eee5]`}
      style={{
        background:
          "radial-gradient(900px 420px at -10% -4%, rgba(168, 113, 53, 0.24) 0%, transparent 62%), radial-gradient(1000px 500px at 105% -5%, rgba(48, 68, 78, 0.24) 0%, transparent 58%), #07090c",
      }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="scribe-grid absolute inset-0" />
        <div className="scribe-vignette absolute inset-0" />
        <div className="scribe-orbit scribe-orbit-a absolute left-[8%] top-16 h-64 w-64" />
        <div className="scribe-orbit scribe-orbit-b absolute right-[6%] top-[28rem] h-48 w-48" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 md:px-6">
        <header className="scribe-panel scribe-hero rounded-3xl p-5 backdrop-blur md:p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-[#d7b389]">SCRIBE Closed Loop</p>
          <h1 className={`${cinzel.className} mt-3 text-4xl font-semibold tracking-[0.08em] text-[#f2e4cf] md:text-5xl`}>
            SCRIBE
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[#e8dccd]/85">
            Personal-first workspace with progressive disclosure: fast duet by default, deeper controls and research
            surfaces only when you open them.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setQuickMode(true)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                quickMode
                  ? "border-[#d7a466]/70 bg-[#b68042]/30 text-[#f8eddb]"
                  : "border-white/20 text-white/70 hover:border-[#d7a466]/45"
              }`}
            >
              Quick Mode
            </button>
            <button
              onClick={() => {
                setQuickMode(false);
                setShowAdvanced(true);
              }}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                !quickMode
                  ? "border-[#c2b08f]/70 bg-[#a58b66]/25 text-[#f1e7d8]"
                  : "border-white/20 text-white/70 hover:border-[#c2b08f]/45"
              }`}
            >
              Workspace Mode
            </button>
            <span className="rounded-full border border-[#f1d8b3]/25 bg-black/35 px-3 py-1 text-xs text-[#e5d7c3]/80">
              Shared Session: <span className="font-mono text-[#f5e8d0]">{sessionId}</span>
            </span>
          </div>
        </header>

        <section className="scribe-panel rounded-2xl p-4">
          <div className="flex gap-2">
            <textarea
              className="h-24 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-amber-400"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask SCRIBE anything. Your turn is persisted, then Codex + Claude run on the same local shared state."
            />
            <button
              onClick={() => void submitTurn()}
              disabled={isRunning}
              className="min-w-28 rounded-xl border border-amber-300/40 bg-amber-500/20 px-4 py-2 text-sm font-medium transition hover:bg-amber-500/35 disabled:opacity-50"
            >
              {isRunning ? "Running..." : "Run Turn"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-white/60" htmlFor="agentic-rounds">
              Agentic rounds
            </label>
            <input
              id="agentic-rounds"
              type="number"
              min={1}
              max={12}
              value={loopRounds}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                const clamped = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(12, parsed));
                setLoopRounds(clamped);
              }}
              className="w-20 rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-xs outline-none focus:border-amber-300"
            />
            <button
              onClick={() => void runAgenticLoop()}
              disabled={isRunning}
              className="rounded-lg border border-neutral-300/40 bg-neutral-500/15 px-3 py-2 text-xs transition hover:bg-neutral-500/30 disabled:opacity-50"
            >
              {isRunning ? "Looping..." : "Run Trio Loop"}
            </button>
            <span className="text-xs text-white/50">
              GPT and Claude alternate, using shared transcript + shared memory each round.
            </span>
          </div>
          {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
          <p className="mt-2 text-xs text-white/55">
            Mode: {quickMode ? "Quick (default profiles/models)" : "Workspace (custom lane controls enabled)"}
          </p>
        </section>

        <section className="scribe-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/70">Shared Transcript</h2>
            <p className="text-xs text-white/50">{session.updated_at ? `Updated ${session.updated_at}` : "No turns yet"}</p>
          </div>
          <div className="scrollbar-thin max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {sortedMessages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-white/60">
                Start a turn to populate shared state.
              </div>
            ) : (
              sortedMessages.map((item, index) => (
                <article
                  key={`${item.timestamp || "t"}-${index}`}
                  className={`rounded-lg border p-3 ${
                    item.role === "user" ? "border-amber-300/30 bg-amber-500/10" : "border-white/15 bg-white/5"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between text-xs text-white/60">
                    <span>{item.speaker}</span>
                    <span className="font-mono">{item.model || item.role}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{item.content}</p>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="scribe-panel rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">Shared Memory</h2>
              <p className="mt-1 text-xs text-white/60">
                Durable memory used by both GPT and Claude every turn.
              </p>
            </div>
            <button
              onClick={() => setShowMemory((previous) => !previous)}
              className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200"
            >
              {showMemory ? "Hide Memory" : "Reveal Memory"}
            </button>
          </div>

          {showMemory && (
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <label className="block text-xs uppercase tracking-wider text-white/60">Summary</label>
                <textarea
                  className="mt-2 h-16 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                  value={memorySummaryInput}
                  onChange={(event) => setMemorySummaryInput(event.target.value)}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <label className="block text-xs uppercase tracking-wider text-white/60">Key Facts</label>
                  <textarea
                    className="mt-2 h-24 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-xs outline-none focus:border-amber-300"
                    value={memoryFactsInput}
                    onChange={(event) => setMemoryFactsInput(event.target.value)}
                    placeholder="One fact per line"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <label className="block text-xs uppercase tracking-wider text-white/60">User Preferences</label>
                  <textarea
                    className="mt-2 h-24 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-xs outline-none focus:border-amber-300"
                    value={memoryPrefsInput}
                    onChange={(event) => setMemoryPrefsInput(event.target.value)}
                    placeholder="One preference per line"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <label className="block text-xs uppercase tracking-wider text-white/60">Agent Notes</label>
                  <textarea
                    className="mt-2 h-24 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-xs outline-none focus:border-amber-300"
                    value={memoryNotesInput}
                    onChange={(event) => setMemoryNotesInput(event.target.value)}
                    placeholder="One note per line"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void saveMemory()}
                  className="rounded-lg border border-amber-300/40 px-3 py-2 text-xs transition hover:bg-amber-500/25"
                >
                  Save Memory
                </button>
                <button
                  onClick={() => void refreshMemory()}
                  className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200"
                >
                  Refresh Memory
                </button>
                <span className="text-xs text-white/55">
                  {memoryStatus || (memory.updated_at ? `Updated ${memory.updated_at}` : "No memory yet")}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="scribe-panel rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-200">Advanced SCRIBE Controls</h2>
              <p className="mt-1 text-xs text-white/60">Hidden by default for progressive disclosure.</p>
            </div>
            <button
              onClick={() => setShowAdvanced((previous) => !previous)}
              className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-stone-300 hover:text-stone-200"
            >
              {showAdvanced ? "Hide Controls" : "Reveal Controls"}
            </button>
          </div>

          {showAdvanced && (
            <div className="mt-4 grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <label className="block text-xs uppercase tracking-wider text-white/60">Session ID</label>
                <div className="mt-2 flex gap-2">
                  <input
                    className="w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none ring-0 focus:border-stone-400"
                    value={sessionId}
                    onChange={(event) => setSessionId(event.target.value)}
                  />
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm transition hover:border-stone-300 hover:text-stone-200"
                    onClick={() => void loadSession(sessionId)}
                  >
                    Load
                  </button>
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm transition hover:border-orange-300 hover:text-orange-200"
                    onClick={() => setSessionId(randomSessionId())}
                  >
                    New
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <label className="block text-xs uppercase tracking-wider text-white/60">System Prompt</label>
                <textarea
                  className="mt-2 h-20 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-stone-400"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-200">Codex Lane</h3>
                  <div className="mt-3 grid gap-2">
                    <input
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-stone-400"
                      value={openaiModel}
                      onChange={(event) => setOpenaiModel(event.target.value)}
                      placeholder="gpt-5"
                    />
                    <select
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-stone-400"
                      value={openaiProfile}
                      onChange={(event) => setOpenaiProfile(event.target.value)}
                    >
                      {openaiProfiles.length === 0 ? (
                        <option value="openai:default">openai:default</option>
                      ) : (
                        openaiProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.id} ({profile.auth_mode})
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-orange-200">Claude Lane</h3>
                  <div className="mt-3 grid gap-2">
                    <input
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-orange-400"
                      value={anthropicModel}
                      onChange={(event) => setAnthropicModel(event.target.value)}
                      placeholder="claude-sonnet-4-5"
                    />
                    <select
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-orange-400"
                      value={anthropicProfile}
                      onChange={(event) => setAnthropicProfile(event.target.value)}
                    >
                      {anthropicProfiles.length === 0 ? (
                        <option value="anthropic:default">anthropic:default</option>
                      ) : (
                        anthropicProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.id} ({profile.auth_mode})
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="scribe-panel rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">Research Surface</h2>
              <p className="mt-1 text-xs text-white/60">
                Hidden until needed. Handoff and ingest keep SCRIBE + Research synchronized.
              </p>
            </div>
            <button
              onClick={() => setShowResearch((previous) => !previous)}
              className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200"
            >
              {showResearch ? "Hide Research" : "Reveal Research"}
            </button>
          </div>

          {showResearch && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <label className="block text-xs uppercase tracking-wider text-white/60">Research App URL</label>
                <input
                  className="mt-2 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                  placeholder="http://localhost:3001"
                  value={researchUrl}
                  onChange={(event) => setResearchUrl(event.target.value)}
                />
                <label className="mt-3 block text-xs uppercase tracking-wider text-white/60">Research Query</label>
                <textarea
                  className="mt-2 h-20 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                  value={researchQuery}
                  onChange={(event) => setResearchQuery(event.target.value)}
                  placeholder="Optional. Leave blank to use current/last user prompt."
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  {(["hybrid", "novix", "llnl", "google"] as ResearchMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setResearchMode(mode)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        researchMode === mode
                          ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                          : "border-white/20 text-white/70 hover:border-amber-300/40"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200"
                    onClick={() => void createResearchHandoff()}
                  >
                    Create Handoff
                  </button>
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200 disabled:opacity-50"
                    disabled={!hasResearchUrl}
                    onClick={() => openResearch(researchMode)}
                  >
                    Open {researchMode} in Research App
                  </button>
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200 disabled:opacity-50"
                    disabled={!hasResearchUrl}
                    onClick={() => setEmbedResearch((previous) => !previous)}
                  >
                    {embedResearch ? "Hide Embed" : "Embed Here"}
                  </button>
                </div>

                {(handoffStatus || researchHandoffId) && (
                  <p className="mt-2 text-xs text-white/60">
                    {handoffStatus}
                    {researchHandoffId ? ` (id: ${researchHandoffId})` : ""}
                  </p>
                )}
                {!hasResearchUrl && (
                  <p className="mt-2 text-xs text-white/50">
                    Set <span className="font-mono">NEXT_PUBLIC_RESEARCH_APP_URL</span> to keep this connected by default.
                  </p>
                )}
              </div>

              {embedResearch && hasResearchUrl && (
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/10 px-3 py-2 text-xs text-white/60">Embedded research app</div>
                  <iframe src={buildResearchLaunchUrl(researchMode)} title="Research App" className="h-[420px] w-full bg-white" />
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <label className="block text-xs uppercase tracking-wider text-white/60">Ingest Research Output</label>
                <textarea
                  className="mt-2 h-28 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                  value={ingestText}
                  onChange={(event) => setIngestText(event.target.value)}
                  placeholder='Paste JSON from research app (e.g. {"title":"...","summary":"...","findings":[...]}) or plain summary text.'
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200"
                    onClick={() => void ingestResearch()}
                  >
                    Ingest to SCRIBE
                  </button>
                  {ingestStatus && <span className="text-xs text-white/60">{ingestStatus}</span>}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="scribe-panel rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Personas & Voices</h2>
              <p className="mt-1 text-xs text-white/60">Verify persona roster and assign voices while you evaluate a new local voice model.</p>
            </div>
            <button
              onClick={() => setShowPersonas((previous) => !previous)}
              className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-neutral-300 hover:text-neutral-200"
            >
              {showPersonas ? "Hide Personas" : "Reveal Personas"}
            </button>
          </div>

          {showPersonas && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {personas.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/15 p-3 text-xs text-white/60">
                  Persona metadata unavailable.
                </div>
              ) : (
                personas.map((persona) => (
                  <div key={persona.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-white/90">{persona.name}</div>
                        <div className="text-xs uppercase tracking-wide text-white/50">{persona.role}</div>
                      </div>
                      <select
                        value={persona.voice_id || ""}
                        onChange={(event) => void setPersonaVoice(persona.id, event.target.value)}
                        className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-xs outline-none focus:border-neutral-300"
                      >
                        <option value="">(default)</option>
                        {voices.map((voice) => (
                          <option key={voice} value={voice}>
                            {voice}
                          </option>
                        ))}
                      </select>
                    </div>
                    {persona.description && <p className="mt-2 text-xs text-white/65">{persona.description}</p>}
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
