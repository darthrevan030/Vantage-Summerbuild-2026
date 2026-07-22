# T4 — News relevance: design

**Status:** approved for planning · **Date:** 2026-07-22 · **Backlog item:** T4 (P1, effort S–M, no deps, type: gap)

**Source of truth for scope:** `docs/feature-backlog-scoping.md` § "T4 — News relevance".
**Parked adjacent work:** `docs/t4-news-relevance-followups.md` (NF1–NF5).

## Problem

News shown in each holding's sentiment drawer is often irrelevant to that holding. All of it lives in
`src/app/api/news/route.ts`. Concretely:

- `fetchNewsForSymbol` waterfalls Finnhub → Alpha Vantage → NewsAPI and **returns the first provider
  that yields ≥1 item** — no merge, no ranking. A weak first result blocks better later ones.
- Alpha Vantage's per-ticker `relevance_score` (in `ticker_sentiment[]`) is **fetched, logged, then
  discarded**.
- There is **no post-fetch relevance check** that the ticker or company name actually appears in the
  headline/summary, so off-topic articles (e.g. "Singapore Airlines baggage policy") slip through.
- `EODHD_TO_FINNHUB` is incomplete; an unmapped exchange suffix falls back to a **bare ticker**
  (`?? ""`), risking a same-ticker *US* company's news being returned for a foreign listing.
- No **dedup** by URL or title.

## Goals

1. Merge results across all available providers and rank the combined pool by relevance.
2. Actually use Alpha Vantage's `relevance_score`; add a post-fetch text-relevance check for all
   providers.
3. Dedup across providers by URL and near-duplicate title.
4. Fix the Finnhub exchange mapping and **fail closed** on anything unmapped/unverified.
5. Surface each headline as a clickable link to the source article.
6. Keep the full relevant set (not just the top few) and let users page through it, 5 at a time,
   client-side, without changing the drawer's height.

**Non-goals (tracked as NF1–NF5 in the follow-ups doc):** sentiment-classification quality, a
cross-symbol portfolio feed, user-facing force-refresh, additional providers, tuning UI.

## Decisions (locked with the user)

| Decision | Choice | Rationale |
|---|---|---|
| Provider combination | **Merge-all + rank** | Best result quality; API cost/limits are a non-issue in prod. |
| Caching | **Shared `news_cache` table**, `symbol` PK, **4-hour TTL** | Freshness knob (not rate protection); mirrors `ticker_quotes`/`fx_history` shared-cache pattern. |
| Relevance strictness | **Precision over recall** | Hard-drop below a relevance floor; an honest empty state beats off-topic noise. |
| UI | **Clickable headlines** | We capture `url` for dedup anyway; small, natural win. |
| News depth | **Cache all above-floor items (cap 25); paginate 5/page, client-side** | Reuses news already fetched; a fixed 5-row window keeps drawer proportions stable; no paging API (YAGNI at this data volume). |
| Finnhub mappings | **Verify before filling; fail closed otherwise** | Only confirmed-correct entries added; unverified exchanges skip Finnhub rather than risk a wrong-company match. |
| Code structure | **Pure logic in `src/lib/news.ts` + `news.test.ts`; route is an I/O shell** | Matches the P0-spine pattern (returns/contributions/realized). |

## Architecture

```text
GET /api/news (route.ts — I/O shell)
  requireAuth → enforceRateLimit("news", 30, 60) → getProviderFlags()
  for each symbol (single or bulk ≤20):
    ├─ news_cache read (createAdminClient): fresh (< 4h)? → serve items
    └─ miss/stale:
         ├─ fetch applicable providers in PARALLEL (Promise.allSettled)
         │     Finnhub | Alpha Vantage | NewsAPI  → normalize each → ScoredItem[]
         ├─ src/lib/news.ts: score → dedup → rank → precision-filter → top 5
         └─ upsert news_cache (createAdminClient, service-role write)
  respond NewsItem[]  (or { noKey: true } / [] as today)
```

`src/lib/news.ts` holds **all pure logic** (no network, no DB): tokenization, relevance scoring,
dedup, rank+filter, `toFinnhubSymbol`, `baseTicker`, `buildNewsQueries`, `tag`, `ago`, and the
`EODHD_TO_FINNHUB` map. `route.ts` keeps only provider `fetch` calls, the cache read/write, and
request/response plumbing.

## Data model

### Response shape

`NewsItem` gains one field (`url`); internal processing carries more, stripped before caching/response.

```ts
export interface NewsItem {
  t: string;                       // headline (existing)
  src: string;                     // source label (existing)
  sent: "pos" | "neg" | "neu";     // sentiment tag (existing, unchanged classifier)
  ago: string;                     // relative time (existing)
  url: string;                     // NEW — article link; "" if the provider omits one
}

// internal only, never returned or cached:
interface ScoredItem extends NewsItem {
  ts: number;        // unix seconds, for recency ranking/tiebreak
  summary: string;   // headline + summary/description, for text relevance
  provider: "finnhub" | "alphavantage" | "newsapi";
  rel: number;       // composite relevance 0..1
}
```

The cached `items` and the API response are both `NewsItem[]` (with `url`, without `ts`/`rel`/etc.).

### `news_cache` migration

New file `supabase/migrations/<timestamp>_news_cache.sql` (timestamp after `20260721140000`). Mirrors
the `fx_history` shared-cache RLS exactly — readable by any authenticated user, writable only by the
service role (no insert/update policy granted to `authenticated`):

```sql
-- Shared, admin-written cache of merged+ranked news per symbol. 4h TTL enforced in app code.
CREATE TABLE IF NOT EXISTS news_cache (
  symbol       text PRIMARY KEY,
  items        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- NewsItem[] (ranked, precision-filtered)
  refreshed_at timestamptz DEFAULT now()
);
ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "news_cache_read" ON news_cache
  FOR SELECT TO authenticated USING (true);
```

Writes go through `createAdminClient()` (service role bypasses RLS), same as the price/FX caches.

## Pipeline (on cache miss)

1. **Select providers** for the symbol:
   - Finnhub — only if `toFinnhubSymbol()` yields a symbol (US bare ticker, or a *verified*-mapped
     exchange). Present-but-unmapped suffix → Finnhub **skipped**.
   - Alpha Vantage — if enabled + key present.
   - NewsAPI — if enabled + key present.
2. **Fetch in parallel** with `Promise.allSettled`; a failed/empty provider contributes nothing.
   Capture `url` and `summary`/`description` from every provider (all three return both). Per-provider
   fetch caps are raised (AV `limit`, NewsAPI `pageSize`, Finnhub slice) so the merged pool is large
   enough to fill several pages before dedup/ranking.
3. **Normalize** each provider's raw items into `ScoredItem[]`, carrying AV's per-ticker
   `relevance_score` where present.
4. **Score** each item's composite relevance (see below) — uniform 0..1 so cross-provider ranking is fair.
5. **Dedup**:
   - Exact: normalized URL (lowercase host+path, strip `utm_*` and query string).
   - Near: normalized-title token Jaccard ≥ 0.8.
   - On collision keep the higher `rel`, tiebreak on more recent `ts`.
6. **Rank** by `rel` desc, then `ts` desc.
7. **Precision-filter**: drop items with `rel < RELEVANCE_FLOOR` (const `0.3`, tunable). Keep all
   remaining items, ranked, capped at `MAX_ITEMS` (const `25` = 5 pages of 5). An empty result is
   valid and renders as the existing "No recent headlines" state.
8. **Cache + return**: upsert `news_cache` (even when a provider was exhausted/failed — we cache the
   merge of whatever succeeded), return the `NewsItem[]`.

## Relevance scoring (in `src/lib/news.ts`)

**Query tokens** = base ticker (uppercased) + name tokens derived from the passed-in `name`:
strip corporate/fund suffixes (`Ltd|Limited|Corp|Corporation|Inc|Incorporated|Plc|ETF|Fund|UCITS|Trust|Holdings?|Group`),
split on whitespace, keep tokens of length ≥ 3, lowercase.

- **`textMatch` ∈ [0,1]** — presence of query tokens in `headline + summary` (case-insensitive,
  word-boundary). Reference formula (weights are named constants, tunable):
  `textMatch = clamp((tickerHit ? W_TICKER : 0) + W_NAME * nameCoverage, 0, 1)` where
  `W_TICKER = 0.6`, `W_NAME = 0.4`, `tickerHit` is whether the base ticker appears, and
  `nameCoverage = matchedNameTokens / totalNameTokens` (0 when there are no name tokens). So a ticker
  hit alone scores 0.6; full name coverage alone scores 0.4; both → 1.0. The finance-only domain
  restriction NewsAPI already applies (`FINANCE_DOMAINS`) keeps common words from over-matching.
- **`providerRel`** — AV's `relevance_score` for the matching ticker (`max` across `ticker_sentiment[]`
  entries whose `ticker` equals our base ticker), when present; else `undefined`.
- **Composite** — `providerRel != null ? Math.max(providerRel, textMatch) : textMatch`. A strong
  provider signal stands alone; a strong text match can still rescue an unscored item.

`RELEVANCE_FLOOR = 0.3`, `TTL_HOURS = 4`, `MAX_ITEMS = 25`, and `PAGE_SIZE = 5` are named constants at
the top of `news.ts`.

## Finnhub exchange mapping (verify before filling)

- Every new `EODHD_TO_FINNHUB` entry must be **verified against Finnhub's documented symbol format**
  (their `/stock/symbol?exchange=…` output is the authoritative namespacing source) **before** being
  added — confidence alone is not sufficient. This is a per-exchange, sourced step in the plan.
- `toFinnhubSymbol(raw)` returns `string | null`:
  - No `.` suffix → return `raw` (US bare ticker, unchanged).
  - Suffix present and **verified-mapped** → return `${prefix}${base}`.
  - Suffix present and **unmapped** → return `null` → route excludes Finnhub for that symbol
    (fail closed; AV/NewsAPI still cover it).
- The map only ever grows with confirmed entries; the fail-closed default guarantees an unverified
  exchange never yields a wrong-company match.

## UI change (`src/app/(dashboard)/analysis/page.tsx`)

- `HlItem` type gains `url?: string`.
- In `SentDrawer`, when `h.url` is present, render the headline text inside
  `<a href={h.url} target="_blank" rel="noopener noreferrer">` (opens source in a new tab); otherwise
  render plain text as today. Sentiment dot / `src` · `ago` line unchanged.
- **Client-side pagination.** The drawer renders a fixed window of `PAGE_SIZE` (5) headlines to keep
  its height/proportions stable, paging over the full list already returned in the response — no extra
  request. Local `page` state; `visible = items.slice(page*5, page*5 + 5)`; a compact prev/next control
  showing "page X / Y", rendered only when `items.length > 5`. Reset `page → 0` inside the existing
  `useEffect` keyed on `id`, so switching holdings starts on page 1.
- No other consumer changes; `prefetchAllNews` / `HL_CACHE` already pass `items` through verbatim, so
  the longer list + `url` field flow without further edits.

## Testing

Runner: **vitest** (`npm test` → `vitest run`). New `src/lib/news.test.ts` covers the pure module:

- Token extraction: corporate-suffix stripping, min-length, ETF vs. equity vs. bare ticker.
- Text relevance: ticker hit, name-token hit, miss (score 0), partial coverage.
- Composite: provider score present vs. absent; `max` precedence; text-match rescue.
- Dedup: identical URL with differing query/`utm_*`; near-duplicate titles (Jaccard ≥ 0.8);
  keep-higher-`rel` / recency tiebreak.
- Rank + precision filter: ordering; all-below-floor → empty; `MAX_ITEMS` cap (a >25 list truncates to
  25, keeping the highest-ranked).
- `toFinnhubSymbol`: US bare ticker, verified-mapped suffix, unmapped suffix → `null`.
- `buildNewsQueries`: ETF family query, equity stripped-name query, short-name/ticker fallback.

The route shell and the client-side pagination stay I/O/UI-only (not unit-tested); verified via
`npx tsc --noEmit`, `npm run lint`, and a manual smoke test against a US ticker, a mapped foreign
listing (e.g. `VWRA.LSE`), an unmapped listing (Finnhub skipped), the no-key path, and paging through
a holding that returns >5 items (page control appears; height stays fixed).

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/<ts>_news_cache.sql` | **new** — shared cache table + read RLS |
| `src/lib/news.ts` | **new** — all pure logic + constants + `EODHD_TO_FINNHUB` |
| `src/lib/news.test.ts` | **new** — vitest coverage |
| `src/app/api/news/route.ts` | **rewrite as I/O shell** — parallel fetch (raised per-provider caps), cache r/w via `createAdminClient()`, call `news.ts` |
| `src/app/(dashboard)/analysis/page.tsx` | **modify** — `HlItem.url`, clickable headline, client-side 5/page pagination |

## Risks & mitigations

- **Over-filtering (precision floor too high) → empty drawers.** Floor is a single named constant,
  tunable from feedback; NF5 tracks exposing it if needed. Manual smoke test confirms real holdings
  still return items.
- **Title-Jaccard false-positive dedup** collapsing distinct stories. Threshold set high (0.8);
  URL dedup runs first and handles the common case.
- **Provider drift** (a provider stops returning `url`/`summary`). Normalizers default missing fields
  to `""`; `url:""` simply renders a non-clickable headline; missing `summary` only weakens that
  item's text score, it doesn't crash.
- **Larger payloads** — bulk mode now returns up to `MAX_ITEMS` (25) per symbol × ≤20 symbols. Items
  are short headline objects (~150 B each → ≲75 KB worst case), well within response limits; the
  `MAX_ITEMS` cap bounds it and pagination is purely client-side over that single payload.
- **Stale AGENTS.md** claims "no test runner is configured" — outdated; `vitest` is present. Not a
  code risk, but noted so the implementer doesn't skip tests.

## Open questions (defaulted, revisit from feedback)

- `RELEVANCE_FLOOR` exact value (default `0.3`).
- Title-similarity metric/threshold (default token Jaccard ≥ `0.8`).
