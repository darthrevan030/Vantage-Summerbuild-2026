import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/supabase/guards";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_PROMPT_LENGTH = 4000;

export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const prompt = body?.prompt;

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `prompt must be at most ${MAX_PROMPT_LENGTH} characters` },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (text: string) =>
        controller.enqueue(encoder.encode(`data: ${text}\n\n`));

      try {
        const response = await client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
          system:
            "You are a portfolio analyst assistant. Provide concise, insightful analysis of the user's portfolio holdings and market conditions. Be direct and data-focused.",
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            enqueue(chunk.delta.text);
          }
        }

        enqueue("[DONE]");
      } catch (err) {
        enqueue("[ERROR]");
        console.error("analyst stream error:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
