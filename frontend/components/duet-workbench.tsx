"use client";

import { useEffect, useMemo, useState } from "react";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

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
  updated_at?: string | null;
};

type ProviderProfile = {
  id: string;
  provider: string;
  auth_mode: string;
  enabled: boolean;
};

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-duet",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-duet-mono",
});

function randomSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
}

export default function DuetWorkbench() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const researchAppDefault = process.env.NEXT_PUBLIC_RESEARCH_APP_URL || "";

  const [quickMode, setQuickMode] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [embedResearch, setEmbedResearch] = useState(false);

  const [sessionId, setSessionId] = useState<string>(() => randomSessionId());
  const [systemPrompt, setSystemPrompt] = useState(
    "You are part of a private SCRIBE duet. Keep responses concise, concrete, and build on prior turns."
  );
  const [researchUrl, setResearchUrl] = useState(researchAppDefault);
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload>({
    session_id: sessionId,
    messages: [],
  });
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [openaiProfile, setOpenaiProfile] = useState("openai:default");
  const [anthropicProfile, setAnthropicProfile] = useState("anthropic:default");
  const [openaiModel, setOpenaiModel] = useState("gpt-5");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-5");

  const sortedMessages = useMemo(() => [...session.messages], [session.messages]);
  const hasResearchUrl = researchUrl.trim().length > 0;

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/provider-profiles`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { profiles?: ProviderProfile[] };
        const list = payload.profiles || [];
        setProfiles(list);
      } catch {
        // local dev can run without profile endpoint during bootstrap
      }
    })();
  }, [apiBase]);

  useEffect(() => {
    setSession((previous) => ({ ...previous, session_id: sessionId }));
  }, [sessionId]);

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
      setSessionId(trimmed);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Unable to load session";
      setError(messageText);
    }
  }

  async function submitTurn() {
    const trimmed = message.trim();
    if (!trimmed || isRunning) {
      return;
    }

    setIsRunning(true);
    setError(null);

    const activeOpenAIModel = quickMode ? "gpt-5" : openaiModel;
    const activeAnthropicModel = quickMode ? "claude-sonnet-4-5" : anthropicModel;
    const activeOpenAIProfile = quickMode ? "openai:default" : openaiProfile;
    const activeAnthropicProfile = quickMode ? "anthropic:default" : anthropicProfile;

    try {
      const response = await fetch(`${apiBase}/api/duet/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_message: trimmed,
          system_prompt: systemPrompt,
          agents: [
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
          ],
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Request failed (${response.status})`);
      }
      const payload = (await response.json()) as { session: SessionPayload };
      setSession(payload.session);
      setMessage("");
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Turn failed";
      setError(messageText);
    } finally {
      setIsRunning(false);
    }
  }

  const openaiProfiles = profiles.filter((profile) => profile.provider === "openai");
  const anthropicProfiles = profiles.filter((profile) => profile.provider === "anthropic");

  return (
    <main
      className={`${spaceGrotesk.className} ${plexMono.variable} min-h-screen text-white`}
      style={{
        background:
          "radial-gradient(1000px 480px at -5% 5%, #1f6d64 0%, transparent 60%), radial-gradient(900px 420px at 100% 0%, #8d3f26 0%, transparent 55%), #0f1416",
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 md:px-6">
        <header className="rounded-3xl border border-white/15 bg-black/35 p-5 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">SCRIBE Closed Loop</p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">SCRIBE App</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/75">
            Personal-first workspace with progressive disclosure: fast duet by default, deeper controls and research
            surfaces only when you open them.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setQuickMode(true)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                quickMode
                  ? "border-emerald-300/60 bg-emerald-400/20 text-emerald-100"
                  : "border-white/20 text-white/70 hover:border-emerald-300/40"
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
                  ? "border-sky-300/60 bg-sky-400/20 text-sky-100"
                  : "border-white/20 text-white/70 hover:border-sky-300/40"
              }`}
            >
              Workspace Mode
            </button>
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">
              Shared Session: <span className="font-mono text-white/80">{sessionId}</span>
            </span>
          </div>
        </header>

        <section className="rounded-2xl border border-white/10 bg-black/35 p-4">
          <div className="flex gap-2">
            <textarea
              className="h-24 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask SCRIBE anything. Your turn is persisted, then Codex + Claude run on the same local shared state."
            />
            <button
              onClick={() => void submitTurn()}
              disabled={isRunning}
              className="min-w-28 rounded-xl border border-emerald-300/40 bg-emerald-500/20 px-4 py-2 text-sm font-medium transition hover:bg-emerald-500/35 disabled:opacity-50"
            >
              {isRunning ? "Running…" : "Run Turn"}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
          <p className="mt-2 text-xs text-white/55">
            Mode: {quickMode ? "Quick (default profiles/models)" : "Workspace (custom lane controls enabled)"}
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/35 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/70">Shared Transcript</h2>
            <p className="text-xs text-white/50">{session.updated_at ? `Updated ${session.updated_at}` : "No turns yet"}</p>
          </div>
          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {sortedMessages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-white/60">
                Start a turn to populate shared state.
              </div>
            ) : (
              sortedMessages.map((item, index) => (
                <article
                  key={`${item.timestamp || "t"}-${index}`}
                  className={`rounded-lg border p-3 ${
                    item.role === "user" ? "border-emerald-300/30 bg-emerald-500/10" : "border-white/15 bg-white/5"
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

        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-sky-200">Advanced SCRIBE Controls</h2>
              <p className="mt-1 text-xs text-white/60">Hidden by default for progressive disclosure.</p>
            </div>
            <button
              onClick={() => setShowAdvanced((previous) => !previous)}
              className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-sky-300 hover:text-sky-200"
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
                    className="w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none ring-0 focus:border-sky-400"
                    value={sessionId}
                    onChange={(event) => setSessionId(event.target.value)}
                  />
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm transition hover:border-sky-300 hover:text-sky-200"
                    onClick={() => void loadSession(sessionId)}
                  >
                    Load
                  </button>
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm transition hover:border-fuchsia-300 hover:text-fuchsia-200"
                    onClick={() => setSessionId(randomSessionId())}
                  >
                    New
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <label className="block text-xs uppercase tracking-wider text-white/60">System Prompt</label>
                <textarea
                  className="mt-2 h-20 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-sky-400"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-sky-200">Codex Lane</h3>
                  <div className="mt-3 grid gap-2">
                    <input
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-sky-400"
                      value={openaiModel}
                      onChange={(event) => setOpenaiModel(event.target.value)}
                      placeholder="gpt-5"
                    />
                    <select
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-sky-400"
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
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-fuchsia-200">Claude Lane</h3>
                  <div className="mt-3 grid gap-2">
                    <input
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
                      value={anthropicModel}
                      onChange={(event) => setAnthropicModel(event.target.value)}
                      placeholder="claude-sonnet-4-5"
                    />
                    <select
                      className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
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

        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">Research Surface</h2>
              <p className="mt-1 text-xs text-white/60">
                Hidden until needed. Use this to progressively disclose your separate research app.
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
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <label className="block text-xs uppercase tracking-wider text-white/60">Research App URL</label>
                <input
                  className="mt-2 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                  placeholder="http://localhost:3001"
                  value={researchUrl}
                  onChange={(event) => setResearchUrl(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200 disabled:opacity-50"
                    disabled={!hasResearchUrl}
                    onClick={() => window.open(researchUrl, "_blank", "noopener,noreferrer")}
                  >
                    Open Research App
                  </button>
                  <button
                    className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-200 disabled:opacity-50"
                    disabled={!hasResearchUrl}
                    onClick={() => setEmbedResearch((previous) => !previous)}
                  >
                    {embedResearch ? "Hide Embed" : "Embed Here"}
                  </button>
                </div>
                {!hasResearchUrl && (
                  <p className="mt-2 text-xs text-white/50">
                    Set <span className="font-mono">NEXT_PUBLIC_RESEARCH_APP_URL</span> to keep this connected by default.
                  </p>
                )}
              </div>

              {embedResearch && hasResearchUrl && (
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/10 px-3 py-2 text-xs text-white/60">Embedded research app</div>
                  <iframe src={researchUrl} title="Research App" className="h-[420px] w-full bg-white" />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
