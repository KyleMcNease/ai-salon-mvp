import { Buffer } from 'buffer';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

import { MemoryServiceClient } from '@/lib/memoryService';
import { synthesizeSpeech } from '@/lib/voice';
import { resolveAgentVoiceId } from '@/server/agents';
import { deriveScope } from '@/config/safeMode';

export const runtime = 'nodejs';

interface VoiceRequest {
  text: string;
  voiceId?: string;
  sessionId?: string;
  messageId?: string;
  tenantId?: string;
  agentId?: string;
  safeMode?: boolean;
}

export async function POST(req: NextRequest) {
  let payload: VoiceRequest;
  try {
    payload = (await req.json()) as VoiceRequest;
  } catch (error) {
    return new Response('Invalid JSON payload', { status: 400 });
  }

  const text = payload.text?.trim();
  if (!text) {
    return new Response('text is required', { status: 400 });
  }

  const agentId = (payload.agentId || '').trim() || 'gpt';
  const safeMode = Boolean(payload.safeMode);
  const scope = deriveScope(safeMode);
  const resolvedVoiceId = resolveAgentVoiceId(agentId, payload.voiceId);

  if (!resolvedVoiceId) {
    return new Response('Voice ID not configured for agent', { status: 500 });
  }

  const localTtsUrl =
    process.env.NEUTTS_TTS_URL ||
    process.env.NEXT_PUBLIC_NEUTTS_TTS_URL ||
    'http://127.0.0.1:9009/speak.wav';

  async function tryLocalTts(): Promise<{
    audio: Buffer;
    mimeType: string;
    voiceId: string;
    requestId: string;
    provider: string;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(localTtsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Local TTS returned ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') ?? 'audio/wav';
      const voiceId = response.headers.get('x-voice-id') ?? 'neutts-air';
      const requestId = response.headers.get('x-request-id') ?? randomUUID();
      return {
        audio: Buffer.from(arrayBuffer),
        mimeType,
        voiceId,
        requestId,
        provider: 'neutts-air',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function tryElevenLabs(): Promise<{
    audio: Buffer;
    mimeType: string;
    voiceId: string;
    requestId: string;
    provider: string;
  }> {
    const agentId = (payload.agentId || '').trim() || 'gpt';
    const audio = await synthesizeSpeech(text, { voiceId: resolvedVoiceId });
    const audioBuffer = Buffer.from(audio.audio);
    return {
      audio: audioBuffer,
      mimeType: audio.mimeType,
      voiceId: audio.voiceId,
      requestId: audio.requestId,
      provider: 'elevenlabs',
    };
  }

  let result:
    | {
        audio: Buffer;
        mimeType: string;
        voiceId: string;
        requestId: string;
        provider: string;
      }
    | undefined;

  try {
    result = await tryLocalTts();
  } catch (localError) {
    console.warn('Local NeuTTS request failed, falling back to ElevenLabs', localError);
    if (safeMode) {
      return new Response('Local TTS is unavailable while Safe Mode is active.', { status: 503 });
    }
    try {
      result = await tryElevenLabs();
    } catch (error: any) {
      console.error('voice synthesis failed', error);
      return new Response(error?.message || 'Voice synthesis failed', { status: 500 });
    }
  }

  if (!result) {
    return new Response('Voice synthesis failed', { status: 500 });
  }

  try {
    const audioBuffer = result.audio;

    if (payload.sessionId) {
      const memory = new MemoryServiceClient();
      try {
        const artifactId = payload.messageId || `audio-${result.requestId}`;
        const timestamp = new Date().toISOString();
        await memory.saveContext({
          version: '2025-09-01',
          tenant_id: payload.tenantId || 'default',
          session_id: payload.sessionId,
          actor: 'voice-service',
          payload: {
            media_artifacts: [
              {
                id: artifactId,
                type: 'AUDIO',
                uri: `data:${result.mimeType};base64,${audioBuffer.toString('base64')}`,
                mime_type: result.mimeType,
                message_id: payload.messageId,
                metadata: {
                  provider: result.provider,
                  voice_id: result.voiceId,
                  agent_id: agentId,
                  scope,
                },
              },
            ],
            events: payload.messageId
              ? [
                  {
                    id: `voice-${result.requestId}`,
                    action: 'VOICE_READY',
                    created_at: timestamp,
                    actor: 'voice-service',
                    payload: {
                      messageId: payload.messageId,
                      voiceId: result.voiceId,
                      mimeType: result.mimeType,
                      scope,
                    },
                  },
                ]
              : undefined,
          },
        });
      } catch (memoryError) {
        console.warn('Failed to persist audio artifact', memoryError);
      }
    }

    return new Response(audioBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(audioBuffer.byteLength),
        'X-Voice-Id': result.voiceId,
        'X-Agent-Id': agentId,
        'X-Request-Id': result.requestId,
      },
    });
  } catch (error: any) {
    console.error('voice synthesis failed', error);
    return new Response(error?.message || 'Voice synthesis failed', { status: 500 });
  }
}
