import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { input } = await req.json();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // This is a placeholder stream — replace with real model call
      for (const word of `Echo: ${input}`.split(" ")) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ agent: "echo", token: word + " " })}\n\n`));
        await new Promise((res) => setTimeout(res, 200));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

