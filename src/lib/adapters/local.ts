import OpenAI from 'openai';

type ChatArgs = { prompt: string; stream?: boolean; model?: string };

const LOCAL_BASE_URL = (process.env.LOCAL_OPENAI_BASE_URL || 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
const LOCAL_API_KEY = process.env.LOCAL_OPENAI_API_KEY || 'local-dev-key';
const LOCAL_MODEL_NAME = process.env.LOCAL_MODEL_NAME || 'gpt-oss-120b';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: LOCAL_API_KEY,
      baseURL: LOCAL_BASE_URL,
    });
  }
  return client;
}

export async function chat({ prompt, stream = false, model }: ChatArgs): Promise<any> {
  const messages = [{ role: 'user' as const, content: prompt }];
  const mdl = model || LOCAL_MODEL_NAME;

  if (!stream) {
    const response = await getClient().chat.completions.create({ model: mdl, messages, stream: false });
    const content = response.choices?.[0]?.message?.content ?? '';
    return { content };
  }

  const encoder = new TextEncoder();
  const resp = await getClient().chat.completions.create({ model: mdl, messages, stream: true });

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of resp) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`)
            );
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });
}
