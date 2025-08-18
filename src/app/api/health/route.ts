import { NextResponse } from 'next/server';

type Provider = 'gpt' | 'claude' | 'grok';

function statusFor(p: Provider) {
  switch (p) {
    case 'gpt':
      return {
        ok: Boolean(process.env.OPENAI_API_KEY),
        model: process.env.MODEL_NAME_OPENAI || 'unset',
      };
    case 'claude':
      return {
        ok: Boolean(process.env.ANTHROPIC_API_KEY),
        model: process.env.MODEL_NAME_ANTHROPIC || 'unset',
      };
    case 'grok':
    default:
      return {
        ok: Boolean(process.env.XAI_API_KEY),
        model: process.env.MODEL_NAME_XAI || 'grok-4-0709',
      };
  }
}

export async function GET() {
  const payload = {
    ok: true,
    time: new Date().toISOString(),
    providers: {
      gpt: statusFor('gpt'),
      claude: statusFor('claude'),
      grok: statusFor('grok'),
    },
  };
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

