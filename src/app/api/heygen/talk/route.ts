import { NextRequest } from 'next/server';

import { createHeygenVideo, getHeygenVideoStatus } from '@/lib/heygen';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as {
      text?: string;
      agentId?: string;
      avatarId?: string;
      voiceId?: string;
      templateId?: string;
      testMode?: boolean;
    };

    if (!payload?.text || !payload.text.trim()) {
      return new Response('text is required', { status: 400 });
    }

    const text = payload.text.trim();
    const response = await createHeygenVideo({
      text,
      agentId: payload.agentId,
      avatarId: payload.avatarId,
      voiceId: payload.voiceId,
      templateId: payload.templateId,
      testMode: payload.testMode,
    });
    return Response.json(
      {
        ok: true,
        videoId: response?.data?.video_id,
        response,
      },
      { status: 202 }
    );
  } catch (error: any) {
    const message = error?.message || 'HeyGen video generation failed';
    const code = message.includes('HEYGEN_API_KEY') ? 500 : 502;
    return Response.json({ ok: false, error: message }, { status: code });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get('videoId');

  if (!videoId) {
    return new Response('videoId query parameter required', { status: 400 });
  }

  try {
    const status = await getHeygenVideoStatus(videoId);
    return Response.json({ ok: true, videoId, status });
  } catch (error: any) {
    const message = error?.message || 'HeyGen status fetch failed';
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
