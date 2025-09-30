import { resolveAgentHeygen } from '@/server/agents';

type GenerateRequest = {
  agentId?: string;
  text: string;
  avatarId?: string;
  voiceId?: string;
  templateId?: string;
  testMode?: boolean;
};

type HeygenResponse<T = unknown> = {
  data?: T;
  status?: string;
  message?: string;
};

type VideoJob = {
  video_id: string;
  status?: string;
  video_url?: string;
  metadata?: Record<string, unknown>;
};

const API_BASE = process.env.HEYGEN_API_BASE_URL ?? 'https://api.heygen.com';

function getApiKey() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    throw new Error('HEYGEN_API_KEY not configured');
  }
  return key;
}

async function handleJson<T>(res: Response): Promise<HeygenResponse<T>> {
  let body: HeygenResponse<T>;
  try {
    body = (await res.json()) as HeygenResponse<T>;
  } catch (error) {
    throw new Error(`Failed to parse HeyGen response (${res.status})`);
  }

  if (!res.ok) {
    const message = body?.message || `HeyGen API error (${res.status})`;
    throw new Error(message);
  }

  return body;
}

export async function createHeygenVideo({
  agentId,
  text,
  avatarId,
  voiceId,
  templateId,
  testMode = true,
}: GenerateRequest) {
  if (!text || !text.trim()) {
    throw new Error('Text is required for HeyGen video generation');
  }

  const baseIdentity = resolveAgentHeygen(agentId);
  const body = {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: avatarId ?? baseIdentity.avatarId,
        },
        voice: {
          type: 'heygen',
          voice_id: voiceId ?? baseIdentity.voiceId,
        },
        input_text: text,
      },
    ],
    test: testMode,
    soundtrack: 'corporate',
    aspect_ratio: '16:9',
    quality: 'high',
    background: baseIdentity.templateId
      ? {
          type: 'image',
          id: baseIdentity.templateId,
        }
      : undefined,
  };

  const res = await fetch(`${API_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': getApiKey(),
    },
    body: JSON.stringify(body),
  });

  const json = await handleJson<{ video_id: string }>(res);
  return json;
}

export async function getHeygenVideoStatus(videoId: string) {
  if (!videoId) {
    throw new Error('videoId required');
  }

  const res = await fetch(`${API_BASE}/v2/video/status?video_id=${encodeURIComponent(videoId)}`, {
    method: 'GET',
    headers: {
      'X-Api-Key': getApiKey(),
    },
    cache: 'no-store',
  });

  const json = await handleJson<VideoJob>(res);
  return json;
}
