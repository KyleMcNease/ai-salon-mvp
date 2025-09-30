import type { AgentId } from '@/config/agents';

type VoiceMap = Partial<Record<AgentId, string>>;

type HeygenIdentity = {
  avatarId?: string;
  voiceId?: string;
  templateId?: string;
};

type HeygenMap = Partial<Record<AgentId, HeygenIdentity>>;

const asAgentId = (value: string | undefined | null): AgentId | undefined => {
  if (!value) return undefined;
  const key = value.toLowerCase();
  if (key === 'gpt' || key === 'claude' || key === 'grok' || key === 'opus') {
    return key;
  }
  return undefined;
};

const defaultVoice = process.env.ELEVENLABS_VOICE_ID_DEFAULT ?? process.env.ELEVENLABS_VOICE_ID;

const voiceMap: VoiceMap = {
  gpt:
    process.env.ELEVENLABS_VOICE_ID_GPT ??
    process.env.ELEVENLABS_VOICE_ID_WATTS ??
    defaultVoice,
  claude:
    process.env.ELEVENLABS_VOICE_ID_CLAUDE ??
    process.env.ELEVENLABS_VOICE_ID_SONNET ??
    defaultVoice,
  grok:
    process.env.ELEVENLABS_VOICE_ID_GROK ??
    process.env.ELEVENLABS_VOICE_ID_HARI ??
    defaultVoice,
  opus:
    process.env.ELEVENLABS_VOICE_ID_OPUS ??
    process.env.ELEVENLABS_VOICE_ID_CLAUDE ??
    defaultVoice,
};

if (!voiceMap.opus) {
  voiceMap.opus = voiceMap.claude ?? defaultVoice;
}

const heygenTemplate = process.env.HEYGEN_TEMPLATE_ID ?? process.env.HEYGEN_SCENE_ID_DEFAULT;

const heygenMap: HeygenMap = {
  gpt: {
    avatarId: process.env.HEYGEN_AVATAR_ID_GPT,
    voiceId: process.env.HEYGEN_VOICE_ID_GPT,
    templateId: heygenTemplate,
  },
  claude: {
    avatarId: process.env.HEYGEN_AVATAR_ID_CLAUDE,
    voiceId: process.env.HEYGEN_VOICE_ID_CLAUDE,
    templateId: heygenTemplate,
  },
  grok: {
    avatarId: process.env.HEYGEN_AVATAR_ID_GROK,
    voiceId: process.env.HEYGEN_VOICE_ID_GROK,
    templateId: heygenTemplate,
  },
  opus: {
    avatarId: process.env.HEYGEN_AVATAR_ID_OPUS ?? process.env.HEYGEN_AVATAR_ID_CLAUDE,
    voiceId: process.env.HEYGEN_VOICE_ID_OPUS ?? process.env.HEYGEN_VOICE_ID_CLAUDE,
    templateId: heygenTemplate,
  },
};

export function resolveAgentVoiceId(agentId?: string | null, explicitVoiceId?: string | null) {
  if (explicitVoiceId && explicitVoiceId.trim().length > 0) {
    return explicitVoiceId.trim();
  }

  const key = asAgentId(agentId) ?? ('gpt' as AgentId);
  return voiceMap[key] ?? defaultVoice;
}

export function resolveAgentHeygen(agentId?: string | null): HeygenIdentity {
  const key = asAgentId(agentId) ?? ('gpt' as AgentId);
  const identity = heygenMap[key] ?? {};
  return {
    avatarId: identity.avatarId ?? process.env.HEYGEN_AVATAR_ID_DEFAULT,
    voiceId: identity.voiceId ?? process.env.HEYGEN_VOICE_ID_DEFAULT,
    templateId: identity.templateId ?? heygenTemplate,
  };
}
