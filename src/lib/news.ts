// Pure news relevance/scoring core. No network, no DB, no server-only imports —
// safe to import from client components (page.tsx reads PAGE_SIZE from here).

// ── Tunable constants ────────────────────────────────────────────────────────
export const RELEVANCE_FLOOR = 0.3; // drop items scoring below this
export const TTL_HOURS = 4;         // news_cache freshness window
export const MAX_ITEMS = 25;        // cached/returned items per symbol (5 pages of 5)
export const PAGE_SIZE = 5;         // headlines per page in the drawer

const W_TICKER = 0.6;      // weight of a ticker hit in textRelevance
const W_NAME = 0.4;        // weight of full name-token coverage
const TITLE_JACCARD = 0.8; // title-token overlap at/above which two items are near-dupes

// ── Types ────────────────────────────────────────────────────────────────────
export interface NewsItem {
  t: string;
  src: string;
  sent: "pos" | "neg" | "neu";
  ago: string;
  url: string;
}

export type Provider = "finnhub" | "alphavantage" | "newsapi";

export interface QueryTokens {
  ticker: string;
  nameTokens: string[];
}

// ── Sentiment + relative time ─────────────────────────────────────────────────
// Stems, matched as prefixes: a leading word boundary prevents mid-word hits
// (no trailing \b, so "plunge" matches "plunges", "warn" matches "warning", etc.).
const POS =
  /\b(surge|beat|record|gain|rise|profit|growth|upgrade|strong|soar|exceed|higher|boost|rally|outperform|rebound)/i;
const NEG =
  /\b(fall|miss|cut|loss|drop|plunge|downgrade|weak|decline|warn|disappoint|tumble|slide|concern|risk|below|slump)/i;

export function tag(headline: string): "pos" | "neg" | "neu" {
  // NEG before POS: a headline carrying both a negative and a positive word
  // (e.g. "plunges after profit warning") reads as negative. This differs from
  // the legacy route's POS-first order, which mis-tagged such headlines.
  return NEG.test(headline) ? "neg" : POS.test(headline) ? "pos" : "neu";
}

export function ago(unixSec: number, nowMs = Date.now()): string {
  const s = nowMs / 1000 - unixSec;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

// ── Symbol helpers ────────────────────────────────────────────────────────────
// EODHD exchange suffix → Finnhub exchange prefix. VERIFIED entries only.
// Do NOT add rows on confidence alone — confirm against Finnhub
// /stock/symbol?exchange=CODE first (see plan Task 1, Step 7). Unlisted → fail closed.
export const EODHD_TO_FINNHUB: Record<string, string> = {
  US: "", // US stocks use a bare ticker on Finnhub
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

export function baseTicker(raw: string): string {
  if (!raw.includes(".")) return raw;
  return raw.slice(0, raw.lastIndexOf("."));
}

export function toFinnhubSymbol(raw: string): string | null {
  if (!raw.includes(".")) return raw;
  const dot = raw.lastIndexOf(".");
  const base = raw.slice(0, dot);
  const exchange = raw.slice(dot + 1).toUpperCase();
  const prefix = EODHD_TO_FINNHUB[exchange];
  if (prefix === undefined) return null; // fail closed on unmapped exchange
  return `${prefix}${base}`;
}

// ── Relevance scoring ─────────────────────────────────────────────────────────
const NAME_SUFFIX_RE =
  /\b(Ltd|Limited|Corp|Corporation|Inc|Incorporated|Plc|ETF|Fund|UCITS|Trust|Holdings?|Group)\b\.?/gi;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractQueryTokens(symbol: string, name?: string): QueryTokens {
  const ticker = baseTicker(symbol).toUpperCase();
  const nameTokens = (name ?? "")
    .replace(NAME_SUFFIX_RE, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    // Keep tokens >=3 chars, but drop pure-numeric ones ("500", "100"): a bare
    // index number is too generic and matches unrelated figures in headlines
    // (e.g. "500" hitting "25,500 crore"). Distinctive tokens like "ftse" stay.
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  return { ticker, nameTokens };
}

export function textRelevance(text: string, tokens: QueryTokens): number {
  const hay = text.toLowerCase();
  const hit = (needle: string) =>
    new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(hay);
  const tickerHit = tokens.ticker.length > 0 && hit(tokens.ticker.toLowerCase());
  const nameHits = tokens.nameTokens.filter(hit).length;
  // Cap the denominator so multi-word fund names aren't over-penalized: matching
  // ~2 distinctive tokens counts as full name coverage. Without this, a 4-token
  // name like "Vanguard FTSE All-World" would need 3 hits in one headline to
  // clear the floor, so a broad ETF surfaces no news at all.
  const nameDenom = Math.min(tokens.nameTokens.length, 2);
  const nameCoverage = nameDenom > 0 ? Math.min(1, nameHits / nameDenom) : 0;
  const score = (tickerHit ? W_TICKER : 0) + W_NAME * nameCoverage;
  return Math.min(1, Math.max(0, score));
}

export function compositeRelevance(textMatch: number, providerRel?: number): number {
  return providerRel != null ? Math.max(providerRel, textMatch) : textMatch;
}

// ── NewsAPI query building ────────────────────────────────────────────────────
export function buildNewsQueries(symbol: string, name?: string): string[] {
  const ticker = baseTicker(symbol).toUpperCase();
  const queries: string[] = [];
  const fin = "stock OR shares OR earnings OR investor";

  if (name && name.trim().length > 0) {
    const isEtf = /\bETF\b|\bFund\b|\bUCITS\b/i.test(name);

    if (isEtf) {
      const family = name
        .replace(/\b(FTSE|UCITS|All-World|All World|Developed|Emerging|World|Global|Index)\b/gi, "")
        .replace(/\b(Ltd|Limited|Corp|Corporation|Inc|Incorporated|Plc|Trust|Holdings?|Group)\b\.?/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      const familyWords = family.split(/\s+/).filter(Boolean);
      if (familyWords.length >= 1) queries.push(`"${familyWords[0]}" ETF`);
      queries.push(`"${ticker}" ETF`);
    } else {
      const stripped = name
        .replace(/\b(Ltd|Limited|Corp|Corporation|Inc|Incorporated|Plc|ETF|Fund|UCITS|Trust|Holdings?|Group)\b\.?/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      const words = stripped.split(/\s+/).filter(Boolean);
      if (words.length >= 2) queries.push(`"${words.slice(0, 3).join(" ")}" ${fin}`);
      if (words.length === 1 || ticker.length <= 4) {
        const term = words.length >= 1 ? words[0] : ticker;
        queries.push(`"${term}" ${fin}`);
      }
      queries.push(`"${ticker}" ${fin}`);
    }
  } else {
    queries.push(`"${ticker}" ${fin}`);
    queries.push(`"${ticker}"`);
  }

  return queries;
}

// ── Merge pipeline types ──────────────────────────────────────────────────────
export interface RawItem {
  t: string;
  src: string;
  sent: "pos" | "neg" | "neu";
  ago: string;
  url: string;
  ts: number;
  summary: string;
  provider: Provider;
  providerRel?: number;
}

export type Scored = RawItem & { rel: number };

// ── Dedup helpers ─────────────────────────────────────────────────────────────
export function normalizeUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return (u.host + u.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase();
  }
}

export function titleTokens(title: string): string[] {
  return title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

export function dedupe(items: Scored[]): Scored[] {
  const out: Scored[] = [];
  for (const it of items) {
    const urlKey = normalizeUrl(it.url);
    const idx = out.findIndex(
      (o) =>
        (urlKey.length > 0 && normalizeUrl(o.url) === urlKey) ||
        jaccard(titleTokens(o.t), titleTokens(it.t)) >= TITLE_JACCARD,
    );
    if (idx === -1) {
      out.push(it);
      continue;
    }
    const better =
      it.rel > out[idx].rel || (it.rel === out[idx].rel && it.ts > out[idx].ts);
    if (better) out[idx] = it;
  }
  return out;
}

// ── Provider normalizers (parsed JSON → RawItem[]) ────────────────────────────
export function normalizeFinnhub(news: unknown, nowMs = Date.now()): RawItem[] {
  if (!Array.isArray(news)) return [];
  return news
    .slice(0, 50)
    .map(
      (n: {
        headline?: string;
        summary?: string;
        source?: string;
        url?: string;
        datetime?: number;
      }): RawItem => {
        const headline = String(n.headline ?? "").trim();
        const summary = String(n.summary ?? "").trim();
        const ts = Number(n.datetime ?? 0);
        return {
          t: headline.slice(0, 120),
          src: String(n.source ?? "").split(" ").slice(0, 2).join(" "),
          sent: tag(headline),
          ago: ago(ts, nowMs),
          url: String(n.url ?? ""),
          ts,
          summary: `${headline} ${summary}`,
          provider: "finnhub",
        };
      },
    )
    .filter((n) => n.t);
}

export function normalizeAlphaVantage(
  feed: unknown,
  tickerUpper: string,
  nowMs = Date.now(),
): RawItem[] {
  if (!Array.isArray(feed)) return [];
  return feed
    .slice(0, 50)
    .map(
      (n: {
        title?: string;
        summary?: string;
        source?: string;
        url?: string;
        time_published?: string;
        overall_sentiment_label?: string;
        ticker_sentiment?: Array<{ ticker?: string; relevance_score?: string }>;
      }): RawItem => {
        const headline = String(n.title ?? "").trim();
        const summary = String(n.summary ?? "").trim();
        const avSent = String(n.overall_sentiment_label ?? "").toLowerCase();
        const sent: "pos" | "neg" | "neu" = avSent.includes("bullish")
          ? "pos"
          : avSent.includes("bearish")
            ? "neg"
            : tag(headline);
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
        const rels = (n.ticker_sentiment ?? [])
          .filter((s) => String(s.ticker ?? "").toUpperCase() === tickerUpper)
          .map((s) => parseFloat(String(s.relevance_score ?? "")))
          .filter((v) => !Number.isNaN(v));
        return {
          t: headline.slice(0, 120),
          src: String(n.source ?? "Alpha Vantage").split(" ").slice(0, 2).join(" "),
          sent,
          ago: ago(ts, nowMs),
          url: String(n.url ?? ""),
          ts,
          summary: `${headline} ${summary}`,
          provider: "alphavantage",
          providerRel: rels.length ? Math.max(...rels) : undefined,
        };
      },
    )
    .filter((n) => n.t);
}

export function normalizeNewsApi(articles: unknown, nowMs = Date.now()): RawItem[] {
  if (!Array.isArray(articles)) return [];
  return articles
    .slice(0, 20)
    .map(
      (n: {
        title?: string;
        description?: string;
        source?: { name?: string };
        url?: string;
        publishedAt?: string;
      }): RawItem => {
        const headline = String(n.title ?? "").trim();
        const description = String(n.description ?? "").trim();
        const ts = n.publishedAt
          ? Math.floor(new Date(n.publishedAt).getTime() / 1000)
          : 0;
        return {
          t: headline.slice(0, 120),
          src: String(n.source?.name ?? "NewsAPI").split(" ").slice(0, 2).join(" "),
          sent: tag(headline),
          ago: ago(ts, nowMs),
          url: String(n.url ?? ""),
          ts,
          summary: `${headline} ${description}`,
          provider: "newsapi",
        };
      },
    )
    .filter((n) => n.t);
}

// ── Merge + rank + precision filter + cap ─────────────────────────────────────
export function mergeAndRank(
  raw: RawItem[],
  symbol: string,
  name: string | undefined,
): NewsItem[] {
  const tokens = extractQueryTokens(symbol, name);
  const scored: Scored[] = raw.map((it) => ({
    ...it,
    rel: compositeRelevance(textRelevance(it.summary, tokens), it.providerRel),
  }));
  return dedupe(scored)
    .filter((it) => it.rel >= RELEVANCE_FLOOR)
    .sort((a, b) => b.rel - a.rel || b.ts - a.ts)
    .slice(0, MAX_ITEMS)
    .map(({ t, src, sent, ago, url }) => ({ t, src, sent, ago, url }));
}
