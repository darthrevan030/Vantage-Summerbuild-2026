// app/api/analyst/route.ts
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { parseBody, buildSentiment, buildAsk } from "@/lib/analyst/prompts";

type SSESend = (payload: object) => void;

export const dynamic = "force-dynamic";

// ---------- streaming adapters ----------
async function streamAnthropic(
  { system, user, maxTokens, signal, send }: {
    system: string;
    user: string;
    maxTokens: number;
    signal: AbortSignal;
    send: SSESend;
  },
) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = client.messages.stream(
      {
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal }, // abort upstream when the client disconnects
    );

    for await (const chunk of response) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        send({ type: "text", text: chunk.delta.text });
      }
    }

    const final = await response.finalMessage();
    send({ type: "done", stopReason: final.stop_reason });
  } catch (err) {
    if (!signal.aborted) {
      console.error("anthropic stream error:", err);
      send({ type: "error" });
    }
  }
}

async function streamOpenRouter(
  { system, user, maxTokens, signal, send }: {
    system: string;
    user: string;
    maxTokens: number;
    signal: AbortSignal;
    send: SSESend;
  },
) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://localhost:3000",
        "X-Title": "Finance Dashboard",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL,
        max_tokens: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`OpenRouter returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let stopReason = "stop";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6).trim();
        if (data === "[DONE]") break;

        try {
          const evt = JSON.parse(data);
          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) send({ type: "text", text: delta });

          const reason = evt.choices?.[0]?.finish_reason;
          if (reason) {
            stopReason = reason === "length" ? "max_tokens" : "end_turn";
          }
        } catch {
          // malformed frame; skip
        }
      }
    }

    send({ type: "done", stopReason });
  } catch (err) {
    if (!signal.aborted) {
      console.error("openrouter stream error:", err);
      send({ type: "error" });
    }
  }
}

// ---------- handler ----------
export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("analyst", 10, 60, {
    failClosed: true,
  });
  if (limited) return limited;

  const flags = await getProviderFlags();
  const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY?.trim();
  const canUseOpenRouter = flags.openrouter && hasOpenRouterKey;
  const canUseAnthropic = flags.anthropic;

  if (!canUseOpenRouter && !canUseAnthropic) {
    return Response.json(
      { error: "Analyst AI is currently disabled" },
      { status: 503 },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = parseBody(raw);
  if (!parsed) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const { system, user, maxTokens } =
    parsed.mode === "sentiment"
      ? buildSentiment(parsed.assets)
      : buildAsk(parsed.question, parsed.holdings, parsed.totalSGD);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          /* client disconnected */
        }
      };

      try {
        if (canUseOpenRouter) {
          await streamOpenRouter({ system, user, maxTokens, signal: req.signal, send });
        } else {
          await streamAnthropic({ system, user, maxTokens, signal: req.signal, send });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      /* consumer went away; req.signal handles upstream abort */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
