// lib/api-client.ts
// Typed client for /api/analyst. Parses SSE with JSON envelopes:
//   {type:"text",text} | {type:"done",stopReason} | {type:"error"}
import type {
  SentimentAsset,
  AskHolding,
  PortfolioContext,
} from "@/lib/analyst/prompts";

export interface StreamResult {
  text: string;
  stopReason: string | null; // "end_turn" | "max_tokens" | ...
}

type AnalystBody =
  | { mode: "sentiment"; assets: SentimentAsset[]; portfolio: PortfolioContext }
  | {
      mode: "ask";
      question: string;
      holdings: AskHolding[];
      portfolio: PortfolioContext;
    };

async function streamAnalyst(
  body: AnalystBody,
  onText?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch("/api/analyst", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`analyst request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason: string | null = null;
  let errored = false;

  const handleEvent = (data: string) => {
    let evt: { type: string; text?: string; stopReason?: string };
    try {
      evt = JSON.parse(data);
    } catch {
      return; // malformed frame; skip
    }
    if (evt.type === "text" && typeof evt.text === "string") {
      text += evt.text;
      onText?.(evt.text);
    } else if (evt.type === "done") {
      stopReason = evt.stopReason ?? null;
    } else if (evt.type === "error") {
      errored = true;
    }
  };

  // SSE framing: events separated by blank lines; payload lines start "data: "
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) handleEvent(line.slice(6));
      }
    }
  }

  if (errored) throw new Error("analyst stream reported an error");
  return { text, stopReason };
}

/** Sentiment scan: accumulates the full JSON response. */
export function streamSentiment(
  assets: SentimentAsset[],
  portfolio: PortfolioContext,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return streamAnalyst({ mode: "sentiment", assets, portfolio }, undefined, signal);
}

/** Ask-the-analyst: streams chunks live via onText. */
export function streamAsk(
  question: string,
  holdings: AskHolding[],
  portfolio: PortfolioContext,
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return streamAnalyst({ mode: "ask", question, holdings, portfolio }, onText, signal);
}
