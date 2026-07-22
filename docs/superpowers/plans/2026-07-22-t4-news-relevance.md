# T4 — News Relevance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the news shown in each holding's sentiment drawer actually relevant — merge all providers, rank by relevance, dedup, fail closed on unmapped exchanges — and let users page through the full relevant set 5-at-a-time.

**Architecture:** All parsing/scoring/ranking logic moves into a new pure module `src/lib/news.ts` (unit-tested with vitest); `src/app/api/news/route.ts` becomes a thin I/O shell that fetches providers in parallel, reads/writes a shared `news_cache` table (4h TTL, service-role write via `createAdminClient()`), and delegates merge/rank to the pure module. The analysis page renders headlines as links and paginates client-side over the already-returned list.

**Tech Stack:** TypeScript strict, Next.js 16 App Router route handler, Supabase (Postgres + RLS), Vitest (already configured — `npm test`).

## Global Constraints

- TypeScript strict — `npx tsc --noEmit` must be clean repo-wide after each task.
- `npm run lint` must be clean after each task (no `any` where a field-picked type works; match existing code style).
- Pure logic lives in `src/lib/news.ts` and is covered by `src/lib/news.test.ts` (`npm test`). The route handler and React component are I/O/UI and are NOT unit-tested — they are gated by `tsc` + `lint` + a manual in-app smoke test.
- **Preserve the existing HTTP contract** consumed by `src/app/(dashboard)/analysis/page.tsx`:
  - Single mode `GET /api/news?symbol=…&name=…` → `NewsItem[]`, or `{ noKey: true }`, or `[]` on error.
  - Bulk mode `GET /api/news?symbols=SYM|encName,SYM2|encName2` → `Array<{ symbol: string; items: NewsItem[] }>`, or `{ noKey: true }`.
  - Keep `SYMBOL_RE`, the ≤20-symbol bulk cap, the `sym|encodedName` entry parsing, rate limit `enforceRateLimit("news", 30, 60)`, and `Cache-Control: public, s-maxage=900`.
- `src/lib/news.ts` MUST be import-safe from a client component (no server-only imports) — `page.tsx` imports `PAGE_SIZE` from it. It may import nothing but standard TS/JS.
- **Commits: Conventional Commits, no co-author/trailer line. Commit code, tests, and the migration ONLY.** Do NOT `git add` the spec or plan docs under `docs/superpowers/**` (they stay untracked, matching the repo's other design docs).
- **Finnhub exchange map: verify before filling.** Port the existing `EODHD_TO_FINNHUB` entries verbatim and change only the *fallback* to fail-closed. Do NOT add new exchange entries on confidence alone — any addition must first be verified against Finnhub's `/stock/symbol?exchange=CODE` output (see Task 1, Step 7). Unverified/absent exchange → `toFinnhubSymbol` returns `null` → Finnhub is skipped for that symbol.

**Reference spec:** `docs/superpowers/specs/2026-07-22-t4-news-relevance-design.md`.

---

### Task 1: Relevance & symbol core (`src/lib/news.ts`, TDD)

The pure scoring/tokenization/symbol/query helpers. No network, no DB.

**Files:**
- Create: `src/lib/news.ts`
- Create: `src/lib/news.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (relied on by Task 2 and the route):
  - `RELEVANCE_FLOOR = 0.3`, `TTL_HOURS = 4`, `MAX_ITEMS = 25`, `PAGE_SIZE = 5` (exported consts)
  - `interface NewsItem { t: string; src: string; sent: "pos"|"neg"|"neu"; ago: string; url: string }`
  - `type Provider = "finnhub" | "alphavantage" | "newsapi"`
  - `interface QueryTokens { ticker: string; nameTokens: string[] }`
  - `tag(headline: string): "pos"|"neg"|"neu"`
  - `ago(unixSec: number, nowMs?: number): string`
  - `baseTicker(raw: string): string`
  - `toFinnhubSymbol(raw: string): string | null`
  - `buildNewsQueries(symbol: string, name?: string): string[]`
  - `extractQueryTokens(symbol: string, name?: string): QueryTokens`
  - `textRelevance(text: string, tokens: QueryTokens): number`
  - `compositeRelevance(textMatch: number, providerRel?: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/news.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  tag,
  ago,
  baseTicker,
  toFinnhubSymbol,
  buildNewsQueries,
  extractQueryTokens,
  textRelevance,
  compositeRelevance,
} from "./news";

describe("tag", () => {
  it("detects positive / negative / neutral headlines", () => {
    expect(tag("Shares surge on record profit")).toBe("pos");
    expect(tag("Stock plunges after profit warning")).toBe("neg");
    expect(tag("Company holds annual meeting")).toBe("neu");
  });
});

describe("ago", () => {
  const now = 1_000_000_000_000; // fixed nowMs
  it("formats minutes, hours, days", () => {
    expect(ago(now / 1000 - 120, now)).toBe("2m");
    expect(ago(now / 1000 - 7200, now)).toBe("2h");
    expect(ago(now / 1000 - 2 * 86400, now)).toBe("2d");
  });
});

describe("baseTicker", () => {
  it("strips the exchange suffix", () => {
    expect(baseTicker("VWRA.LSE")).toBe("VWRA");
    expect(baseTicker("AAPL")).toBe("AAPL");
    expect(baseTicker("7203.TSE")).toBe("7203");
  });
});

describe("toFinnhubSymbol", () => {
  it("returns a bare US ticker unchanged", () => {
    expect(toFinnhubSymbol("AAPL")).toBe("AAPL");
  });
  it("maps a known exchange to the Finnhub prefix", () => {
    expect(toFinnhubSymbol("VWRA.LSE")).toBe("LSE:VWRA");
    expect(toFinnhubSymbol("AAPL.US")).toBe("AAPL");
  });
  it("fails closed (null) on an unmapped exchange", () => {
    expect(toFinnhubSymbol("XYZ.NOPE")).toBeNull();
  });
});

describe("extractQueryTokens", () => {
  it("uppercases the ticker and strips corporate suffixes from the name", () => {
    const t = extractQueryTokens("D05.SG", "DBS Group Holdings Ltd");
    expect(t.ticker).toBe("D05");
    expect(t.nameTokens).toContain("dbs");
    expect(t.nameTokens).not.toContain("group");
    expect(t.nameTokens).not.toContain("holdings");
    expect(t.nameTokens).not.toContain("ltd");
  });
  it("drops tokens shorter than 3 chars", () => {
    const t = extractQueryTokens("AA", "AB Co");
    expect(t.nameTokens).toEqual([]);
  });
});

describe("textRelevance", () => {
  const tokens = extractQueryTokens("D05.SG", "DBS Group");
  it("scores a ticker-only hit at W_TICKER (0.6)", () => {
    expect(textRelevance("D05 hits new high on SGX", tokens)).toBeCloseTo(0.6, 6);
  });
  it("scores full name coverage alone at W_NAME (0.4)", () => {
    expect(textRelevance("DBS reports strong quarter", tokens)).toBeCloseTo(0.4, 6);
  });
  it("scores ticker + full name at 1.0", () => {
    expect(textRelevance("DBS (D05) reports strong quarter", tokens)).toBeCloseTo(1.0, 6);
  });
  it("scores an off-topic headline at 0", () => {
    expect(textRelevance("Weather forecast for the weekend", tokens)).toBe(0);
  });
});

describe("compositeRelevance", () => {
  it("uses the max of provider score and text match when provider score is present", () => {
    expect(compositeRelevance(0.2, 0.9)).toBeCloseTo(0.9, 6);
    expect(compositeRelevance(0.8, 0.3)).toBeCloseTo(0.8, 6);
  });
  it("falls back to text match when provider score is absent", () => {
    expect(compositeRelevance(0.55)).toBeCloseTo(0.55, 6);
  });
});

describe("buildNewsQueries", () => {
  it("builds an ETF family query for fund names", () => {
    const q = buildNewsQueries("VWRA.LSE", "Vanguard FTSE All-World UCITS ETF");
    expect(q[0]).toBe('"Vanguard" ETF');
    expect(q).toContain('"VWRA" ETF');
  });
  it("builds a stripped-name + finance-context query for equities", () => {
    const q = buildNewsQueries("D05.SG", "DBS Group Holdings Ltd");
    expect(q[0]).toContain("DBS");
    expect(q[0]).toContain("stock OR shares OR earnings OR investor");
  });
  it("falls back to ticker-only when no name is given", () => {
    const q = buildNewsQueries("AAPL");
    expect(q[q.length - 1]).toBe('"AAPL"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/news.test.ts`
Expected: FAIL — `Failed to resolve import "./news"` / functions not defined.

- [ ] **Step 3: Implement the core in `src/lib/news.ts`**

Create `src/lib/news.ts`:
```ts
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
const POS =
  /\b(surge|beat|record|gain|rise|profit|growth|upgrade|strong|soar|exceed|higher|boost|rally|outperform|rebound)\b/i;
const NEG =
  /\b(fall|miss|cut|loss|drop|plunge|downgrade|weak|decline|warn|disappoint|tumble|slide|concern|risk|below|slump)\b/i;

export function tag(headline: string): "pos" | "neg" | "neu" {
  return POS.test(headline) ? "pos" : NEG.test(headline) ? "neg" : "neu";
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/news.test.ts`
Expected: PASS (all `describe` blocks green).

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/news.ts src/lib/news.test.ts
git commit -m "feat(news): add relevance scoring and symbol/query core"
```

- [ ] **Step 7 (optional, sourced — only if extending exchange coverage): verify then add mappings**

Do this ONLY to close a real coverage gap, and NEVER on confidence alone:
1. For the EODHD suffix in question (e.g. `TO`, `SW`, `AS`), call Finnhub
   `https://finnhub.io/api/v1/stock/symbol?exchange=<FINNHUB_CODE>&token=$FINNHUB_API_KEY`
   and confirm the exact prefix Finnhub uses for that market's symbols.
2. Add the confirmed `"<EODHD_SUFFIX>": "<FINNHUB_PREFIX>:"` row to `EODHD_TO_FINNHUB`.
3. Add a `toFinnhubSymbol` assertion for the new row to `news.test.ts`.
4. Re-run Steps 4–6. Anything you cannot confirm: leave it out (it fails closed).

---

### Task 2: Provider normalizers, dedup & merge (`src/lib/news.ts`, TDD)

Adds the parsing + merge pipeline to the same module. Pure: takes already-parsed provider JSON, returns ranked `NewsItem[]`.

**Files:**
- Modify: `src/lib/news.ts` (append)
- Modify: `src/lib/news.test.ts` (append)

**Interfaces:**
- Consumes: everything from Task 1 (`tag`, `ago`, `baseTicker`, `extractQueryTokens`, `textRelevance`, `compositeRelevance`, `MAX_ITEMS`, `RELEVANCE_FLOOR`).
- Produces (relied on by the route in Task 4):
  - `interface RawItem { t: string; src: string; sent: "pos"|"neg"|"neu"; ago: string; url: string; ts: number; summary: string; provider: Provider; providerRel?: number }`
  - `type Scored = RawItem & { rel: number }`
  - `normalizeUrl(url: string): string`
  - `titleTokens(title: string): string[]`
  - `jaccard(a: string[], b: string[]): number`
  - `dedupe(items: Scored[]): Scored[]`
  - `normalizeFinnhub(news: unknown, nowMs?: number): RawItem[]`
  - `normalizeAlphaVantage(feed: unknown, tickerUpper: string, nowMs?: number): RawItem[]`
  - `normalizeNewsApi(articles: unknown, nowMs?: number): RawItem[]`
  - `mergeAndRank(raw: RawItem[], symbol: string, name: string | undefined): NewsItem[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/news.test.ts`:
```ts
import {
  normalizeUrl,
  titleTokens,
  jaccard,
  dedupe,
  normalizeFinnhub,
  normalizeAlphaVantage,
  normalizeNewsApi,
  mergeAndRank,
  type Scored,
} from "./news";

function scored(overrides: Partial<Scored> = {}): Scored {
  return {
    t: "headline",
    src: "Reuters",
    sent: "neu",
    ago: "1h",
    url: "",
    ts: 1000,
    summary: "headline",
    provider: "finnhub",
    rel: 0.5,
    ...overrides,
  };
}

describe("normalizeUrl", () => {
  it("lowercases host+path, strips trailing slash and query", () => {
    expect(normalizeUrl("https://Reuters.com/Article/123?utm_source=x")).toBe(
      "reuters.com/article/123",
    );
    expect(normalizeUrl("https://reuters.com/article/123/")).toBe(
      "reuters.com/article/123",
    );
  });
  it("returns empty string for empty input", () => {
    expect(normalizeUrl("")).toBe("");
  });
});

describe("jaccard", () => {
  it("computes token overlap", () => {
    expect(jaccard(titleTokens("DBS profit rises"), titleTokens("DBS profit rises"))).toBe(1);
    expect(jaccard(titleTokens("a b c d"), titleTokens("a b c e"))).toBeCloseTo(3 / 5, 6);
  });
});

describe("dedupe", () => {
  it("collapses same-URL items, keeping the higher relevance", () => {
    const out = dedupe([
      scored({ url: "https://x.com/a?utm=1", rel: 0.4 }),
      scored({ url: "https://x.com/a", rel: 0.9 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rel).toBe(0.9);
  });
  it("collapses near-duplicate titles above the Jaccard threshold", () => {
    const out = dedupe([
      scored({ t: "DBS profit rises on strong quarter", ts: 1, rel: 0.5 }),
      scored({ t: "DBS profit rises on strong quarter", ts: 2, rel: 0.5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(2); // ties broken by recency
  });
});

describe("normalizeFinnhub", () => {
  it("maps raw Finnhub items into RawItem", () => {
    const out = normalizeFinnhub(
      [{ headline: "DBS beats estimates", summary: "strong", source: "Reuters News", url: "https://r.com/1", datetime: 900 }],
      1_000_000,
    );
    expect(out[0]).toMatchObject({ t: "DBS beats estimates", url: "https://r.com/1", provider: "finnhub" });
    expect(out[0].summary).toContain("strong");
  });
  it("returns [] for non-array input", () => {
    expect(normalizeAlphaVantage(undefined, "X")).toEqual([]);
    expect(normalizeNewsApi(null)).toEqual([]);
    expect(normalizeFinnhub(null)).toEqual([]);
  });
});

describe("normalizeAlphaVantage", () => {
  it("extracts providerRel for the matching ticker", () => {
    const out = normalizeAlphaVantage(
      [{
        title: "DBS update",
        summary: "s",
        source: "AV",
        url: "https://a.com/1",
        time_published: "20260115T143000",
        overall_sentiment_label: "Bullish",
        ticker_sentiment: [
          { ticker: "D05", relevance_score: "0.82" },
          { ticker: "OTHER", relevance_score: "0.99" },
        ],
      }],
      "D05",
    );
    expect(out[0].providerRel).toBeCloseTo(0.82, 6);
    expect(out[0].sent).toBe("pos");
  });
});

describe("mergeAndRank", () => {
  it("scores, filters below floor, ranks, and caps at MAX_ITEMS", () => {
    const raw = [
      { t: "DBS profit rises", src: "R", sent: "pos" as const, ago: "1h", url: "https://x/1", ts: 3, summary: "DBS profit rises", provider: "finnhub" as const },
      { t: "Totally unrelated weather", src: "R", sent: "neu" as const, ago: "2h", url: "https://x/2", ts: 2, summary: "Totally unrelated weather", provider: "finnhub" as const },
    ];
    const out = mergeAndRank(raw, "D05.SG", "DBS Group");
    expect(out.map((i) => i.t)).toEqual(["DBS profit rises"]); // weather dropped below floor
    expect(out[0]).not.toHaveProperty("rel"); // stripped to NewsItem
  });
  it("returns [] when nothing clears the floor", () => {
    const raw = [
      { t: "weather report", src: "R", sent: "neu" as const, ago: "1h", url: "", ts: 1, summary: "weather report", provider: "newsapi" as const },
    ];
    expect(mergeAndRank(raw, "D05.SG", "DBS Group")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/news.test.ts`
Expected: FAIL — new exports not defined.

- [ ] **Step 3: Implement the pipeline in `src/lib/news.ts`**

Append to `src/lib/news.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/news.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/news.ts src/lib/news.test.ts
git commit -m "feat(news): add provider normalizers, dedup, and merge-and-rank"
```

---

### Task 3: `news_cache` migration

Shared, admin-written cache mirroring the `fx_history` pattern.

**Files:**
- Create: `supabase/migrations/20260722000000_news_cache.sql` (use a timestamp later than the latest existing migration `20260721140000`; bump the day/seconds if that exact name is taken).

**Interfaces:**
- Produces: table `news_cache(symbol text PK, items jsonb, refreshed_at timestamptz)` with a `SELECT`-only RLS policy for `authenticated`. Consumed by the route in Task 4 via `createAdminClient()` (service role bypasses RLS for writes).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260722000000_news_cache.sql`:
```sql
-- Shared, admin-written cache of merged+ranked news per symbol.
-- Freshness (4h TTL) is enforced in app code (src/app/api/news/route.ts), not here.
-- Mirrors fx_history: readable by any authenticated user; writes only via the
-- service-role client (no INSERT/UPDATE policy is granted to authenticated).
CREATE TABLE IF NOT EXISTS news_cache (
  symbol       text PRIMARY KEY,
  items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz DEFAULT now()
);
ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "news_cache_read" ON news_cache
  FOR SELECT TO authenticated USING (true);
```

- [ ] **Step 2: Apply and verify**

If a Supabase instance is reachable, apply and confirm the table + policy exist:
- Local CLI: `supabase db push` (or `supabase migration up`), then in the SQL editor:
  `select * from news_cache limit 1;` (expect empty, no error) and confirm RLS is enabled
  (`select relrowsecurity from pg_class where relname = 'news_cache';` → `t`).
- Or via the Supabase MCP `apply_migration` tool with this SQL.

If no instance is reachable in this environment, the deliverable is the reviewed SQL file (it is
byte-for-byte parallel to `20260615120000_cache_fx_history.sql`); it will apply on the normal
migration run. Note this explicitly in the task hand-off so the reviewer knows it wasn't live-applied.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722000000_news_cache.sql
git commit -m "feat(news): add shared news_cache table"
```

---

### Task 4: Route rewrite — I/O shell (`src/app/api/news/route.ts`)

Thin shell: auth, rate-limit, key resolution, parallel provider fetch (raised caps), best-effort cache, delegate to `mergeAndRank`.

**Files:**
- Modify (full rewrite): `src/app/api/news/route.ts`

**Interfaces:**
- Consumes: `TTL_HOURS`, `toFinnhubSymbol`, `baseTicker`, `buildNewsQueries`, `normalizeFinnhub`, `normalizeAlphaVantage`, `normalizeNewsApi`, `mergeAndRank`, `NewsItem`, `RawItem` (all from `@/lib/news`); `createAdminClient` (`@/lib/supabase/admin`); `requireAuth`, `enforceRateLimit`, `getProviderFlags` (existing).
- Produces: the HTTP contract in Global Constraints (unchanged shape; `NewsItem` now carries `url`).

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `src/app/api/news/route.ts` with:
```ts
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
    alpha: alphaEnabled ? clean(process.env.ALPHA_VANTAGE_KEY) : undefined,
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
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Run the full test suite (nothing regressed)**

Run: `npm test`
Expected: PASS (news + all existing suites).

- [ ] **Step 4: Manual smoke test**

Start the dev server (`npm run dev`), sign in, open the Analysis tab, expand a few holdings' sentiment drawers, and confirm in the terminal/Network tab:
- A US ticker (e.g. `AAPL`) returns relevant headlines.
- A mapped foreign listing (e.g. `VWRA.LSE`) returns headlines (Finnhub symbol `LSE:VWRA`).
- A holding on an unmapped exchange returns results from AV/NewsAPI only (no Finnhub error, no wrong-company US news).
- With no API keys set (or all `placeholder`), the drawer shows the "No FINNHUB_API_KEY" state (`{ noKey: true }`).
- A second view within 4h serves from `news_cache` (no new provider calls in logs).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/news/route.ts
git commit -m "feat(news): merge and rank all providers with cached, fail-closed fetch"
```

---

### Task 5: UI — clickable headlines + client-side pagination (`analysis/page.tsx`)

**Files:**
- Modify: `src/app/(dashboard)/analysis/page.tsx`
  - `HlItem` type (around line 222)
  - `import` line for `PAGE_SIZE`
  - `SentDrawer` component (`page`/`setPage` state, reset in the `[id]` effect, paginated render block around lines 361-382)

**Interfaces:**
- Consumes: `PAGE_SIZE` and the extra `url` field on each item from `@/lib/news` / the route.
- Produces: no new exports (UI only).

- [ ] **Step 1: Add the import**

Add to the imports at the top of `src/app/(dashboard)/analysis/page.tsx`:
```ts
import { PAGE_SIZE } from "@/lib/news";
```

- [ ] **Step 2: Extend the `HlItem` type**

Change:
```ts
type HlItem = { t: string; src: string; sent: string; ago: string };
```
to:
```ts
type HlItem = { t: string; src: string; sent: string; ago: string; url?: string };
```

- [ ] **Step 3: Add pagination state and reset it on holding change**

In `SentDrawer`, add the state next to the existing `hl` state:
```ts
const [page, setPage] = useState(0);
```
Then, inside the existing `useEffect(() => { ... }, [id])`, add `setPage(0);` as the first statement of the effect body (so switching holdings starts on page 1). For example the effect becomes:
```ts
  useEffect(() => {
    setPage(0);
    if (HL_CACHE[id]) {
      setHl(HL_CACHE[id]);
      return;
    }
    // …unchanged…
```

- [ ] **Step 4: Replace the headline render block with a paginated window**

Replace this block (currently around lines 361-382):
```tsx
        {Array.isArray(hl) &&
          hl.map((h, i) => (
            <div
              className="flex gap-[11px] items-start py-[9px] border-t border-subtle first:border-t-0 first:pt-0.5"
              key={i}
            >
              <i
                className={
                  "w-[7px] h-[7px] rounded-full mt-[5px] flex-[0_0_auto] " +
                  (HL_DOT_CLS[h.sent] ?? "")
                }
              />
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="text-[12.5px] text-primary leading-[1.4] [text-wrap:pretty]">
                  {h.t}
                </div>
                <div className="text-[11px] text-muted font-mono tracking-[.02em]">
                  {h.src} · {h.ago}
                </div>
              </div>
            </div>
          ))}
```
with:
```tsx
        {Array.isArray(hl) &&
          (() => {
            const pageCount = Math.max(1, Math.ceil(hl.length / PAGE_SIZE));
            const start = page * PAGE_SIZE;
            const visible = hl.slice(start, start + PAGE_SIZE);
            return (
              <>
                {visible.map((h, i) => (
                  <div
                    className="flex gap-[11px] items-start py-[9px] border-t border-subtle first:border-t-0 first:pt-0.5"
                    key={start + i}
                  >
                    <i
                      className={
                        "w-[7px] h-[7px] rounded-full mt-[5px] flex-[0_0_auto] " +
                        (HL_DOT_CLS[h.sent] ?? "")
                      }
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="text-[12.5px] text-primary leading-[1.4] [text-wrap:pretty]">
                        {h.url ? (
                          <a
                            href={h.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {h.t}
                          </a>
                        ) : (
                          h.t
                        )}
                      </div>
                      <div className="text-[11px] text-muted font-mono tracking-[.02em]">
                        {h.src} · {h.ago}
                      </div>
                    </div>
                  </div>
                ))}
                {hl.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-[9px] border-t border-subtle">
                    <button
                      type="button"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      className="font-mono text-[11px] text-secondary disabled:opacity-40 hover:text-primary transition-colors"
                    >
                      ← prev
                    </button>
                    <span className="font-mono text-[11px] text-muted tracking-[.04em]">
                      page {page + 1} / {pageCount}
                    </span>
                    <button
                      type="button"
                      disabled={page >= pageCount - 1}
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      className="font-mono text-[11px] text-secondary disabled:opacity-40 hover:text-primary transition-colors"
                    >
                      next →
                    </button>
                  </div>
                )}
              </>
            );
          })()}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual UI smoke test**

`npm run dev`, open Analysis, expand a holding that returns >5 headlines:
- Exactly 5 rows show; a "page 1 / N" control appears; prev is disabled on page 1, next on the last page.
- Clicking a headline opens the source article in a new tab.
- Switching to another holding resets to page 1.
- A holding with ≤5 headlines shows no pager; the "No recent headlines" empty state still renders when there are none.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/analysis/page.tsx"
git commit -m "feat(news): clickable headlines and client-side pagination in the sentiment drawer"
```

---

## Self-Review

**Spec coverage** (each spec goal → task):
1. Merge + rank across providers → Task 2 (`mergeAndRank`) + Task 4 (parallel fetch).
2. Use AV `relevance_score`; post-fetch text check → Task 2 (`normalizeAlphaVantage` `providerRel`, `textRelevance`, `compositeRelevance`).
3. Dedup by URL + near-dup title → Task 2 (`normalizeUrl`, `jaccard`, `dedupe`).
4. Fix Finnhub mapping + fail closed → Task 1 (`toFinnhubSymbol` → `null`; verify-before-fill Step 7) + Task 4 (skip on `null`).
5. Clickable headlines → Task 5.
6. Full relevant set + 5/page pagination → Task 2 (`MAX_ITEMS` cap) + Task 4 (raised fetch caps) + Task 5 (client-side pager).
- `news_cache` table + 4h TTL → Task 3 + Task 4 (`readFreshCache`/`writeCache`).
- Contract preservation (`noKey`, `[]`, bulk shape) → Task 4.

**Type consistency:** `NewsItem`/`RawItem`/`Scored`/`Provider`/`QueryTokens` defined once in `news.ts`; the route imports them; `mergeAndRank` returns `NewsItem[]`; the cache stores/returns `NewsItem[]`; `HlItem` mirrors `NewsItem` fields (+ optional `url`) on the client. `PAGE_SIZE`/`MAX_ITEMS`/`TTL_HOURS`/`RELEVANCE_FLOOR` are single-sourced in `news.ts`. Provider fetchers return `RawItem[]`; `newsForSymbol` returns `NewsItem[]`.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only variable is the migration timestamp (a real filename convention, instruction given).
