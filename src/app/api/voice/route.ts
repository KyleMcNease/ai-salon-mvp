import { Buffer } from 'buffer';
import { NextRequest } from 'next/server';

import { MemoryServiceClient } from '@/lib/memoryService';
import { synthesizeSpeech } from '@/lib/voice';
import { resolveAgentVoiceId } from '@/server/agents';

export const runtime = 'nodejs';

interface VoiceRequest {
  text: string;
  voiceId?: string;
  sessionId?: string;
  messageId?: string;
  tenantId?: string;
  agentId?: string;
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

  try {
    const agentId = (payload.agentId || '').trim() || 'gpt';
    const resolvedVoiceId = resolveAgentVoiceId(agentId, payload.voiceId);

    if (!resolvedVoiceId) {
      return new Response('Voice ID not configured for agent', { status: 500 });
    }

    const audio = await synthesizeSpeech(text, { voiceId: resolvedVoiceId });
    const audioBuffer = Buffer.from(audio.audio);

    if (payload.sessionId) {
      const memory = new MemoryServiceClient();
      try {
        const artifactId = payload.messageId || `audio-${audio.requestId}`;
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
                uri: `data:${audio.mimeType};base64,${audioBuffer.toString('base64')}`,
                mime_type: audio.mimeType,
                message_id: payload.messageId,
                metadata: {
                  provider: 'elevenlabs',
                  voice_id: audio.voiceId,
                  agent_id: agentId,
                },
              },
            ],
            events: payload.messageId
              ? [
                  {
                    id: `voice-${audio.requestId}`,
                    action: 'VOICE_READY',
                    created_at: timestamp,
                    actor: 'voice-service',
                    payload: {
                      messageId: payload.messageId,
                      voiceId: audio.voiceId,
                      mimeType: audio.mimeType,
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

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': audio.mimeType,
        'Content-Length': String(audioBuffer.byteLength),
        'X-Voice-Id': audio.voiceId,
        'X-Agent-Id': agentId,
        'X-Request-Id': audio.requestId,
      },
    });
  } catch (error: any) {
    console.error('voice synthesis failed', error);
    return new Response(error?.message || 'Voice synthesis failed', { status: 500 });
  }
}
