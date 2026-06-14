export interface SGXQuote {
  price: number;
  prevPrice: number | null;
  changePct: number | null;
  name: string;
}

type SGXResult = Record<string, SGXQuote>;

const SGX_TYPES = ["stocks", "reits", "etfs", "businesstrusts"] as const;

// SGX API returns all listed securities of each type.
// nc = ticker, lt = last trade, pv = previous close, p = change%, n = name
function parseItems(items: unknown[]): SGXResult {
  const out: SGXResult = {};
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const nc = typeof rec["nc"] === "string" ? rec["nc"].trim() : null;
    if (!nc) continue;
    const lt = Number(rec["lt"]);
    const pv = Number(rec["pv"]);
    const p  = typeof rec["p"] === "string" ? Number(rec["p"].replace(/[^0-9.\-+]/g, "")) : null;
    out[nc] = {
      price:     isFinite(lt) && lt > 0 ? lt : 0,
      prevPrice: isFinite(pv) && pv > 0 ? pv : null,
      changePct: p !== null && isFinite(p) ? p : null,
      name:      typeof rec["n"] === "string" ? rec["n"] : nc,
    };
  }
  return out;
}

function extractItems(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (typeof json !== "object" || json === null) return [];
  const obj = json as Record<string, unknown>;
  // Try common SGX response shapes
  if (Array.isArray(obj["data"])) return obj["data"] as unknown[];
  if (typeof obj["data"] === "object" && obj["data"] !== null) {
    const data = obj["data"] as Record<string, unknown>;
    if (Array.isArray(data["prices"])) return data["prices"] as unknown[];
    if (Array.isArray(data["items"]))  return data["items"]  as unknown[];
  }
  if (Array.isArray(obj["prices"])) return obj["prices"] as unknown[];
  return [];
}

export async function fetchSGXPrices(
  tickers: Set<string>
): Promise<SGXResult> {
  if (tickers.size === 0) return {};

  const results = await Promise.allSettled(
    SGX_TYPES.map(async (type) => {
      const res = await fetch(`https://api.sgx.com/securities/v1.1/${type}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
      });
      if (!res.ok) {
        console.warn(`[SGX] ${type} → HTTP ${res.status}`);
        return {} as SGXResult;
      }
      const json = await res.json();
      return parseItems(extractItems(json));
    })
  );

  const merged: SGXResult = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const [ticker, quote] of Object.entries(r.value)) {
        if (tickers.has(ticker)) merged[ticker] = quote;
      }
    }
  }
  return merged;
}
