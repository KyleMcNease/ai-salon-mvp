"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
type RoutingTarget = "duet" | "gpt" | "claude";
type BridgeAgent = {
  provider: string;
  model: string;
  profile_id: string;
  label: string;
};
type SidePanel = "none" | "canvas" | "memory" | "advanced" | "research" | "personas";
type TranscriptMode = "single" | "divergence";
type ArtifactVersion = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  note?: string;
};
type ArtifactDoc = {
  id: string;
  title: string;
  content: string;
  sourceSpeaker: string;
  sourceModel?: string;
  updatedAt: string;
  versions: ArtifactVersion[];
};
type DiffLine = { kind: "same" | "add" | "del"; text: string };
type UiPrefs = {
  quickMode: boolean;
  transcriptMode: TranscriptMode;
  railCollapsed: boolean;
  sidePanel: SidePanel;
  splitCanvasView: boolean;
  showPinnedOnly: boolean;
};

const DEFAULT_OPENAI_MODEL = "gpt-5.2-codex";
const DEFAULT_ANTHROPIC_MODEL = "opus";
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 12_000;
const UI_PREFS_STORAGE_KEY = "scribe:ui-prefs:v1";

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

function localId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function buildLineDiff(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    const a = left[i];
    const b = right[j];
    if (a === b) {
      if (a !== undefined) {
        lines.push({ kind: "same", text: a });
      }
      i += 1;
      j += 1;
      continue;
    }
    if (b !== undefined && left[i] === right[j + 1]) {
      lines.push({ kind: "add", text: b });
      j += 1;
      continue;
    }
    if (a !== undefined && left[i + 1] === right[j]) {
      lines.push({ kind: "del", text: a });
      i += 1;
      continue;
    }
    if (a !== undefined) {
      lines.push({ kind: "del", text: a });
      i += 1;
    }
    if (b !== undefined) {
      lines.push({ kind: "add", text: b });
      j += 1;
    }
  }
  return lines;
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
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>("single");
  const [sidePanel, setSidePanel] = useState<SidePanel>("none");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [embedResearch, setEmbedResearch] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);

  const [sessionId, setSessionId] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are part of a private SCRIBE duet. Be clear, rigorous, and build on prior turns. Response length should match the user request."
  );
  const [researchUrl, setResearchUrl] = useState(researchAppDefault);
  const [researchMode, setResearchMode] = useState<ResearchMode>("hybrid");
  const [researchQuery, setResearchQuery] = useState("");
  const [researchHandoffId, setResearchHandoffId] = useState<string>("");
  const [handoffStatus, setHandoffStatus] = useState<string>("");

  const [ingestText, setIngestText] = useState("");
  const [ingestStatus, setIngestStatus] = useState<string>("");

  const [message, setMessage] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachStatus, setAttachStatus] = useState("");
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
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_OPENAI_MODEL);
  const [anthropicModel, setAnthropicModel] = useState(DEFAULT_ANTHROPIC_MODEL);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [voices, setVoices] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactDoc[]>([]);
  const [activeArtifactId, setActiveArtifactId] = useState<string>("");
  const [canvasDraftTitle, setCanvasDraftTitle] = useState("");
  const [canvasDraftContent, setCanvasDraftContent] = useState("");
  const [selectedCanvasVersionId, setSelectedCanvasVersionId] = useState("");
  const [showCanvasDiff, setShowCanvasDiff] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState("");
  const [canvasSearch, setCanvasSearch] = useState("");
  const [pinnedArtifactIds, setPinnedArtifactIds] = useState<string[]>([]);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [splitCanvasView, setSplitCanvasView] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const sortedMessages = useMemo(() => [...session.messages], [session.messages]);
  const hasResearchUrl = researchUrl.trim().length > 0;
  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeArtifactId) || null,
    [artifacts, activeArtifactId]
  );
  const selectedCanvasVersion = useMemo(() => {
    if (!activeArtifact) {
      return null;
    }
    return activeArtifact.versions.find((version) => version.id === selectedCanvasVersionId) || activeArtifact.versions[0] || null;
  }, [activeArtifact, selectedCanvasVersionId]);
  const canvasDiffLines = useMemo(() => {
    if (!selectedCanvasVersion) {
      return [];
    }
    return buildLineDiff(selectedCanvasVersion.content, canvasDraftContent);
  }, [selectedCanvasVersion, canvasDraftContent]);
  const visibleArtifacts = useMemo(() => {
    const query = canvasSearch.trim().toLowerCase();
    return [...artifacts]
      .filter((item) => {
        if (showPinnedOnly && !pinnedArtifactIds.includes(item.id)) {
          return false;
        }
        if (!query) {
          return true;
        }
        return (
          item.title.toLowerCase().includes(query) ||
          item.content.toLowerCase().includes(query) ||
          item.sourceSpeaker.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const aPinned = pinnedArtifactIds.includes(a.id) ? 1 : 0;
        const bPinned = pinnedArtifactIds.includes(b.id) ? 1 : 0;
        if (aPinned !== bPinned) {
          return bPinned - aPinned;
        }
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [artifacts, canvasSearch, showPinnedOnly, pinnedArtifactIds]);

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
  const composerRoute = useMemo(() => detectRoutingTarget(message), [message]);
  const isEmptySession = sortedMessages.length === 0;

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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [sortedMessages.length, isRunning]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const media = window.matchMedia("(max-width: 1279px)");
    const apply = () => setIsCompactViewport(media.matches);
    apply();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const rawPrefs = window.localStorage.getItem(UI_PREFS_STORAGE_KEY);
      if (!rawPrefs) {
        setPrefsReady(true);
        return;
      }
      const parsed = JSON.parse(rawPrefs) as Partial<UiPrefs>;
      if (typeof parsed.quickMode === "boolean") {
        setQuickMode(parsed.quickMode);
      }
      if (parsed.transcriptMode === "single" || parsed.transcriptMode === "divergence") {
        setTranscriptMode(parsed.transcriptMode);
      }
      if (typeof parsed.railCollapsed === "boolean") {
        setRailCollapsed(parsed.railCollapsed);
      }
      if (
        parsed.sidePanel === "none" ||
        parsed.sidePanel === "canvas" ||
        parsed.sidePanel === "memory" ||
        parsed.sidePanel === "advanced" ||
        parsed.sidePanel === "research" ||
        parsed.sidePanel === "personas"
      ) {
        setSidePanel(parsed.sidePanel);
      }
      if (typeof parsed.splitCanvasView === "boolean") {
        setSplitCanvasView(parsed.splitCanvasView);
      }
      if (typeof parsed.showPinnedOnly === "boolean") {
        setShowPinnedOnly(parsed.showPinnedOnly);
      }
    } catch {
      // ignore invalid local preferences
    } finally {
      setPrefsReady(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !prefsReady) {
      return;
    }
    const prefs: UiPrefs = {
      quickMode,
      transcriptMode,
      railCollapsed,
      sidePanel,
      splitCanvasView,
      showPinnedOnly,
    };
    window.localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  }, [prefsReady, quickMode, transcriptMode, railCollapsed, sidePanel, splitCanvasView, showPinnedOnly]);

  useEffect(() => {
    if (!isCompactViewport) {
      return;
    }
    if (!railCollapsed) {
      setRailCollapsed(true);
    }
    if (sidePanel !== "none" && !splitCanvasView) {
      setSidePanel("none");
    }
  }, [isCompactViewport, railCollapsed, sidePanel, splitCanvasView]);

  useEffect(() => {
    if (!activeArtifact) {
      setCanvasDraftTitle("");
      setCanvasDraftContent("");
      setSelectedCanvasVersionId("");
      setShowCanvasDiff(false);
      return;
    }
    setCanvasDraftTitle(activeArtifact.title);
    setCanvasDraftContent(activeArtifact.content);
    setSelectedCanvasVersionId(activeArtifact.versions[0]?.id || "");
    setShowCanvasDiff(false);
  }, [activeArtifactId, activeArtifact]);

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

  function activeAgents(): BridgeAgent[] {
    const activeOpenAIModel = quickMode ? DEFAULT_OPENAI_MODEL : openaiModel;
    const activeAnthropicModel = quickMode ? DEFAULT_ANTHROPIC_MODEL : anthropicModel;
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

  function resolveRouting(rawMessage: string, defaultAgents: BridgeAgent[]) {
    const gptAgent = defaultAgents.find((agent) => agent.provider === "openai");
    const claudeAgent = defaultAgents.find((agent) => agent.provider === "anthropic");
    const trimmed = rawMessage.trim();
    const match = trimmed.match(/^@(gpt|claude|duet|both)\b[:\s-]*/i);
    if (!match) {
      return {
        userMessage: trimmed,
        agents: defaultAgents,
        target: "duet" as RoutingTarget,
      };
    }

    const targetTag = match[1].toLowerCase();
    const userMessage = trimmed.replace(/^@(gpt|claude|duet|both)\b[:\s-]*/i, "").trim() || trimmed;
    const mentionsGpt = /\B@gpt\b/i.test(userMessage);
    const mentionsClaude = /\B@claude\b/i.test(userMessage);

    if (targetTag === "gpt") {
      const orderedAgents: BridgeAgent[] = [];
      if (gptAgent) {
        orderedAgents.push(gptAgent);
      }
      if (mentionsClaude && claudeAgent) {
        orderedAgents.push(claudeAgent);
      }
      return {
        userMessage,
        agents: orderedAgents.length > 0 ? orderedAgents : defaultAgents.filter((agent) => agent.provider === "openai"),
        target: "gpt" as RoutingTarget,
      };
    }

    if (targetTag === "claude") {
      const orderedAgents: BridgeAgent[] = [];
      if (claudeAgent) {
        orderedAgents.push(claudeAgent);
      }
      if (mentionsGpt && gptAgent) {
        orderedAgents.push(gptAgent);
      }
      return {
        userMessage,
        agents: orderedAgents.length > 0 ? orderedAgents : defaultAgents.filter((agent) => agent.provider === "anthropic"),
        target: "claude" as RoutingTarget,
      };
    }

    return {
      userMessage,
      agents: defaultAgents,
      target: "duet" as RoutingTarget,
    };
  }

  function detectRoutingTarget(rawMessage: string): RoutingTarget {
    const match = rawMessage.trim().match(/^@(gpt|claude|duet|both)\b[:\s-]*/i);
    if (!match) {
      return "duet";
    }
    const tag = match[1].toLowerCase();
    if (tag === "gpt" || tag === "claude") {
      return tag;
    }
    return "duet";
  }

  function setComposerRoute(target: RoutingTarget) {
    setMessage((previous) => {
      const stripped = previous.replace(/^@(gpt|claude|duet|both)\b[:\s-]*/i, "").trimStart();
      if (target === "duet") {
        return stripped;
      }
      return `@${target} ${stripped}`.trim();
    });
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function messageRouteTag(item: SessionMessage): string {
    if (item.role === "user") {
      return "@you";
    }
    if (item.provider === "openai") {
      return "@gpt";
    }
    if (item.provider === "anthropic") {
      return "@claude";
    }
    return "@agent";
  }

  async function composeMessageWithAttachments(baseMessage: string): Promise<string> {
    const trimmedBase = baseMessage.trim();
    if (attachedFiles.length === 0) {
      return trimmedBase;
    }
    setAttachStatus(`Preparing ${attachedFiles.length} attachment(s)...`);

    const attachmentBlocks: string[] = [];
    for (const file of attachedFiles) {
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        attachmentBlocks.push(`- ${file.name}: skipped (larger than 2MB)`);
        continue;
      }

      const textLike =
        file.type.startsWith("text/") ||
        /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|yaml|yml|toml)$/i.test(file.name);
      if (!textLike) {
        attachmentBlocks.push(`- ${file.name}: binary file attached (content not inlined)`);
        continue;
      }

      try {
        const content = await file.text();
        const clipped = content.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
        const truncated = content.length > MAX_ATTACHMENT_TEXT_CHARS ? "\n...[truncated]..." : "";
        attachmentBlocks.push(`### ${file.name}\n${clipped}${truncated}`);
      } catch {
        attachmentBlocks.push(`- ${file.name}: could not be read`);
      }
    }

    const messageBody = trimmedBase || "Use attached documents as context.";
    if (attachmentBlocks.length === 0) {
      return messageBody;
    }
    return `${messageBody}\n\n[ATTACHMENTS]\n${attachmentBlocks.join("\n\n")}`;
  }

  async function submitTurn() {
    const trimmed = message.trim();
    if (!trimmed || isRunning) {
      return;
    }
    const routing = resolveRouting(trimmed, activeAgents());

    setIsRunning(true);
    setError(null);
    setAttachStatus("");

    try {
      const userMessage = await composeMessageWithAttachments(routing.userMessage);
      const response = await fetch(`${apiBase}/api/duet/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_message: userMessage,
          system_prompt: systemPrompt,
          agents: routing.agents,
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
      setAttachedFiles([]);
      setAttachStatus("");
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Turn failed";
      setError(messageText);
      setAttachStatus("");
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
    setAttachStatus("");
    const seed = message.trim();
    const routing = resolveRouting(seed, activeAgents());
    try {
      const seedText = await composeMessageWithAttachments(routing.userMessage || "");
      const response = await fetch(`${apiBase}/api/duet/converse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          seed_user_message: seedText || undefined,
          rounds: loopRounds,
          system_prompt: systemPrompt,
          agents: routing.agents,
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
      setAttachedFiles([]);
      setAttachStatus("");
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Agentic loop failed";
      setError(messageText);
      setAttachStatus("");
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
  const sidePanelTitles: Record<Exclude<SidePanel, "none">, string> = {
    canvas: "Canvas",
    memory: "Shared Memory",
    advanced: "Advanced Controls",
    research: "Research Surface",
    personas: "Personas & Voices",
  };
  const activeRightPanel: SidePanel = splitCanvasView ? "canvas" : sidePanel;
  const showSplitRightPanel = activeRightPanel !== "none" && splitCanvasView && !isCompactViewport;
  const showOverlayRightPanel = activeRightPanel !== "none" && !showSplitRightPanel;
  const railPanelButtons: Array<[Exclude<SidePanel, "none">, string, string]> = [
    ["canvas", "Canvas", "C"],
    ["memory", "Memory", "M"],
    ["advanced", "Advanced", "A"],
    ["research", "Research", "R"],
    ["personas", "Personas", "P"],
  ];

  function togglePanel(panel: Exclude<SidePanel, "none">) {
    if (panel !== "canvas") {
      setSplitCanvasView(false);
    }
    setSidePanel((previous) => (previous === panel ? "none" : panel));
  }

  function createArtifactDoc(params: {
    title: string;
    content: string;
    sourceSpeaker: string;
    sourceModel?: string;
    note?: string;
  }): ArtifactDoc {
    const now = new Date().toISOString();
    const version: ArtifactVersion = {
      id: localId("ver"),
      title: params.title,
      content: params.content,
      updatedAt: now,
      note: params.note,
    };
    return {
      id: localId("artifact"),
      title: params.title,
      content: params.content,
      sourceSpeaker: params.sourceSpeaker,
      sourceModel: params.sourceModel,
      updatedAt: now,
      versions: [version],
    };
  }

  function createBlankArtifact() {
    const doc = createArtifactDoc({
      title: "Untitled artifact",
      content: "",
      sourceSpeaker: "You",
      sourceModel: "manual",
      note: "manual-create",
    });
    setArtifacts((previous) => [doc, ...previous].slice(0, 24));
    setActiveArtifactId(doc.id);
    setSidePanel("canvas");
    setCanvasStatus("New canvas artifact created.");
  }

  function createArtifactFromMessage(messageItem: SessionMessage, index: number) {
    const trimmed = messageItem.content?.trim();
    if (!trimmed) {
      return;
    }
    const titleCandidate = trimmed.split("\n")[0]?.trim() || "Untitled artifact";
    const title = titleCandidate.slice(0, 64);
    const nextArtifact = createArtifactDoc({
      content: messageItem.content,
      title,
      sourceSpeaker: messageItem.speaker || "Assistant",
      sourceModel: messageItem.model,
      note: `capture-${index}`,
    });
    setArtifacts((previous) => [nextArtifact, ...previous].slice(0, 24));
    setActiveArtifactId(nextArtifact.id);
    setSidePanel("canvas");
    setCanvasStatus("Captured response into canvas.");
  }

  function saveCanvasSnapshot() {
    if (!activeArtifact) {
      return;
    }
    const nextTitle = canvasDraftTitle.trim() || "Untitled artifact";
    const nextContent = canvasDraftContent;
    const changed = nextTitle !== activeArtifact.title || nextContent !== activeArtifact.content;
    if (!changed) {
      setCanvasStatus("No changes to save.");
      return;
    }
    const now = new Date().toISOString();
    const nextVersion: ArtifactVersion = {
      id: localId("ver"),
      title: nextTitle,
      content: nextContent,
      updatedAt: now,
      note: "manual-save",
    };
    setArtifacts((previous) =>
      previous.map((item) =>
        item.id === activeArtifact.id
          ? {
              ...item,
              title: nextTitle,
              content: nextContent,
              updatedAt: now,
              versions: [nextVersion, ...item.versions].slice(0, 50),
            }
          : item
      )
    );
    setSelectedCanvasVersionId(nextVersion.id);
    setCanvasStatus("Snapshot saved.");
  }

  function loadSelectedVersionToDraft() {
    if (!selectedCanvasVersion) {
      return;
    }
    setCanvasDraftTitle(selectedCanvasVersion.title);
    setCanvasDraftContent(selectedCanvasVersion.content);
    setCanvasStatus("Loaded selected version into draft.");
  }

  function restoreSelectedVersion() {
    if (!activeArtifact || !selectedCanvasVersion) {
      return;
    }
    const now = new Date().toISOString();
    const nextVersion: ArtifactVersion = {
      id: localId("ver"),
      title: selectedCanvasVersion.title,
      content: selectedCanvasVersion.content,
      updatedAt: now,
      note: `restore-${selectedCanvasVersion.updatedAt}`,
    };
    setArtifacts((previous) =>
      previous.map((item) =>
        item.id === activeArtifact.id
          ? {
              ...item,
              title: selectedCanvasVersion.title,
              content: selectedCanvasVersion.content,
              updatedAt: now,
              versions: [nextVersion, ...item.versions].slice(0, 50),
            }
          : item
      )
    );
    setCanvasDraftTitle(selectedCanvasVersion.title);
    setCanvasDraftContent(selectedCanvasVersion.content);
    setSelectedCanvasVersionId(nextVersion.id);
    setCanvasStatus("Version restored.");
  }

  function deleteActiveArtifact() {
    if (!activeArtifact) {
      return;
    }
    setPinnedArtifactIds((previous) => previous.filter((id) => id !== activeArtifact.id));
    setArtifacts((previous) => {
      const remaining = previous.filter((item) => item.id !== activeArtifact.id);
      if (remaining.length > 0) {
        setActiveArtifactId(remaining[0].id);
      } else {
        setActiveArtifactId("");
        setSplitCanvasView(false);
      }
      return remaining;
    });
    setCanvasStatus("Artifact deleted.");
  }

  function exportCanvasArtifact(format: "md" | "txt" | "json") {
    if (!activeArtifact) {
      return;
    }
    const safeTitle = (canvasDraftTitle.trim() || "artifact").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    let body = canvasDraftContent;
    if (format === "md") {
      body = `# ${canvasDraftTitle.trim() || "Untitled artifact"}\n\n${canvasDraftContent}`;
    } else if (format === "json") {
      body = JSON.stringify(
        {
          title: canvasDraftTitle.trim() || "Untitled artifact",
          content: canvasDraftContent,
          sourceSpeaker: activeArtifact.sourceSpeaker,
          sourceModel: activeArtifact.sourceModel,
          updatedAt: new Date().toISOString(),
          versions: activeArtifact.versions,
        },
        null,
        2
      );
    }
    const blob = new Blob([body], { type: format === "json" ? "application/json" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setCanvasStatus(`Exported ${format.toUpperCase()}.`);
  }

  async function copyCanvasContent() {
    try {
      await navigator.clipboard.writeText(canvasDraftContent);
      setCanvasStatus("Canvas content copied.");
    } catch {
      setCanvasStatus("Unable to copy. Check browser permissions.");
    }
  }

  function toggleArtifactPin(artifactId: string) {
    setPinnedArtifactIds((previous) =>
      previous.includes(artifactId) ? previous.filter((id) => id !== artifactId) : [artifactId, ...previous]
    );
  }

  function injectCanvasIntoComposer(target: RoutingTarget) {
    if (!activeArtifact) {
      return;
    }
    const prefix = target === "duet" ? "" : `@${target} `;
    const title = canvasDraftTitle.trim() || activeArtifact.title || "Untitled artifact";
    const body = canvasDraftContent.trim() || activeArtifact.content || "";
    const injected = `${prefix}Use this canvas artifact as context.\n\n[CANVAS]\nTitle: ${title}\nSource: ${activeArtifact.sourceSpeaker}${activeArtifact.sourceModel ? ` (${activeArtifact.sourceModel})` : ""}\n\n${body}`;
    setMessage((previous) => (previous.trim() ? `${previous.trim()}\n\n${injected}` : injected));
    setCanvasStatus(`Injected into composer for ${target === "duet" ? "duet" : `@${target}`}.`);
    setSidePanel("none");
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function toggleSplitCanvasDock() {
    if (splitCanvasView) {
      setSplitCanvasView(false);
      return;
    }
    if (!activeArtifact) {
      createBlankArtifact();
    } else {
      setSidePanel("canvas");
    }
    setSplitCanvasView(true);
  }

  function renderComposer(options?: { centered?: boolean }) {
    const centered = options?.centered ?? false;

    return (
      <div
        className={
          centered
            ? "mt-6 rounded-[2rem] border border-white/10 bg-black/38 px-4 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
            : "border-t border-white/10 px-4 py-3 lg:px-6"
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <label
            htmlFor="scribe-attachments"
            className="cursor-pointer rounded-lg border border-white/20 px-3 py-1.5 text-xs transition hover:border-amber-300 hover:text-amber-200"
          >
            Upload Docs
          </label>
          <input
            id="scribe-attachments"
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const nextFiles = Array.from(event.target.files || []);
              if (nextFiles.length === 0) {
                return;
              }
              setAttachedFiles((previous) => [...previous, ...nextFiles].slice(0, MAX_ATTACHMENTS));
              event.currentTarget.value = "";
            }}
          />
          {attachedFiles.map((file, index) => (
            <span key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 text-xs text-white/70">
              {file.name}
              <button
                className="text-white/60 hover:text-white"
                onClick={() => {
                  setAttachedFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
                }}
                aria-label={`Remove ${file.name}`}
              >
                x
              </button>
            </span>
          ))}
          {attachStatus && <span className="text-xs text-white/55">{attachStatus}</span>}
        </div>

        <div className={`flex ${centered ? "flex-col gap-3" : "flex-col gap-2 md:flex-row"}`}>
          <textarea
            ref={composerRef}
            className={`w-full rounded-2xl border border-white/15 px-4 py-3 text-sm outline-none focus:border-amber-400 ${
              centered ? "h-24 bg-black/52 text-base" : "h-28 bg-black/30"
            }`}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void runAgenticLoop();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitTurn();
              }
            }}
            placeholder="Ask SCRIBE anything. Prefix @gpt/@claude, or nest tags for handoff (e.g. @claude ask @gpt...)."
          />
          <div
            className={`flex gap-2 ${
              centered ? "justify-end" : "w-full flex-row md:w-44 md:flex-col"
            }`}
          >
            <button
              onClick={() => void submitTurn()}
              disabled={isRunning}
              className={`rounded-xl border border-amber-300/40 bg-amber-500/20 px-4 py-2 text-sm font-medium transition hover:bg-amber-500/35 disabled:opacity-50 ${
                centered ? "h-10 min-w-[8.5rem]" : "h-11 flex-1"
              }`}
            >
              {isRunning ? "Running..." : "Run Turn"}
            </button>
            <button
              onClick={() => void runAgenticLoop()}
              disabled={isRunning}
              className={`rounded-xl border border-neutral-300/40 bg-neutral-500/15 px-4 py-2 text-sm transition hover:bg-neutral-500/30 disabled:opacity-50 ${
                centered ? "h-10 min-w-[8.5rem]" : "h-11 flex-1"
              }`}
            >
              Run Trio Loop
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/55">
          <span>Route</span>
          <button
            onClick={() => setComposerRoute("duet")}
            className={`rounded-full border px-2 py-1 text-[11px] transition ${
              composerRoute === "duet"
                ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                : "border-white/20 text-white/70 hover:border-amber-300/45"
            }`}
          >
            duet
          </button>
          <button
            onClick={() => setComposerRoute("gpt")}
            className={`rounded-full border px-2 py-1 text-[11px] transition ${
              composerRoute === "gpt"
                ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                : "border-white/20 text-white/70 hover:border-amber-300/45"
            }`}
          >
            @gpt
          </button>
          <button
            onClick={() => setComposerRoute("claude")}
            className={`rounded-full border px-2 py-1 text-[11px] transition ${
              composerRoute === "claude"
                ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                : "border-white/20 text-white/70 hover:border-amber-300/45"
            }`}
          >
            @claude
          </button>
          <label htmlFor="agentic-rounds">Agentic rounds</label>
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
          <span>Enter sends. Shift+Enter newline. Cmd/Ctrl+Enter runs trio loop.</span>
        </div>
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
      </div>
    );
  }

  function handlePaneKeyScroll(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const source = event.target as HTMLElement | null;
    const tag = source?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || source?.isContentEditable) {
      return;
    }

    let delta = 0;
    if (event.key === "ArrowDown") {
      delta = 60;
    } else if (event.key === "ArrowUp") {
      delta = -60;
    } else if (event.key === "PageDown") {
      delta = target.clientHeight * 0.9;
    } else if (event.key === "PageUp") {
      delta = -target.clientHeight * 0.9;
    } else if (event.key === "Home") {
      event.preventDefault();
      target.scrollTo({ top: 0, behavior: "auto" });
      return;
    } else if (event.key === "End") {
      event.preventDefault();
      target.scrollTo({ top: target.scrollHeight, behavior: "auto" });
      return;
    }

    if (delta !== 0) {
      event.preventDefault();
      target.scrollBy({ top: delta, behavior: "auto" });
    }
  }

  return (
    <main
      className={`${spaceGrotesk.className} ${plexMono.variable} scribe-stage relative h-screen overflow-hidden text-[#f2eee5]`}
      style={{
        background:
          "radial-gradient(900px 420px at -10% -4%, rgba(168, 113, 53, 0.15) 0%, transparent 62%), radial-gradient(1000px 500px at 105% -5%, rgba(48, 68, 78, 0.15) 0%, transparent 58%), #0b0d12",
      }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="scribe-grid absolute inset-0" />
        <div className="scribe-vignette absolute inset-0" />
      </div>

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[92rem] min-h-0 flex-col gap-2 px-2 py-2 md:px-4 md:py-3">
        <header className="rounded-2xl border border-white/12 bg-black/45 px-4 py-2 backdrop-blur">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className={`${cinzel.className} text-2xl font-semibold tracking-[0.06em] text-[#f2e4cf]`}>SCRIBE</h1>
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/60">
                  Closed Loop
                </span>
              </div>
              <p className="text-[11px] text-[#e8dccd]/70">One shared thread for you, GPT, and Claude.</p>
            </div>
            <div className="justify-self-center rounded-full border border-white/12 bg-black/35 px-3 py-1 text-sm text-white/80">
              SCRIBE Duet
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
              <button
                onClick={() => setQuickMode(true)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  quickMode
                    ? "border-[#d7a466]/70 bg-[#b68042]/30 text-[#f8eddb]"
                    : "border-white/20 text-white/70 hover:border-[#d7a466]/45"
                }`}
              >
                Quick
              </button>
              <button
                onClick={() => {
                  setQuickMode(false);
                  setSidePanel("advanced");
                }}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  !quickMode
                    ? "border-[#c2b08f]/70 bg-[#a58b66]/25 text-[#f1e7d8]"
                    : "border-white/20 text-white/70 hover:border-[#c2b08f]/45"
                }`}
              >
                Workspace
              </button>
              <button
                onClick={() => setRailCollapsed((previous) => !previous)}
                className="rounded-full border px-2.5 py-1 text-xs transition border-white/20 text-white/75 hover:border-amber-300/45"
              >
                {railCollapsed ? "Show Rail" : "Hide Rail"}
              </button>
              <button
                onClick={() => toggleSplitCanvasDock()}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  splitCanvasView
                    ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                    : "border-white/20 text-white/75 hover:border-amber-300/45"
                }`}
              >
                {splitCanvasView ? "Undock Canvas" : "Split Canvas"}
              </button>
              <span className="hidden max-w-[15rem] truncate rounded-full border border-[#f1d8b3]/25 bg-black/35 px-2.5 py-1 text-xs text-[#e5d7c3]/80 xl:inline-flex">
                Session: <span className="font-mono text-[#f5e8d0]">{sessionId}</span>
              </span>
            </div>
          </div>
        </header>

        <section className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/12 bg-black/28">
          <div className="relative flex min-h-0 w-full flex-col lg:flex-row">
            <aside
              className={`min-h-0 shrink-0 border-b border-white/10 bg-[#0d1015]/82 transition-all duration-200 lg:flex lg:flex-col lg:border-b-0 lg:border-r lg:border-white/10 ${
                railCollapsed ? "lg:w-[4.25rem]" : "lg:w-[16rem]"
              }`}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                {!railCollapsed && <h2 className="text-xs uppercase tracking-[0.24em] text-white/65">SCRIBE Rail</h2>}
                <button
                  onClick={() => setRailCollapsed((previous) => !previous)}
                  className="rounded-md border border-white/20 px-2 py-1 text-[11px] transition hover:border-amber-300 hover:text-amber-200"
                >
                  {railCollapsed ? "Expand" : "Collapse"}
                </button>
              </div>

              {!railCollapsed && (
                <div className="grid flex-1 content-start gap-2 px-3 py-3">
                  {railPanelButtons.map(([panel, label]) => (
                    <button
                      key={panel}
                      onClick={() => togglePanel(panel)}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                        sidePanel === panel
                          ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                          : "border-white/15 text-white/75 hover:border-amber-300/40 hover:text-amber-100"
                      }`}
                      title={label}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {railCollapsed && (
                <div className="grid flex-1 content-start gap-2 px-2 py-3">
                  {railPanelButtons.map(([panel, label, icon]) => (
                    <button
                      key={panel}
                      onClick={() => togglePanel(panel)}
                      className={`grid h-9 w-full place-items-center rounded-md border text-[11px] transition ${
                        sidePanel === panel
                          ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                          : "border-white/15 text-white/70 hover:border-amber-300/45 hover:text-amber-100"
                      }`}
                      title={label}
                      aria-label={label}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              )}

              {!railCollapsed && (
                <div className="mt-auto border-t border-white/10 px-3 py-3 text-xs text-white/55">
                  <p>Routing</p>
                  <p className="mt-1 font-mono text-[11px] text-white/75">@gpt / @claude / duet · nested tag = handoff</p>
                </div>
              )}
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {!isEmptySession && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5 lg:px-6">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-white/75">Shared Transcript</h2>
                    <button
                      onClick={() => setTranscriptMode("single")}
                      className={`rounded-full border px-2 py-1 text-[11px] transition ${
                        transcriptMode === "single"
                          ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                          : "border-white/20 text-white/70 hover:border-amber-300/45"
                      }`}
                    >
                      Single Thread
                    </button>
                    <button
                      onClick={() => setTranscriptMode("divergence")}
                      className={`rounded-full border px-2 py-1 text-[11px] transition ${
                        transcriptMode === "divergence"
                          ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                          : "border-white/20 text-white/70 hover:border-amber-300/45"
                      }`}
                    >
                      Divergence
                    </button>
                  </div>
                  <div className="text-right text-xs text-white/55">
                    <p>{session.updated_at ? `Updated ${session.updated_at}` : "No turns yet"}</p>
                    <p>
                      Mode: {quickMode ? "Quick" : "Workspace"} · View: {transcriptMode}
                    </p>
                  </div>
                </div>
              )}

              {isEmptySession ? (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 lg:px-10">
                  <div className="w-full max-w-3xl">
                    <p className="text-center text-sm text-white/55">GPT + Claude shared state</p>
                    <h2 className="mt-2 text-center text-4xl font-medium text-white/90 md:text-5xl">What are you working on?</h2>
                    {renderComposer({ centered: true })}
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="scrollbar-thin scribe-scroll-ghost scribe-stable-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 lg:px-6"
                    tabIndex={0}
                    onKeyDown={handlePaneKeyScroll}
                  >
                    {transcriptMode === "single" ? (
                      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-black/25">
                        {sortedMessages.map((item, index) => (
                          <article
                            key={`${item.timestamp || "t"}-${index}`}
                            className={`px-4 py-3 ${
                              index < sortedMessages.length - 1 ? "border-b border-white/10" : ""
                            } ${item.role === "user" ? "bg-amber-500/7" : "bg-transparent"}`}
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
                              <span>{item.speaker || (item.role === "user" ? "You" : "Assistant")}</span>
                              <span className="rounded-full border border-white/20 px-2 py-0.5 font-mono text-[10px] text-white/75">
                                {messageRouteTag(item)}
                              </span>
                              <span className="font-mono">{item.model || item.role}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-base leading-relaxed text-white/90">{item.content}</p>
                            {item.role !== "user" && (
                              <div className="mt-3 flex items-center justify-end">
                                <button
                                  onClick={() => createArtifactFromMessage(item, index)}
                                  className="rounded-md border border-white/20 px-2 py-1 text-[11px] transition hover:border-amber-300 hover:text-amber-100"
                                >
                                  Open in Canvas
                                </button>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      sortedMessages.map((item, index) => (
                        <div key={`${item.timestamp || "t"}-${index}`} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
                          <article
                            className={`max-w-[94%] rounded-2xl border px-4 py-3 ${
                              item.role === "user" ? "border-amber-300/40 bg-amber-500/12" : "border-white/15 bg-white/5"
                            }`}
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
                              <span>{item.speaker || (item.role === "user" ? "You" : "Assistant")}</span>
                              <span className="rounded-full border border-white/20 px-2 py-0.5 font-mono text-[10px] text-white/75">
                                {messageRouteTag(item)}
                              </span>
                              <span className="font-mono">{item.model || item.role}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-base leading-relaxed text-white/90">{item.content}</p>
                            {item.role !== "user" && (
                              <div className="mt-3 flex items-center justify-end">
                                <button
                                  onClick={() => createArtifactFromMessage(item, index)}
                                  className="rounded-md border border-white/20 px-2 py-1 text-[11px] transition hover:border-amber-300 hover:text-amber-100"
                                >
                                  Open in Canvas
                                </button>
                              </div>
                            )}
                          </article>
                        </div>
                      ))
                    )}
                    <div ref={transcriptEndRef} />
                  </div>
                  {renderComposer()}
                </>
              )}
            </div>

            {(showSplitRightPanel || showOverlayRightPanel) && (
              <aside
                className={
                  showSplitRightPanel
                    ? "min-h-0 border-t border-white/10 bg-black/20 lg:w-[26rem] lg:border-l lg:border-t-0 lg:border-white/10"
                    : "pointer-events-none absolute inset-y-0 right-0 z-30 flex w-full justify-end p-2 lg:p-3"
                }
              >
                <div
                  className={
                    showSplitRightPanel
                      ? "flex min-h-0 h-full w-full flex-col"
                      : "pointer-events-auto flex h-full w-full max-w-[26rem] flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/80 shadow-2xl shadow-black/55 backdrop-blur"
                  }
                >
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-white/75">
                      {sidePanelTitles[activeRightPanel as Exclude<SidePanel, "none">]}
                    </h3>
                    <button
                      onClick={() => {
                        if (splitCanvasView) {
                          setSplitCanvasView(false);
                        } else {
                          setSidePanel("none");
                        }
                      }}
                      className="rounded-md border border-white/20 px-2 py-1 text-[11px] transition hover:border-amber-300 hover:text-amber-200"
                    >
                      {splitCanvasView ? "Undock" : "Close"}
                    </button>
                  </div>

                  <div
                    className="scrollbar-thin scribe-scroll-ghost scribe-stable-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4"
                    tabIndex={0}
                    onKeyDown={handlePaneKeyScroll}
                  >
                  {activeRightPanel === "canvas" && (
                    <div className="grid gap-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => createBlankArtifact()}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100"
                        >
                          New Artifact
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => saveCanvasSnapshot()}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Save Snapshot
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => void copyCanvasContent()}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Copy
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => exportCanvasArtifact("md")}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Export MD
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => exportCanvasArtifact("txt")}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Export TXT
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => exportCanvasArtifact("json")}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Export JSON
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => deleteActiveArtifact()}
                          className="rounded-lg border border-rose-300/40 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => toggleSplitCanvasDock()}
                          className={`rounded-lg border px-3 py-2 text-xs transition ${
                            splitCanvasView
                              ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                              : "border-white/20 text-white/75 hover:border-amber-300/45"
                          }`}
                        >
                          {splitCanvasView ? "Undock Split" : "Dock Split"}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          disabled={!activeArtifact}
                          onClick={() => injectCanvasIntoComposer("gpt")}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Inject @gpt
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => injectCanvasIntoComposer("claude")}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Inject @claude
                        </button>
                        <button
                          disabled={!activeArtifact}
                          onClick={() => injectCanvasIntoComposer("duet")}
                          className="rounded-lg border border-white/20 px-3 py-2 text-xs transition hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                        >
                          Inject Duet
                        </button>
                      </div>

                      <div className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
                        <input
                          value={canvasSearch}
                          onChange={(event) => setCanvasSearch(event.target.value)}
                          placeholder="Search artifacts"
                          className="w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-xs outline-none focus:border-amber-300"
                        />
                        <label className="flex items-center gap-2 text-xs text-white/70">
                          <input
                            type="checkbox"
                            checked={showPinnedOnly}
                            onChange={(event) => setShowPinnedOnly(event.target.checked)}
                          />
                          Show pinned only
                        </label>
                      </div>

                      {canvasStatus && <p className="text-xs text-white/60">{canvasStatus}</p>}

                      {artifacts.length === 0 && (
                        <div className="rounded-xl border border-dashed border-white/15 p-3 text-xs text-white/60">
                          Create a canvas doc from any assistant response using &quot;Open in Canvas&quot;.
                        </div>
                      )}

                      {artifacts.length > 0 && visibleArtifacts.length === 0 && (
                        <div className="rounded-xl border border-dashed border-white/15 p-3 text-xs text-white/60">
                          No artifacts match your filter.
                        </div>
                      )}

                      {visibleArtifacts.length > 0 && (
                        <>
                          <div className="grid gap-2">
                            {visibleArtifacts.map((artifact) => {
                              const pinned = pinnedArtifactIds.includes(artifact.id);
                              return (
                                <div
                                  key={artifact.id}
                                  className={`rounded-lg border px-3 py-2 text-xs transition ${
                                    activeArtifactId === artifact.id
                                      ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                                      : "border-white/15 text-white/75 hover:border-amber-300/45"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <button className="min-w-0 text-left" onClick={() => setActiveArtifactId(artifact.id)}>
                                      <div className="truncate font-medium">{artifact.title || "Untitled artifact"}</div>
                                      <div className="mt-1 truncate text-[11px] text-white/55">
                                        {artifact.sourceSpeaker} {artifact.sourceModel ? `· ${artifact.sourceModel}` : ""}
                                      </div>
                                    </button>
                                    <button
                                      onClick={() => toggleArtifactPin(artifact.id)}
                                      className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                                        pinned
                                          ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                                          : "border-white/20 text-white/70 hover:border-amber-300/45"
                                      }`}
                                    >
                                      {pinned ? "Pinned" : "Pin"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {activeArtifact && (
                            <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                              <div>
                                <label className="block text-[11px] uppercase tracking-wider text-white/55">Title</label>
                                <input
                                  className="mt-2 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                                  value={canvasDraftTitle}
                                  onChange={(event) => setCanvasDraftTitle(event.target.value)}
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] uppercase tracking-wider text-white/55">Content</label>
                                <textarea
                                  className="mt-2 h-64 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                                  value={canvasDraftContent}
                                  onChange={(event) => setCanvasDraftContent(event.target.value)}
                                />
                              </div>

                              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="text-[11px] uppercase tracking-wider text-white/55">Version</label>
                                  <select
                                    value={selectedCanvasVersionId}
                                    onChange={(event) => setSelectedCanvasVersionId(event.target.value)}
                                    className="min-w-[12rem] rounded-md border border-white/20 bg-black/40 px-2 py-1 text-xs outline-none focus:border-amber-300"
                                  >
                                    {activeArtifact.versions.map((version) => (
                                      <option key={version.id} value={version.id}>
                                        {version.updatedAt}
                                        {version.note ? ` (${version.note})` : ""}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => loadSelectedVersionToDraft()}
                                    className="rounded-md border border-white/20 px-2 py-1 text-[11px] transition hover:border-amber-300 hover:text-amber-100"
                                  >
                                    Load to Draft
                                  </button>
                                  <button
                                    onClick={() => restoreSelectedVersion()}
                                    className="rounded-md border border-white/20 px-2 py-1 text-[11px] transition hover:border-amber-300 hover:text-amber-100"
                                  >
                                    Restore Live
                                  </button>
                                  <button
                                    onClick={() => setShowCanvasDiff((previous) => !previous)}
                                    className={`rounded-md border px-2 py-1 text-[11px] transition ${
                                      showCanvasDiff
                                        ? "border-amber-300/70 bg-amber-500/20 text-amber-100"
                                        : "border-white/20 text-white/75 hover:border-amber-300/45"
                                    }`}
                                  >
                                    {showCanvasDiff ? "Hide Diff" : "Show Diff"}
                                  </button>
                                </div>

                                {showCanvasDiff && selectedCanvasVersion && (
                                  <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-white/10 bg-black/25 px-2 py-2 font-mono text-[11px] scribe-scroll-ghost">
                                    {canvasDiffLines.length === 0 ? (
                                      <p className="text-white/55">No diff.</p>
                                    ) : (
                                      canvasDiffLines.map((line, lineIndex) => (
                                        <div
                                          key={`diff-${lineIndex}`}
                                          className={
                                            line.kind === "add"
                                              ? "whitespace-pre-wrap bg-emerald-500/15 text-emerald-100"
                                              : line.kind === "del"
                                                ? "whitespace-pre-wrap bg-rose-500/15 text-rose-100"
                                                : "whitespace-pre-wrap text-white/65"
                                          }
                                        >
                                          {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} {line.text}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {activeRightPanel === "memory" && (
                    <div className="grid gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <label className="block text-xs uppercase tracking-wider text-white/60">Summary</label>
                        <textarea
                          className="mt-2 h-16 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-amber-300"
                          value={memorySummaryInput}
                          onChange={(event) => setMemorySummaryInput(event.target.value)}
                        />
                      </div>
                      <div className="grid gap-3">
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

                  {activeRightPanel === "advanced" && (
                    <div className="grid gap-4">
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

                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <h4 className="text-sm font-semibold uppercase tracking-wider text-stone-200">Codex Lane</h4>
                          <div className="mt-3 grid gap-2">
                            <input
                              className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-stone-400"
                              value={openaiModel}
                              onChange={(event) => setOpenaiModel(event.target.value)}
                              placeholder={DEFAULT_OPENAI_MODEL}
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
                          <h4 className="text-sm font-semibold uppercase tracking-wider text-orange-200">Claude Lane</h4>
                          <div className="mt-3 grid gap-2">
                            <input
                              className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm outline-none focus:border-orange-400"
                              value={anthropicModel}
                              onChange={(event) => setAnthropicModel(event.target.value)}
                              placeholder={DEFAULT_ANTHROPIC_MODEL}
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

                  {activeRightPanel === "research" && (
                    <div className="space-y-4">
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
                            Open {researchMode}
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
                          <iframe src={buildResearchLaunchUrl(researchMode)} title="Research App" className="h-[340px] w-full bg-white" />
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

                  {activeRightPanel === "personas" && (
                    <div className="grid gap-3">
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
                  </div>
              </div>
              </aside>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
