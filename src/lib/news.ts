// Pure news relevance/scoring core. No network, no DB, no server-only imports —
// safe to import from client components (page.tsx reads PAGE_SIZE from here).

// ── Tunable constants ────────────────────────────────────────────────────────
export const RELEVANCE_FLOOR = 0.3; // drop items scoring below this
export const TTL_HOURS = 4;         // news_cache freshness window
export const MAX_ITEMS = 25;        // cached/returned items per symbol (5 pages of 5)
export const PAGE_SIZE = 5;         // headlines per page in the drawer

const W_TICKER = 0.6;      // weight of a ticker hit in textRelevance
const W_NAME = 0.4;        // weight of full name-token coverage
// (TITLE_JACCARD lives in Task 2, next to dedupe, so Task 1 has no unused const.)

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
    .filter((t) => t.length >= 3);
  return { ticker, nameTokens };
}

export function textRelevance(text: string, tokens: QueryTokens): number {
  const hay = text.toLowerCase();
  const hit = (needle: string) =>
    new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(hay);
  const tickerHit = tokens.ticker.length > 0 && hit(tokens.ticker.toLowerCase());
  const nameHits = tokens.nameTokens.filter(hit).length;
  const nameCoverage =
    tokens.nameTokens.length > 0 ? nameHits / tokens.nameTokens.length : 0;
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
