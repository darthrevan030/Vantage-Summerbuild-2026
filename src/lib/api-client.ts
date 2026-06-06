export async function fetchPrices(
  tickers: string[]
): Promise<Record<string, number>> {
  const res = await fetch("/api/prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
  if (!res.ok) throw new Error(`fetchPrices failed: ${res.status}`);
  return res.json();
}

export async function fetchFx(
  base = "SGD",
  date?: string
): Promise<Record<string, number>> {
  const params = new URLSearchParams({ base });
  if (date) params.set("date", date);
  const res = await fetch(`/api/fx?${params}`);
  if (!res.ok) throw new Error(`fetchFx failed: ${res.status}`);
  return res.json();
}

export async function fetchQuote(
  symbol: string
): Promise<{ price: number; change: number; changePct: number }> {
  const res = await fetch(`/api/quotes?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`fetchQuote failed: ${res.status}`);
  return res.json();
}

export async function streamAnalysis(
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/analyst", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!res.ok) throw new Error(`streamAnalysis failed: ${res.status}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (line.startsWith("data: ")) {
        const text = line.slice(6);
        if (text !== "[DONE]") onChunk(text);
      }
    }
  }
}
