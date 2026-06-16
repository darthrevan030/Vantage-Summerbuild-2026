import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { getProviderFlags } from "@/lib/supabase/app-config";

// ── Sentiment tagging ────────────────────────────────────────────────────────

const POS =
  /\b(surge|beat|record|gain|rise|profit|growth|upgrade|strong|soar|exceed|higher|boost|rally|outperform|rebound)\b/i;
const NEG =
  /\b(fall|miss|cut|loss|drop|plunge|downgrade|weak|decline|warn|disappoint|tumble|slide|concern|risk|below|slump)\b/i;

function tag(headline: string): "pos" | "neg" | "neu" {
  return POS.test(headline) ? "pos" : NEG.test(headline) ? "neg" : "neu";
}

function ago(unixSec: number): string {
  const s = Date.now() / 1000 - unixSec;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

// ── Ticker format helpers ────────────────────────────────────────────────────

// EODHD exchange suffix → Finnhub exchange prefix
const EODHD_TO_FINNHUB: Record<string, string> = {
  US: "",      // US stocks use bare ticker on Finnhub
  LSE: "LSE:",
  TSE: "TSE:",
  HKEX: "HKEX:",
  NSE: "NSE:",
  BSE: "BSE:",
  SG: "SGX:",
  ASX: "ASX:",
  XETRA: "XETRA:",
  PA: "EPA:",
  MI: "BIT:",
  SHG: "SHG:",
  SHE: "SHE:",
};

/** Convert EODHD ticker (VWRA.LSE) → Finnhub ticker (LSE:VWRA). */
function toFinnhubSymbol(raw: string): string {
  if (!raw.includes(".")) return raw;
  const dot = raw.lastIndexOf(".");
  const base = raw.slice(0, dot);
  const exchange = raw.slice(dot + 1).toUpperCase();
  const prefix = EODHD_TO_FINNHUB[exchange] ?? "";
  return `${prefix}${base}`;
}

/** Extract the base ticker without exchange suffix for keyword searches. */
function baseTicker(raw: string): string {
  if (!raw.includes(".")) return raw;
  return raw.slice(0, raw.lastIndexOf("."));
}

// ── Shared item type ─────────────────────────────────────────────────────────

interface NewsItem {
  t: string;
  src: string;
  sent: "pos" | "neg" | "neu";
  ago: string;
}

// ── Source 1: Finnhub ────────────────────────────────────────────────────────
// Best for: US equities. Partial coverage for LSE, TSE, HKEX, SGX etc.

async function fetchFinnhub(symbol: string, key: string): Promise<NewsItem[]> {
  const finnhubSymbol = toFinnhubSymbol(symbol);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(finnhubSymbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${key}`,
      { next: { revalidate: 900 } },
    );
    if (!res.ok) return [];
    const news = await res.json();
    if (!Array.isArray(news)) return [];
    console.log(`[news:finnhub] raw count for ${symbol} (as ${finnhubSymbol}): ${news.length}`);

    return news
      .slice(0, 5)
      .map((n: { headline?: string; source?: string; datetime?: number }) => ({
        t: String(n.headline ?? "").trim().slice(0, 120),
        src: String(n.source ?? "").split(" ").slice(0, 2).join(" "),
        sent: tag(String(n.headline ?? "")),
        ago: ago(Number(n.datetime ?? 0)),
      }))
      .filter((n) => n.t);
  } catch {
    return [];
  }
}

// ── Source 2: Alpha Vantage News ─────────────────────────────────────────────
// Best for: non-US equities (accepts EODHD-style tickers), crypto, gold.
// Free tier: 25 requests/day. Sign up at alphavantage.co/support/#api-key

async function fetchAlphaVantage(
  symbol: string,
  key: string,
): Promise<NewsItem[]> {
  // Strip exchange suffix (VWRA.LSE → VWRA, 7203.TSE → 7203)
  const ticker = baseTicker(symbol).toUpperCase();
  const exchange = symbol.includes(".")
    ? symbol.slice(symbol.lastIndexOf(".") + 1).toUpperCase()
    : "US";

  // Map to Alpha Vantage ticker format
  // Crypto: CRYPTO:BTC, Gold: FOREX:XAU, non-US equities: bare ticker (AV does keyword search)
  const isUS = !symbol.includes(".") || exchange === "US";
  const isCrypto =
    ticker === "BTC" ||
    ticker === "ETH" ||
    ticker === "SOL" ||
    ticker === "BNB" ||
    ticker === "XRP" ||
    ticker === "ADA";
  const isGold =
    ticker === "XAU" || ticker === "GOLD" || ticker === "GLD";

  const avTicker = isCrypto
    ? `CRYPTO:${ticker}`
    : isGold
      ? "FOREX:XAU"
      : isUS
        ? ticker
        : ticker; // non-US: AV accepts bare ticker and keyword-searches globally

  // For non-US equities, also pass the exchange as a topic hint via the
  // time_from param being omitted — AV returns broader results this way
  const params = new URLSearchParams({
    function: "NEWS_SENTIMENT",
    tickers: avTicker,
    limit: "5",
    apikey: key,
  });

  // For non-US equities, broaden the search with sort=RELEVANCE
  if (!isUS && !isCrypto && !isGold) {
    params.set("sort", "RELEVANCE");
  }

  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?${params.toString()}`,
      { next: { revalidate: 900 } },
    );
    if (!res.ok) {
      console.log(`[news:alphavantage] HTTP ${res.status} for ${symbol}`);
      return [];
    }
    const data = await res.json();

    // Alpha Vantage returns { feed: [...] }; if rate-limited it returns { Note: "..." }
    // If daily limit hit it returns { Information: "..." }
    if (!data?.feed || !Array.isArray(data.feed)) {
      console.log(`[news:alphavantage] no feed for ${symbol}:`, JSON.stringify(data).slice(0, 300));
      return [];
    }
    console.log(`[news:alphavantage] feed length for ${symbol}: ${data.feed.length}, first ticker_sentiment:`, JSON.stringify(data.feed[0]?.ticker_sentiment).slice(0, 200));

    return data.feed
      .slice(0, 5)
      .map(
        (n: {
          title?: string;
          source?: string;
          time_published?: string;
          overall_sentiment_label?: string;
        }) => {
          const headline = String(n.title ?? "").trim().slice(0, 120);
          // Alpha Vantage provides its own sentiment label — map it to our tags
          const avSent = String(n.overall_sentiment_label ?? "").toLowerCase();
          const sent: "pos" | "neg" | "neu" =
            avSent.includes("bullish")
              ? "pos"
              : avSent.includes("bearish")
                ? "neg"
                : tag(headline); // fallback to keyword check
          // time_published format: "20240115T143000"
          const ts = n.time_published
            ? Math.floor(
                new Date(
                  n.time_published.replace(
                    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,
                    "$1-$2-$3T$4:$5:$6Z",
                  ),
                ).getTime() / 1000,
              )
            : 0;
          return {
            t: headline,
            src: String(n.source ?? "Alpha Vantage")
              .split(" ")
              .slice(0, 2)
              .join(" "),
            sent,
            ago: ago(ts),
          };
        },
      )
      .filter((n: NewsItem) => n.t);
  } catch {
    return [];
  }
}

// ── Source 3: NewsAPI keyword search ─────────────────────────────────────────
// Free tier: 1000 req/day. Sign up at newsapi.org — no credit card needed.
// We search by company name keyword so it works for any global asset.
// Env var: NEWS_API_KEY

/** Build a NewsAPI search query from the company name + ticker.
 *  Uses the name when available (most specific), otherwise the bare ticker in quotes.
 *  Strips exchange suffixes and adds a financial context keyword to reduce noise. */
function buildNewsQuery(symbol: string, name?: string): string {
  const ticker = baseTicker(symbol).toUpperCase();

  if (name && name.trim().length > 0) {
    // Use the full company name in quotes for precision, e.g. "DBS Group Holdings"
    // Strip common generic suffixes that broaden results unhelpfully
    const cleanName = name
      .replace(/\b(Ltd|Limited|Corp|Corporation|Inc|Incorporated|Plc|ETF|Fund|UCITS|Trust)\b\.?/gi, "")
      .trim();
    return `"${cleanName}"`;
  }

  // Fallback: quoted ticker — at least avoids partial word matches
  return `"${ticker}"`;
}

async function fetchNewsApi(symbol: string, key: string, name?: string): Promise<NewsItem[]> {
  const query = buildNewsQuery(symbol, name);

  try {
    const params = new URLSearchParams({
      q: query,
      language: "en",
      sortBy: "publishedAt",
      pageSize: "5",
      apiKey: key,
    });

    const res = await fetch(
      `https://newsapi.org/v2/everything?${params.toString()}`,
      { next: { revalidate: 900 } },
    );

    if (!res.ok) {
      console.log(`[news:newsapi] HTTP ${res.status} for ${symbol}`);
      return [];
    }

    const data = await res.json();
    if (data.status !== "ok" || !Array.isArray(data.articles)) {
      console.log(`[news:newsapi] bad response for ${symbol}:`, JSON.stringify(data).slice(0, 200));
      return [];
    }

    console.log(`[news:newsapi] ${symbol} (query: "${query}") → ${data.articles.length} articles`);

    return data.articles
      .slice(0, 5)
      .map((n: { title?: string; source?: { name?: string }; publishedAt?: string }) => {
        const headline = String(n.title ?? "").trim().slice(0, 120);
        const ts = n.publishedAt
          ? Math.floor(new Date(n.publishedAt).getTime() / 1000)
          : 0;
        return {
          t: headline,
          src: String(n.source?.name ?? "NewsAPI").split(" ").slice(0, 2).join(" "),
          sent: tag(headline),
          ago: ago(ts),
        };
      })
      .filter((n: NewsItem) => n.t);
  } catch {
    return [];
  }
}

// ── Core per-symbol fetch (waterfall) ────────────────────────────────────────

const SYMBOL_RE = /^[A-Za-z0-9.\-:]{1,30}$/;

async function fetchNewsForSymbol(
  symbol: string,
  finnhubKey: string | undefined,
  alphaKey: string | undefined,
  newsApiKey: string | undefined,
  name?: string,
): Promise<NewsItem[] | "no-key"> {
  const hasAnyKey =
    (finnhubKey && !finnhubKey.startsWith("placeholder")) ||
    (alphaKey && !alphaKey.startsWith("placeholder")) ||
    (newsApiKey && !newsApiKey.startsWith("placeholder"));

  if (!hasAnyKey) return "no-key";

  // 1. Finnhub — best for US equities and some global exchanges
  if (finnhubKey && !finnhubKey.startsWith("placeholder")) {
    const items = await fetchFinnhub(symbol, finnhubKey);
    console.log(`[news:finnhub] ${symbol} → ${items.length} items`);
    if (items.length > 0) return items;
  } else {
    console.log(`[news:finnhub] skipped — no key`);
  }

  // 2. Alpha Vantage — non-US equities, crypto, gold
  if (alphaKey && !alphaKey.startsWith("placeholder")) {
    const items = await fetchAlphaVantage(symbol, alphaKey);
    console.log(`[news:alphavantage] ${symbol} → ${items.length} items`);
    if (items.length > 0) return items;
  } else {
    console.log(`[news:alphavantage] skipped — no ALPHA_VANTAGE_KEY in .env.local`);
  }

  // 3. NewsAPI — keyword search by company name, covers any global asset
  if (newsApiKey && !newsApiKey.startsWith("placeholder")) {
    const items = await fetchNewsApi(symbol, newsApiKey, name);
    console.log(`[news:newsapi] ${symbol} → ${items.length} items`);
    if (items.length > 0) return items;
  } else {
    console.log(`[news:newsapi] skipped — no NEWS_API_KEY in .env.local`);
  }

  return [];
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("news", 30, 60);
  if (limited) return limited;

  const { finnhub: enabled } = await getProviderFlags();
  if (!enabled) return Response.json([]);

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const alphaKey = process.env.ALPHA_VANTAGE_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;

  // ── Bulk mode: ?symbols=VWRA.LSE|Vanguard%20All-World,D05.SG|DBS%20Group ──
  // Each entry is "SYMBOL|encodedName". Returns: Array<{ symbol, items }>
  const symbolsParam = req.nextUrl.searchParams.get("symbols");
  if (symbolsParam) {
    const entries = symbolsParam
      .split(",")
      .map((entry) => {
        const [sym, encodedName] = entry.trim().split("|");
        return {
          symbol: sym?.trim() ?? "",
          name: encodedName ? decodeURIComponent(encodedName) : undefined,
        };
      })
      .filter((e) => SYMBOL_RE.test(e.symbol))
      .slice(0, 20);

    if (entries.length === 0)
      return Response.json({ error: "no valid symbols" }, { status: 400 });

    const hasAnyKey =
      (finnhubKey && !finnhubKey.startsWith("placeholder")) ||
      (alphaKey && !alphaKey.startsWith("placeholder")) ||
      (newsApiKey && !newsApiKey.startsWith("placeholder"));
    if (!hasAnyKey) return Response.json({ noKey: true }, { status: 200 });

    const results = await Promise.all(
      entries.map(async ({ symbol, name }) => {
        const items = await fetchNewsForSymbol(symbol, finnhubKey, alphaKey, newsApiKey, name);
        return { symbol, items: items === "no-key" ? [] : items };
      }),
    );

    return Response.json(results, {
      headers: { "Cache-Control": "public, s-maxage=900" },
    });
  }

  // ── Single mode: ?symbol=VWRA.LSE&name=Vanguard%20All-World ─────────────
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol)
    return Response.json({ error: "symbol required" }, { status: 400 });
  if (!SYMBOL_RE.test(symbol))
    return Response.json({ error: "invalid symbol format" }, { status: 400 });

  const name = req.nextUrl.searchParams.get("name") ?? undefined;

  try {
    const result = await fetchNewsForSymbol(symbol, finnhubKey, alphaKey, newsApiKey, name);
    if (result === "no-key")
      return Response.json({ noKey: true }, { status: 200 });

    console.log(`[news] ${symbol} → ${result.length} items`, result.map(i => i.src));
    return Response.json(result, {
      headers: { "Cache-Control": "public, s-maxage=900" },
    });
  } catch {
    return Response.json([]);
  }
}