export type AgentId = 'gpt' | 'claude' | 'grok' | 'opus' | 'local';

type AgentDisplay = {
  id: AgentId;
  displayName: string;
  providerName: string;
  tagline: string;
  color: string;
  voiceStyle: string;
  avatarStyle: string;
  avatarUrl?: string;
};

const envAvatar = (value: string | undefined | null) =>
  value && value.trim().length > 0 ? value.trim() : undefined;

export const AGENT_DISPLAY: Record<AgentId, AgentDisplay> = {
  gpt: {
    id: 'gpt',
    displayName: 'GPT-5',
    providerName: 'OpenAI',
    tagline: 'Serene philosopher with Eastern wisdom and playful humor.',
    color: '#2563eb',
    voiceStyle: 'Watts-like; calm British cadence with reflective pacing.',
    avatarStyle: 'HeyGen avatar with tranquil library backdrop.',
    avatarUrl: envAvatar(process.env.NEXT_PUBLIC_HEYGEN_AVATAR_URL_GPT),
  },
  claude: {
    id: 'claude',
    displayName: 'Claude 3.5 Sonnet',
    providerName: 'Anthropic',
    tagline: 'Existential narrator with poetic precision and care.',
    color: '#a855f7',
    voiceStyle: 'Herzog-inspired; resonant, deliberate, inquisitive.',
    avatarStyle: 'HeyGen avatar styled as reflective documentarian.',
    avatarUrl: envAvatar(process.env.NEXT_PUBLIC_HEYGEN_AVATAR_URL_CLAUDE),
  },
  grok: {
    id: 'grok',
    displayName: 'Grok-2',
    providerName: 'xAI',
    tagline: 'Futurist raconteur with cosmic urgency and wit.',
    color: '#f97316',
    voiceStyle: 'Hari Seldon-esque; deep, gravelly, authoritative.',
    avatarStyle: 'HeyGen avatar with sci-fi console environment.',
    avatarUrl: envAvatar(process.env.NEXT_PUBLIC_HEYGEN_AVATAR_URL_GROK),
  },
  opus: {
    id: 'opus',
    displayName: 'Claude 3 Opus',
    providerName: 'Anthropic',
    tagline: 'Orchestral strategist for Manus plan-and-verify loops.',
    color: '#ec4899',
    voiceStyle: 'Elevated Sonnet timbre with confident clarity.',
    avatarStyle: 'HeyGen avatar with studio lighting and warm palette.',
    avatarUrl: envAvatar(process.env.NEXT_PUBLIC_HEYGEN_AVATAR_URL_OPUS),
  },
  local: {
    id: 'local',
    displayName: 'OSS Salon',
    providerName: 'Local vLLM',
    tagline: 'Offline co-researcher grounded in safe-mode context.',
    color: '#0f766e',
    voiceStyle: 'NeuTTS neutral voice with on-device synthesis.',
    avatarStyle: 'Minimal terminal glyph with teal glow.',
    avatarUrl: envAvatar(process.env.NEXT_PUBLIC_LOCAL_AVATAR_URL),
  },
};

export const DEFAULT_AGENT = AGENT_DISPLAY.gpt;

export function getAgentDisplay(agentId?: string | null) {
  if (!agentId) return DEFAULT_AGENT;
  const key = agentId.toLowerCase() as AgentId;
  return AGENT_DISPLAY[key] ?? DEFAULT_AGENT;
}
