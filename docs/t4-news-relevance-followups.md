# T4 — News relevance: follow-up backlog

_Split out of the T4 (News relevance) design on 2026-07-22. These are the adjacent
features deliberately left **out of scope** for T4 so it stays "make news relevant" rather
than growing into several different features at once. Each `##` block is issue-ready — copy it
into a GitHub issue as-is; the title doubles as the issue title and the **metadata line**
(Priority · Effort · Depends on · Type) maps to labels. Provisional `NF*` (News Follow-up) IDs;
assign real IDs when folding into `docs/feature-backlog-scoping.md`._

**Legend** (same as the master backlog). Priority: `P0` correctness spine · `P1` high value ·
`P2` important · `P3` later. Effort: `S` (days) · `M` (~1–2 wk) · `L` (multi-week).
Type: `gap` = existing logic missing/flawed · `enhancement` = net-new capability.

---

## NF1 — News sentiment classification quality

**Priority:** P2 · **Effort:** S–M · **Depends on:** T4 (relates to T5) · **Type:** enhancement, gap

**Goal.** Make the pos/neg/neu tag on each headline actually correct, rather than a coarse guess.

**Current state / gap.** Sentiment in `src/app/api/news/route.ts` is a keyword regex (`POS`/`NEG` word
lists) plus, for Alpha Vantage items, that provider's own bullish/bearish label. The regex misses
negation ("not a miss"), sarcasm, and any headline whose sentiment isn't carried by one of the
hardcoded trigger words; the three providers don't agree on a scale. T4 deliberately leaves this
untouched because T4's goal is *relevance* (are these the right articles?), not *sentiment accuracy*.

**What's needed.**

- A single sentiment scale across providers (map AV's numeric `ticker_sentiment_score` and any
  Finnhub/NewsAPI signal onto one range instead of two disjoint code paths).
- Consider a lightweight model call (reuse the Anthropic path) or a better lexicon (VADER-style with
  negation handling) for headlines with no provider label.
- Confidence/neutral band so weak signals read as `neu` instead of being forced pos/neg.

**Open questions.** Model cost per headline vs. lexicon; whether sentiment even needs to be more than
a directional hint in the UI. Overlaps with T5 (analysis accuracy) — decide whether sentiment tagging
lives here or is subsumed by T5's grounding work.

---

## NF2 — Cross-symbol portfolio news feed

**Priority:** P2 · **Effort:** M · **Depends on:** T4 · **Type:** enhancement

**Goal.** One merged "what's happening across my portfolio" stream, ranked across all holdings — not
just the per-holding drawers.

**Current state / gap.** News is surfaced only per-symbol inside each `SentDrawer`
(`analysis/page.tsx`); there is no portfolio-wide feed. T4 fixes relevance *within* a symbol but adds
no new surface. A global feed needs a new aggregation shape (merge every holding's ranked items,
re-rank by relevance × position weight × recency, dedup across symbols) and a new UI section.

**What's needed.**

- An aggregation endpoint/mode that fans out over holdings (reuse T4's per-symbol pipeline + cache)
  and returns a single ranked, cross-symbol-deduped list.
- Position-weighting so news about large holdings ranks above tiny ones.
- A feed UI (Overview or Analysis tab) with per-item "which holding" attribution.

**Open questions.** Ranking weights (relevance vs. weight vs. recency); how many items; whether it
replaces or complements the per-drawer view.

---

## NF3 — User-facing "refresh news" (cache-bust)

**Priority:** P3 · **Effort:** S · **Depends on:** T4 · **Type:** enhancement

**Goal.** Let the user force-refresh a symbol's news, bypassing T4's 4-hour `news_cache` TTL.

**Current state / gap.** T4 caches merged results for 4h in `news_cache`; there's no way to bypass it
on demand. Acceptable for a portfolio dashboard, but a user watching a breaking story can't pull the
latest until the TTL lapses.

**What's needed.**

- A "refresh" affordance in the `SentDrawer` header.
- A cache-bust path (`?refresh=1`) that re-sweeps providers and upserts `news_cache` (service-role
  write), rate-limited separately so it can't be spammed.

**Open questions.** Rate-limit budget for forced refreshes; whether to bust one symbol or all.

---

## NF4 — Additional news providers

**Priority:** P3 · **Effort:** S–M · **Depends on:** T4 (relates to RE1) · **Type:** enhancement

**Goal.** Broaden coverage with a 4th/5th source for assets the current three cover poorly
(some SG/Asia listings, thinly-covered ETFs).

**Current state / gap.** T4 makes the **existing** Finnhub → Alpha Vantage → NewsAPI set relevant and
merged, but doesn't expand the provider set. Coverage gaps remain for some non-US instruments. T4
excludes this because more providers = more keys, normalization, and cost without addressing the
relevance gap it targets.

**What's needed.**

- Evaluate candidates (e.g. Marketaux, GDELT, EODHD news) against the instruments users actually hold.
- A provider adapter conforming to T4's normalize → `ScoredItem` contract, slotting into the existing
  merge/rank/dedup + `news_cache` flow.
- Provider on/off flag via `app_config` (mirrors the existing `getProviderFlags()`).

**Open questions.** Which provider closes the biggest real gap; cost per call; pairs with RE1
(provider fallback + circuit breakers) so a dead provider is skipped.

---

## NF5 — Relevance / freshness tuning controls

**Priority:** P3 · **Effort:** S · **Depends on:** T4 · **Type:** enhancement

**Goal.** Surface T4's relevance floor and cache TTL as adjustable settings instead of code constants.

**Current state / gap.** T4 ships the relevance floor (`0.3`) and cache TTL (`4h`) as hardcoded
constants, tuned from feedback. There is no UI or per-user override. This is intentional — premature
configuration for a feature with no demonstrated need to tune per-user.

**What's needed.**

- Only if feedback shows one global default doesn't fit: expose floor/TTL (admin config via
  `app_config`, or per-user on `user_settings` + column grant).
- A sensible range + explanation so tuning doesn't silently empty the feed.

**Open questions.** Global (admin) vs. per-user; whether anyone actually needs to tune these before
committing UI to it.
