// Temporary debug endpoint - remove after testing
export async function GET() {
  return Response.json({
    anthropic_key_present: !!process.env.ANTHROPIC_API_KEY,
    anthropic_key_prefix: process.env.ANTHROPIC_API_KEY?.slice(0, 15) || 'missing',
    openai_key_present: !!process.env.OPENAI_API_KEY,
    xai_key_present: !!process.env.XAI_API_KEY,
  });
}
