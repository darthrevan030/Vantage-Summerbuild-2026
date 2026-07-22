import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TTL_HOURS,
  toFinnhubSymbol,
  baseTicker,
  buildNewsQueries,
  normalizeFinnhub,
  normalizeAlphaVantage,
  normalizeNewsApi,
  mergeAndRank,
  type NewsItem,
  type RawItem,
} from "@/lib/news";

const SYMBOL_RE = /^[A-Za-z0-9.\-:]{1,30}$/;

// Reputable finance/business domains — keeps NewsAPI from matching travel/sports
// articles on a company name.
const FINANCE_DOMAINS = [
  "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com",
  "marketwatch.com", "seekingalpha.com", "investopedia.com", "fool.com",
  "businessinsider.com", "forbes.com", "finance.yahoo.com", "livemint.com",
  "economictimes.indiatimes.com", "thehindubusinessline.com", "thestreet.com",
  "barrons.com", "morningstar.com", "financialpost.com", "theedgemalaysia.com",
  "businesstimes.com.sg", "nikkei.com", "scmp.com", "investing.com", "benzinga.com",
].join(",");

// ── Providers (I/O only; parsing/scoring live in @/lib/news) ──────────────────
async function fetchFinnhub(symbol: string, key: string): Promise<RawItem[]> {
  const fh = toFinnhubSymbol(symbol);
  if (fh === null) return []; // fail closed on unmapped exchange
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(fh)}&from=${fmt(from)}&to=${fmt(to)}&token=${key}`,
      { next: { revalidate: 900 } },
    );
    if (!res.ok) return [];
    return normalizeFinnhub(await res.json());
  } catch {
    return [];
  }
}

async function fetchAlphaVantage(symbol: string, key: string): Promise<RawItem[]> {
  const ticker = baseTicker(symbol).toUpperCase();
  const exchange = symbol.includes(".")
    ? symbol.slice(symbol.lastIndexOf(".") + 1).toUpperCase()
    : "US";
  const isUS = !symbol.includes(".") || exchange === "US";
  const isCrypto = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA"].includes(ticker);
  const isGold = ["XAU", "GOLD", "GLD"].includes(ticker);
  const avTicker = isCrypto ? `CRYPTO:${ticker}` : isGold ? "FOREX:XAU" : ticker;
  const params = new URLSearchParams({
    function: "NEWS_SENTIMENT",
    tickers: avTicker,
    limit: "50",
    apikey: key,
  });
  if (!isUS && !isCrypto && !isGold) params.set("sort", "RELEVANCE");
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?${params.toString()}`,
      { next: { revalidate: 900 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return normalizeAlphaVantage(data?.feed, ticker);
  } catch {
    return [];
  }
}

async function fetchNewsApi(symbol: string, key: string, name?: string): Promise<RawItem[]> {
  for (const query of buildNewsQueries(symbol, name)) {
    try {
      const params = new URLSearchParams({
        q: query,
        language: "en",
        sortBy: "publishedAt",
        pageSize: "20",
        domains: FINANCE_DOMAINS,
        apiKey: key,
      });
      const res = await fetch(
        `https://newsapi.org/v2/everything?${params.toString()}`,
        { next: { revalidate: 900 } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status !== "ok" || !Array.isArray(data.articles) || data.articles.length === 0) {
        continue;
      }
      return normalizeNewsApi(data.articles);
    } catch {
      continue;
    }
  }
  return [];
}

// ── Cache (best-effort; shared news_cache) ────────────────────────────────────
type Admin = ReturnType<typeof createAdminClient>;

async function readFreshCache(admin: Admin, symbol: string): Promise<NewsItem[] | null> {
  const { data, error } = await admin
    .from("news_cache")
    .select("items, refreshed_at")
    .eq("symbol", symbol)
    .maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - new Date(data.refreshed_at as string).getTime();
  if (age >= TTL_HOURS * 3600_000) return null;
  return (data.items as NewsItem[]) ?? null;
}

async function writeCache(admin: Admin, symbol: string, items: NewsItem[]): Promise<void> {
  await admin
    .from("news_cache")
    .upsert({ symbol, items, refreshed_at: new Date().toISOString() }, { onConflict: "symbol" });
}

// ── Key resolution ────────────────────────────────────────────────────────────
interface Keys {
  finnhub?: string;
  alpha?: string;
  newsApi?: string;
  finnhubEnabled: boolean;
}

function clean(k: string | undefined): string | undefined {
  return k && !k.startsWith("placeholder") ? k : undefined;
}

function hasAnyKey(keys: Keys): boolean {
  return Boolean((keys.finnhub && keys.finnhubEnabled) || keys.alpha || keys.newsApi);
}

// ── Per-symbol orchestration ──────────────────────────────────────────────────
async function newsForSymbol(
  symbol: string,
  name: string | undefined,
  keys: Keys,
): Promise<NewsItem[]> {
  let admin: Admin | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null; // no service-role key configured — run without cache
  }

  if (admin) {
    try {
      const cached = await readFreshCache(admin, symbol);
      if (cached) return cached;
    } catch {
      // ignore cache-read failures; fall through to a live fetch
    }
  }

  const tasks: Promise<RawItem[]>[] = [];
  if (keys.finnhubEnabled && keys.finnhub) tasks.push(fetchFinnhub(symbol, keys.finnhub));
  if (keys.alpha) tasks.push(fetchAlphaVantage(symbol, keys.alpha));
  if (keys.newsApi) tasks.push(fetchNewsApi(symbol, keys.newsApi, name));

  const settled = await Promise.allSettled(tasks);
  const raw: RawItem[] = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const items = mergeAndRank(raw, symbol, name);

  if (admin) {
    try {
      await writeCache(admin, symbol, items);
    } catch {
      // ignore cache-write failures
    }
  }
  return items;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("news", 30, 60);
  if (limited) return limited;

  const { finnhub: finnhubEnabled, alphavantage: alphaEnabled, newsapi: newsApiEnabled } =
    await getProviderFlags();
  const keys: Keys = {
    finnhub: clean(process.env.FINNHUB_API_KEY),
    // Accept either env name — ALPHA_VANTAGE_KEY (route convention) or
    // ALPHAVANTAGE_API_KEY (matches the *_API_KEY pattern of the other providers).
    alpha: alphaEnabled
      ? clean(process.env.ALPHA_VANTAGE_KEY ?? process.env.ALPHAVANTAGE_API_KEY)
      : undefined,
    newsApi: newsApiEnabled ? clean(process.env.NEWS_API_KEY) : undefined,
    finnhubEnabled,
  };

  // ── Bulk mode: ?symbols=VWRA.LSE|Vanguard%20All-World,D05.SG|DBS%20Group ──
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
    if (!hasAnyKey(keys)) return Response.json({ noKey: true }, { status: 200 });

    const results = await Promise.all(
      entries.map(async ({ symbol, name }) => ({
        symbol,
        items: await newsForSymbol(symbol, name, keys),
      })),
    );
    return Response.json(results, {
      headers: { "Cache-Control": "public, s-maxage=900" },
    });
  }

  // ── Single mode: ?symbol=VWRA.LSE&name=Vanguard%20All-World ──
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });
  if (!SYMBOL_RE.test(symbol))
    return Response.json({ error: "invalid symbol format" }, { status: 400 });

  const name = req.nextUrl.searchParams.get("name") ?? undefined;
  if (!hasAnyKey(keys)) return Response.json({ noKey: true }, { status: 200 });

  try {
    const items = await newsForSymbol(symbol, name, keys);
    return Response.json(items, {
      headers: { "Cache-Control": "public, s-maxage=900" },
    });
  } catch {
    return Response.json([]);
  }
}
