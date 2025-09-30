import { randomUUID } from 'crypto';

interface VoiceOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  text?: string;
}

export interface SynthesizedSpeech {
  audio: Uint8Array;
  mimeType: string;
  voiceId: string;
  requestId: string;
}

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_MIME = 'audio/mpeg';

export async function synthesizeSpeech(
  text: string,
  options: VoiceOptions = {}
): Promise<SynthesizedSpeech> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  if (!voiceId) {
    throw new Error('Voice ID missing (set ELEVENLABS_VOICE_ID)');
  }

  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const body = {
    text,
    model_id: options.modelId ?? DEFAULT_MODEL,
    voice_settings: {
      stability: options.stability ?? 0.35,
      similarity_boost: options.similarityBoost ?? 0.75,
      style: options.style ?? 0,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs synthesis failed (${response.status}): ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audio: new Uint8Array(arrayBuffer),
    mimeType: response.headers.get('content-type') || DEFAULT_MIME,
    voiceId,
    requestId: response.headers.get('x-request-id') || randomUUID(),
  };
}
