# Vantage — Product Backlog (GitHub-issue-ready)

_Last scoped 2026-07-06 against `main` (working tree byte-identical to `main` modulo CRLF).
Every `##` block below is one issue — copy the block into a GitHub issue as-is. The title line
doubles as the issue title; the **metadata line** (Priority · Effort · Depends on · Type) maps to
labels. Sorted by **priority (P0→P3)**, then **effort (S→M→L)** within each priority. Re-verify
file/line references before implementing — the code moves._

**Legend.** Type: `gap` = existing logic (business or other) found missing or flawed · `tech debt` = debt taken on from a deliberate design decision · `enhancement` = net-new capability.
Priority: `P0` correctness spine · `P1` high value, next · `P2` important · `P3` later / own track.
Effort: `S` (days) · `M` (~1–2 wk) · `L` (multi-week / own track).

**In-flight branches (context, not issues):** `feat/cpf-life-calculator`, `feat/pdf-parser-hardening`,
`feat/delete-all-holdings`, `fix/units-holdings-display-csv-import`, `feat/add-yahoo-fallback`,
`feat/show-total-units`, `fix/landing-page-portfolio-ui` — all incremental polish on the manual-entry
model; none touch the P0 spine.

**Decision on record (2026-07-06):** native per-broker API adapters (a previously-scoped "T3") were
**dropped** in favour of **T15** (read-only aggregation API). Rationale lives in T15.

---

## Verified baseline (facts the issues rely on)

- `lots` (`20260615100000_normalize_schema.sql`): `transaction_type` (`buy`/`sell`), `quantity`, `price`, `trade_date`, `fx_rate`, `fees`, `source` (`CPF`/`SRS`/`Cash`), `broker` (free text), `strategy`, `notes`.
- `instruments`: `symbol`, `exchange_code`, `asset_type`, `currency`, `par_value`, `coupon_rate`, `maturity_date`. `holding_overrides`: `dividend_yield` only.
- `cash_balances` (`20260615000000_sgx_features.sql`): `(user_id, currency, amount)` — a **current balance**, not a ledger. `cpf_balances`: point-in-time `oa/sa/ma/ra + as_at_date`.
- `portfolio_snapshots` (`20260608145412`): `(user_id, recorded_date, value_sgd, cost_sgd, fx_impact_sgd, fx_by_currency)`, `UNIQUE(user_id, recorded_date)`.
- `ticker_quotes` (current price + `spark_data` + `price_source` + `refreshed_at`), `ticker_dividends` (`symbol, yield_ttm, source`), `ticker_history`, `fx_history` (`currency, rates jsonb`) — all shared caches, service-role write.
- `consume_rate_limit(bucket, max, window_secs)` (`20260614120000`): per-user, per-bucket request **count** — not provider-cost aware. `audit_log`: append-only, admin actions only. `app_config`: per-provider feature flags.
- Compute layer: `portfolio.ts` (`computeHeroStats`, `computeAllocationBySource`, `computePortfolioAnalytics` → CAGR/Sharpe/vol/drawdown, `computeAssetGainSGD`/`computeFxGainSGD`), `group-holdings.ts` (`netAggregate`, `toNetPositions`, `bucketByPosition`), `prices.ts`, `fx.ts`, `backfill/route.ts`.
- Repo-wide **zero matches**: `benchmark`, split/corporate-action, `brokers`/`broker_connections`, `realized`/`realised`/`proceeds`, `xirr`, `twr`. No `vercel.json`; `pg_cron` only commented-out.

---

## Sorted index

| #    | Issue                                        | Pri | Effort | Depends on         | Type        |
| ---- | -------------------------------------------- | --- | ------ | ------------------ | ----------- |
| T6   | Realized P&L + cost-basis engine             | P0  | M–L   | — (keystone)      | gap         |
| T7   | Cash & contributions ledger                  | P0  | M      | —                 | debt, gap   |
| T8   | Correct returns: TWR + MWR/XIRR              | P0  | M      | T7                 | gap         |
| T10  | History correctness + scheduled snapshotting | P0  | M      | T11 (split-adjust) | gap, debt   |
| T4   | News relevance                               | P1  | S–M   | —                 | gap         |
| T5   | Analysis accuracy                            | P1  | S–M   | —                 | gap         |
| T9   | Benchmark comparison                         | P1  | S–M   | T8                 | enhancement |
| T12  | Dividend & coupon income as events           | P1  | M      | T7                 | gap, enh    |
| T13  | Broker as a first-class entity               | P1  | M      | —                 | debt, enh   |
| T14  | Generic CSV importer + dedup                 | P1  | M      | —                 | enh, gap    |
| AN4  | Concentration & diversification score        | P2  | S      | T6                 | enhancement |
| AC6  | Watchlist                                    | P2  | S      | —                 | enhancement |
| RE2  | Observability                                | P2  | S      | —                 | enhancement |
| T16  | Tax reporting                                | P2  | S–M   | T6, T12            | enhancement |
| T17  | Per-user provider-cost quota                 | P2  | S–M   | —                 | tech debt   |
| AN1  | Returns completeness                         | P2  | M      | T8, T12            | enhancement |
| IN1  | Income & yield dashboard                     | P2  | M      | T12, T6            | enhancement |
| AC1  | Fixed income, properly                       | P2  | M      | —                 | gap, enh    |
| UX1  | Onboarding + sample portfolio                | P2  | M      | —                 | enhancement |
| RE1  | Provider fallback + staleness                | P2  | M      | —                 | tech debt   |
| SE1  | Legal & privacy                              | P2  | M      | —                 | enhancement |
| T11  | Corporate actions                            | P2  | L      | —                 | gap         |
| T15  | Read-only broker aggregation API             | P2  | L      | T14                | enhancement |
| AL1  | Alerts & notifications engine                | P2  | L      | T10                | enhancement |
| PL4  | DCA / recurring-contribution tracking        | P3  | S      | T7                 | enhancement |
| UX3  | Trade journal                                | P3  | S      | —                 | enhancement |
| UX9  | Terminal affordances                         | P3  | S      | —                 | enhancement |
| SE3  | Surface audit log to users                   | P3  | S      | —                 | enhancement |
| SE4  | Dependency scanning + pen-test + CSP         | P3  | S      | —                 | enhancement |
| PL2  | Goals / net-worth targets                    | P3  | S–M   | —                 | enhancement |
| AI2  | Scheduled AI reports                         | P3  | S–M   | T10, AL1           | enhancement |
| AN2  | Attribution                                  | P3  | M      | T8                 | enhancement |
| AN3  | Risk metrics beyond Sharpe                   | P3  | M      | T9                 | enhancement |
| IN2  | US-tax extras                                | P3  | M      | T6, T16            | enhancement |
| AC2  | Funds / unit trusts / robos                  | P3  | M      | —                 | enhancement |
| AC5  | Private/illiquid assets → net worth         | P3  | M      | T7                 | enhancement |
| AC7  | Fundamentals & events                        | P3  | M      | —                 | enhancement |
| AC8  | Broker-specific parsers (last resort)        | P3  | M      | T14                | enhancement |
| PL1  | Target allocation + rebalancing              | P3  | M      | —                 | enhancement |
| UX2  | Multiple portfolios                          | P3  | M      | —                 | enhancement |
| UX4  | Search / filter / tagging                    | P3  | M      | —                 | enhancement |
| UX5  | Reporting & export                           | P3  | M      | T16                | enhancement |
| UX6  | Time-travel (as-of date)                     | P3  | M      | T10                | enhancement |
| UX7  | Dashboard customization                      | P3  | M      | —                 | enhancement |
| UX8  | Mobile / PWA                                 | P3  | M      | —                 | enhancement |
| UX10 | Accessibility + i18n                         | P3  | M      | —                 | enhancement |
| AI1  | Conversational analysis                      | P3  | M      | T5                 | enhancement |
| AI3  | Anomaly detection                            | P3  | M      | AL1                | enhancement |
| RE3  | Backup / restore                             | P3  | M      | —                 | enhancement |
| SE2  | MFA / 2FA                                    | P3  | M      | —                 | enhancement |
| GTM1 | SaaS tiering                                 | P3  | M      | T17                | enhancement |
| GTM2 | Billing                                      | P3  | M      | GTM1               | enhancement |
| GTM3 | Sharing / referrals                          | P3  | M      | —                 | enhancement |
| GTM4 | Landing / marketing                          | P3  | M      | T15                | enhancement |
| T1   | Retirement & SG tax planning                 | P3  | M–L   | (T7)               | enhancement |
| AC3  | Crypto depth                                 | P3  | L      | —                 | enhancement |
| AC4  | Options / derivatives                        | P3  | L      | —                 | enhancement |
| PL3  | Scenario & stress testing                    | P3  | L      | —                 | enhancement |
| T2   | Household / shared portfolio view            | P3  | L      | —                 | enh, gap    |

---

# P0 — Correctness spine

_Do these first; every number in the app depends on them. Suggested build order: T6 → T7 → T8, then T10 (the sell-netting fix in T10 can land even before its cron)._

## T6 — Realized P&L + cost-basis engine

**Priority:** P0 · **Effort:** M–L · **Depends on:** — (keystone) · **Type:** gap

**Goal.** When a holding is partially or fully sold, compute and persist the realized gain/loss, keep closed positions visible, and let the user choose a cost-basis method.

**Current state / gap.** `netAggregate` in `src/lib/group-holdings.ts` computes average buy price as `pxWeighted / buyUnits` (units-weighted mean of buy lots); sell lots only increment `sellUnits` — their stored sale `price` is read from the DB but never used for any gain. `toNetPositions` does `if (agg.netUnits <= 0) continue;`, so a fully-closed position is dropped from every view and total, and the realized profit is unrecoverable in the UI. Repo-wide search for `realized`/`realised`/`proceeds` returns zero matches. No cost-basis method selector exists — the blended average is hardcoded.

**What's needed.**

- Match sell lots against prior buys under a selectable method (FIFO / average / specific-lot). Per matched quantity: `realizedSGD = (sellPrice·sellFx − matchedBuyPrice·matchedBuyFx)·qty − allocatedFees`, decomposed asset-vs-FX like `computeAssetGainSGD`/`computeFxGainSGD`.
- Persist to a new `realized_lots` table (matched buy↔sell pairs, method, asset/fx components, realized date) written on sell commit — freezes the method at sale time so history is stable if the default later changes.
- `cost_basis_method` on `user_settings` (default `fifo`); add the column to the existing `GRANT UPDATE (...) TO authenticated` in `20260610025339_security_hardening.sql` or PostgREST writes fail with 42501.
- A "Closed positions" view (Holdings tab) showing exited positions with realized P&L, excluded from allocation/value totals but rolled into a realized-gains total.
- Overview hero split into realized vs. unrealized gain.

**Implementation sketch.** Matching logic in `group-holdings.ts` or a sibling `realized.ts`, over the buckets `bucketByPosition` already builds. On the sell path (`holdings/page.tsx` `mode === "sell"` → `POST /api/holdings` with `transaction_type: "sell"`), run matching and write `realized_lots`. One-off `/api/holdings/reconcile-realized` to backfill existing sell lots.

**Open questions.** SG has no CGT so this is display/record-keeping there, but US-taxed users need correct FIFO/spec-id; fee allocation on buy vs. sell side; whether spec-id needs UI in v1 or can wait behind FIFO/average.

---

## T7 — Cash & contributions ledger

**Priority:** P0 · **Effort:** M · **Depends on:** — · **Type:** tech debt, gap

**Goal.** Track deposits, withdrawals, and transfers so the app knows net capital contributed — the denominator every honest return needs — plus per-broker cash.

**Current state / gap.** `cash_balances` is `(user_id, currency, amount)` with `PRIMARY KEY (user_id, currency)` — one mutable balance per currency, no history, dates, source, or broker. You cannot answer "how much have I put in?" or "what was my cash on date X?". `portfolio_snapshots.cost_sgd` ≠ money deposited (a reinvested dividend raises cost without a deposit). No transfer concept.

**What's needed.**

- A `cash_transactions` ledger: `(id, user_id, date, type ['deposit'|'withdrawal'|'transfer'|'fee'|'dividend_cash'|'buy'|'sell'], currency, amount, broker, source, note)`; derive/maintain `cash_balances` from it (or keep it as a materialized running total).
- `netContributions(userId, asOf?)` → SGD sum of deposits − withdrawals using per-transaction FX (consistent with `lots.fx_rate`).
- Per-broker cash surfaced in the T13 per-broker view.
- Optional: buy/sell lots debit/credit cash so ledgers reconcile — behind a "track cash" toggle so users who don't want cash accounting aren't forced in.

**Implementation sketch.** Migration mirroring the `cash_balances` `_self` RLS pattern (`auth.uid()::text = user_id`); a `/api/cash` route (GET/POST/DELETE) analogous to `/api/holdings`; feed `netContributions` into T8.

**Open questions.** Auto-derive cash from buys/sells vs. keep fully manual; seed net contributions from cost basis for legacy users who never recorded deposits.

---

## T8 — Correct returns: TWR + MWR/XIRR

**Priority:** P0 · **Effort:** M · **Depends on:** T7 · **Type:** gap

**Goal.** Replace the cash-flow-naive analytics with returns that are correct in the presence of deposits/withdrawals.

**Current state / gap.** `computePortfolioAnalytics` in `portfolio.ts` computes daily returns as `series[i].value / series[i-1].value − 1` straight off `portfolio_snapshots.value_sgd` — a deposit between snapshots reads as a positive return, and Sharpe/vol inherit the distortion. CAGR is `computeCAGR(first.value, last.value, years)` — first-to-last portfolio value, inflated by contributions; it is not a return. `cost_sgd` is read into the series but unused for returns. No `xirr`/`twr` anywhere.

**What's needed.**

- **TWR**: break the value series at each cash-flow date (from T7), compute the flow-excluded sub-period return, geometrically link — the headline number and the T9 benchmark-comparison basis.
- **MWR / XIRR**: Newton-Raphson (bisection fallback) over dated flows `[−deposits, +withdrawals, +endingValue]`; per-holding, per-account (`source`/broker), portfolio-wide.
- Recompute Sharpe/vol from the flow-adjusted sub-period returns; relabel or replace CAGR with annualised TWR.

**Implementation sketch.** Pure, unit-testable `computeTWR(series, flows)` and `computeXIRR(flows)` in `portfolio.ts`. Where flows are absent (user hasn't recorded cash), fall back to today's behaviour and mark the metric "unadjusted" in the UI so it isn't silently wrong.

**Open questions.** Sub-year annualisation convention; how to present the TWR/MWR gap (it's informative — timing luck/skill); daily vs. transaction-date flow granularity.

---

## T10 — History correctness + scheduled snapshotting

**Priority:** P0 · **Effort:** M · **Depends on:** T11 (for split-adjust) · **Type:** gap, tech debt

**Goal.** Fix the value-over-time series (it double-counts sold positions and mismatches split adjustment) and make it accrue automatically instead of only when a user manually triggers it.

**Current state / gap.** In `src/app/api/holdings/backfill/route.ts`, the per-date loop does `const active = holdings.filter(h => h.buyDate <= date)` then sums `h.units·histPrice·histFxRate` — it **never checks `transactionType`**, so a `sell` lot is added like a buy and sold positions inflate history forever. `histPrice` is EODHD `adjusted_close` (split/dividend-adjusted) but `costSgd` uses raw `h.buyPrice` — different scales after a split. Snapshotting is on-demand only (`POST /api/holdings/backfill`, rate-limited 2/60s fail-closed); no `vercel.json`, `pg_cron` only commented-out. No app open → no snapshot that day → gappy live history that T8 inherits.

**What's needed.**

- Net positions **per date**: `unitsHeld(date) = Σ buys(trade_date ≤ date) − Σ sells(trade_date ≤ date)`; zero out instruments with no net units. Same logic as `netAggregate`, time-sliced.
- Resolve adjusted-vs-raw basis: adjust `buyPrice` for splits (needs T11) or use unadjusted closes consistently — pick one, document it.
- A scheduled daily snapshot for all active users: Vercel Cron (add `vercel.json`) → an authenticated internal route, or a Supabase scheduled Edge Function, or `pg_cron`. Runs under service role; respects the shared `ticker_quotes` cache (one fetch per instrument, not per user).

**Implementation sketch.** Refactor the value-assembly loop to consume net-units-per-date + a buy-then-partial-sell unit test; add `/api/internal/snapshot-all` guarded by a shared-secret header (not a user cookie).

**Open questions.** Snapshot timezone (SGX vs. US close); weekends (fill-forward already handles gaps); how to bound cost as the cron fans out across users on paid providers (see T17).

---

# P1 — High value, next

## T4 — News relevance

**Priority:** P1 · **Effort:** S–M · **Depends on:** — · **Type:** gap

**Goal.** Fix news results that aren't relevant to the queried holding.

**Current state / gap** (all in `src/app/api/news/route.ts`). `fetchNewsForSymbol` waterfalls Finnhub → Alpha Vantage → NewsAPI and stops at the first provider returning anything (no merge/rank). Alpha Vantage's own `ticker_sentiment[].relevance_score` is fetched and logged but discarded. No post-fetch check that the ticker or company name appears in the headline/summary. The `EODHD_TO_FINNHUB` exchange-suffix map is incomplete; an unmapped exchange falls back to a bare ticker (`?? ""`), risking cross-exchange symbol collisions. No dedup by URL/title.

**What's needed.**

- Use `relevance_score` to filter/sort rather than discard it.
- Post-fetch relevance filter: keep items where the ticker or a company-name token appears in the headline/summary.
- Merge and rank across providers, or at minimum fall through when the top result's relevance is low (not only when the set is empty).
- Fill gaps in `EODHD_TO_FINNHUB` and fail closed (skip Finnhub for unmapped exchanges) instead of a bare ticker.
- Dedup by URL/title similarity.

**Implementation sketch.** Contained to one file, no schema. Consider a small `news_cache` keyed by `symbol+day` — each holding hits up to 3 providers on every view (cost/rate), and sentiment is recomputed each time.

**Open questions.** Relevance threshold for fall-through; cache TTL.

---

## T5 — Analysis accuracy

**Priority:** P1 · **Effort:** S–M · **Depends on:** — · **Type:** gap

**Goal.** Make AI portfolio analysis specific and accurate instead of generic.

**Current state / gap** (`analyst/route.ts`, `analysis/page.tsx`). The sentiment prompt instructs the model to reason from "general knowledge" and never claim live data — the main driver of generic output. Sentiment mode sends only `id`/`type`/a single 30-day price delta per holding — no price, cost, weight %, sector, currency, or dividends, though all are computed in `usePortfolio()` (`assetAllocation`, `geoAllocation`, `hero`, `currencyCards`). Ask mode sends `totalPct` (P&L %, easily conflated with weight). Fetched news headlines never reach the model. No instruction to cite the given numbers. `maxTokens: 350` caps Ask depth; no explicit temperature.

**What's needed.**

- Thread `assetAllocation`/`geoAllocation`/`hero`/`currencyCards` into both prompts; send true portfolio weight % alongside P&L %.
- Thread the already-fetched news headlines into the sentiment prompt as grounding.
- Reframe the system prompt from "don't claim live data" to "here is live data — analyze only from this and cite the specific figures."
- Raise Ask `maxTokens`; lower temperature for the factual Ask task.

**Implementation sketch.** Plumbing across `route.ts`, `analyst-api.ts`, `analysis/page.tsx`; no infra/schema.

**Open questions.** Threading news headlines is a **new untrusted input** — the existing `sanitize()`/`xmlEscape()` cover user strings; third-party headline text needs the same (arguably stricter) escaping. Once T6/T8/T9/T12 land, expand grounding to realized P&L, TWR, benchmark, income.

---

## T9 — Benchmark comparison

**Priority:** P1 · **Effort:** S–M · **Depends on:** T8 · **Type:** enhancement

**Goal.** "Am I beating the index?" — overlay portfolio return vs. one or more benchmarks with relative performance.

**Current state / gap.** Zero `benchmark` matches; `AreaTrend`/`charts/page.tsx` plot only the user's own value series. No index history is fetched (`fetchDailyCloses` pulls per-holding closes only).

**What's needed.**

- Configurable benchmark set (defaults: `VWRA.LSE`, `SPY`/`^GSPC`, `URTH`/MSCI World, `^STI`); store the choice on `user_settings` (+ column grant).
- Fetch benchmark daily closes via the existing EODHD/Yahoo path; cache in shared `ticker_history`/`ticker_quotes` (service-role write).
- Normalise both series to 100 at the range start and overlay; compute since-inception and per-range relative return; optional beta/correlation from T8's return series. **Compare on a TWR basis**, not raw value.

**Implementation sketch.** `/api/benchmark` GET (closes for symbol + range); extend `AreaTrend` to accept an optional comparison series + legend entry.

**Open questions.** Convert the benchmark to SGD (on-brand with FX Lab) vs. compare in native + FX caveat; single vs. multiple simultaneous benchmarks.

---

## T12 — Dividend & coupon income as recorded events

**Priority:** P1 · **Effort:** M · **Depends on:** T7 (optional) · **Type:** gap, enhancement

**Goal.** Record income actually received (dividends, coupons, interest) as dated cash events — not just projected yield — enabling income history, yield-on-cost, DRIP, and the tax report.

**Current state / gap.** `ticker_dividends.yield_ttm` + `holding_overrides.dividend_yield` are projections. `GET /api/holdings/dividends` surfaces the estimate only; nothing records that a dividend was paid on a date. `instruments` has `coupon_rate`/`par_value`/`maturity_date` but nothing computes coupons.

**What's needed.**

- `income_events` (or reuse T7's `cash_transactions` with `type = dividend_cash|coupon|interest`): `(user_id, instrument_id, date, gross, withholding_tax, net, currency, drip_units?)`.
- DRIP: when reinvested, create a buy lot at the reinvestment price.
- Coupon accrual from `coupon_rate`/`par_value`/`maturity_date` (semi-annual default, configurable).
- Ingest EODHD/Yahoo dividend history (propose for confirmation) + broker statements (extend `ParsedTrade` to carry income rows). Capture withholding tax (feeds T16; SG-relevant US 30% WHT).

**Implementation sketch.** Reuse the cash ledger; add an "Income" view aggregating by month/instrument; yield-on-cost = TTM received income ÷ cost basis (T6).

**Open questions.** Coupon frequency defaults; reconcile broker-reported net dividends (already post-WHT) vs. computing WHT ourselves; DRIP auto-lot vs. propose.

---

## T13 — Broker as a first-class entity + per-broker views + reconciliation

**Priority:** P1 · **Effort:** M · **Depends on:** — · **Type:** tech debt, enhancement

**Goal.** Make "broker" a real dimension so users get per-broker allocation/value/performance and imports are attributable and reconcilable.

**Current state / gap.** `broker` is a plain `text DEFAULT ''` column on `lots` — no `brokers` table (zero matches), no canonicalisation ("IBKR" vs "Interactive Brokers"), no per-broker aggregation, no connection/sync metadata. `source` (`CPF`/`SRS`/`Cash`) is a separate free-ish field doing account-type duty, also not a first-class UI grouping.

**What's needed.**

- A `brokers` reference table (canonical/display name, country, logo); normalise existing free-text `broker` values into it (migration + manual cleanup pass).
- Per-broker views: allocation, value, gain, cash (T7), TWR/XIRR (T8); the same for `source`/account-type as a first-class grouping.
- Reconciliation: enter the broker-reported total and flag drift vs. computed value (catches missed trades / corporate actions).
- Connection/sync metadata columns for when T14/T15 land (last_sync, method).

**Implementation sketch.** `brokers` table + a `broker_id` FK on `lots` (keep the text column during migration, then drop). Generalise `computeAllocationBySource` in `portfolio.ts` to group by any dimension.

**Open questions.** How aggressively to auto-normalise free-text brokers; `source` (tax account type) and `broker` are orthogonal (a broker holds both Cash and SRS lots).

---

## T14 — Generic CSV importer + import reconciliation/dedup

**Priority:** P1 · **Effort:** M · **Depends on:** — · **Type:** enhancement, gap

**Goal.** Import any broker's CSV by mapping its columns once, and make re-imports safe (no duplicate lots).

**Current state / gap.** Import is per-broker PDF parsing (`src/lib/pdf-parsers/` — FSMOne, DBS Vickers) plus a CSV path; every new broker needs new code. `POST /api/holdings` inserts unconditionally — re-importing an overlapping statement duplicates every trade. No import-history table. This dedup layer is also what makes **T15**'s aggregation sync idempotent.

**What's needed.**

- Mapping UI: upload a CSV → map columns (ticker/units/price/date/type/fees/currency/broker); save the mapping per broker in `import_mappings` for one-click re-imports.
- Transaction-identity hash (`user_id+broker+symbol+trade_date+type+qty+price`, rounded) checked before insert; skip/flag duplicates.
- `import_batches` (source, filename/connection, row counts, timestamp) — auditable, reversible.
- Staging → review → confirm, reusing the `PdfImportPanel` review table in `add/page.tsx`.

**Implementation sketch.** `/api/import/parse-csv` (mapping-driven) beside `/api/parse-pdf`; dedup check added to the `POST /api/holdings` bulk path.

**Open questions.** Files mixing buys/sells/dividends/fees (route by a mapped `type` column); dedup rounding tolerance (broker exports vary in decimal precision).

---

# P2 — Important

_The ★ recommended enhancements plus the platform gaps. Do after the P0 spine; within this tier, the small items (AN4/AC6/RE2/T16/T17) are cheap early wins._

## AN4 — Concentration & diversification score

**Priority:** P2 · **Effort:** S · **Depends on:** T6 · **Type:** enhancement

**Goal.** Surface how concentrated the portfolio is and warn on over-exposure.

**Current state / gap.** The Overview allocation donut and `computeAllocationBySource` exist, and `usePortfolio()` exposes `assetAllocation`/`geoAllocation` — but there's no concentration metric or warning anywhere.

**What's needed.** Compute single-name %, sector %, currency %, and geography % of portfolio value; a Herfindahl-Hirschman Index (HHI) per dimension; configurable thresholds that trigger a badge/warning (e.g. single name > 20%). Surface on Overview.

**Implementation sketch.** A pure function in `portfolio.ts` consuming the existing net `HoldingRow[]` + allocation maps; a small concentration card. Sector % needs an instrument `sector` field (see AC7) — until then, do asset-type/currency/geo and defer sector.

**Open questions.** Default thresholds; weight by net position (post-T6) vs. gross.

---

## AC6 — Watchlist

**Priority:** P2 · **Effort:** S · **Depends on:** — · **Type:** enhancement

**Goal.** Track instruments you don't own.

**Current state / gap.** `instruments` and `ticker_quotes` are shared, but there's no watchlist concept; `add/page.tsx` only creates lots.

**What's needed.** A `watchlist` table `(user_id, instrument_id, added_at, note)`; reuse the shared `ticker_quotes` refresh + `spark_data`; a Watchlist view; "add to watchlist" from the instrument search / add flow.

**Implementation sketch.** `/api/watchlist` route; reuse the instrument-resolution enrichment from `parse-pdf/route.ts`; the `Spark` chart component for mini trends.

**Open questions.** Alerting on watchlist items (ties to AL1); watchlist refreshes count against the shared price quota (T17).

---

## RE2 — Observability

**Priority:** P2 · **Effort:** S · **Depends on:** — · **Type:** tech debt

**Goal.** Know when providers and routes fail in production.

**Current state / gap.** Errors are `console.error`'d ad hoc (e.g. `rate-limit.ts`) and provider fetches swallow failures silently (`prices.ts`/`backfill/route.ts` catch and return `{}`). No aggregation, no alerting, no visibility into which provider is degraded.

**What's needed.** Wire an error-tracking SDK (Sentry or similar) for client + server; structured logging of provider failures; a provider-health view (last success, error rate per provider) — reuse `app_config` or a small `provider_health` table.

**Implementation sketch.** Wrap provider fetches to emit success/failure metrics (pairs with RE1); an admin-page tab for the health view.

**Open questions.** Self-host vs. SaaS; PII/financial-data scrubbing in error payloads.

---

## T16 — Tax reporting (realized gains, income, foreign WHT)

**Priority:** P2 · **Effort:** S–M · **Depends on:** T6, T12 · **Type:** enhancement

**Goal.** Exportable tax reports — realized capital gains, dividend/interest income, and foreign withholding — correct for both the SG (no CGT) and foreign-taxed cases.

**Current state / gap.** No realized data (until T6), no received-income data (until T12), no WHT capture, no report export (the API has no reporting endpoint).

**What's needed.**

- Realized-gains report for a chosen tax year (from T6 `realized_lots`), grouped by instrument, with asset-vs-FX split.
- Income report (from T12): gross / withholding / net, by source country.
- CSV + PDF export.
- SG framing: prominently note no CGT (the realized report is record-keeping) while still computing it for users tax-resident elsewhere; SRS/CPFIS context ties to T1.

**Implementation sketch.** `/api/reports/tax?year=YYYY` aggregating the two stores; PDF via server-side render (shared with UX5).

**Open questions.** Jurisdictions beyond SG in v1; wash-sale (see IN2); US-SG has no reduced dividend treaty rate — 30% applies (hardcode a note).

---

## T17 — Per-user provider-cost quota

**Priority:** P2 · **Effort:** S–M · **Depends on:** — · **Type:** tech debt

**Goal.** Stop one heavy user exhausting the shared paid-provider budget (EODHD ~$20/mo, one key), and enable tiering.

**Current state / gap.** `consume_rate_limit(bucket, max, window_secs)` is a per-user, per-bucket request **count** — it limits frequency, not cost, and isn't aware of which provider a call hits. Paid keys are shared server-side env vars, so every user draws on one quota with no accounting. The T10 daily cron multiplies calls across users → an uncapped bill.

**What's needed.**

- Per-user monthly quota buckets for cost-bearing providers (e.g. `eodhd:calls`), decremented per paid call, with a tier ceiling on `user_settings` (`plan`/`quota`).
- Cache-first enforcement using the shared `ticker_quotes`/`ticker_history` caches (fetch each instrument once, serve all) in `prices.ts`/backfill.
- Graceful degradation on exhaustion — serve cached/stale with a staleness indicator (RE1), don't error.

**Implementation sketch.** Reuse `consume_rate_limit` with monthly windows + per-provider buckets; a cost-accounting wrapper around the EODHD fetch in `prices.ts` and the backfill route.

**Open questions.** Free-tier ceiling that keeps unit economics positive; expose remaining quota to users?; cron batching to minimise paid calls.

---

## AN1 — Returns completeness

**Priority:** P2 · **Effort:** M · **Depends on:** T8, T12 · **Type:** enhancement

**Goal.** Show total return (including dividends) vs. price return, plus calendar-year and rolling returns.

**Current state / gap.** `computePortfolioAnalytics` gives CAGR/Sharpe/vol/drawdown from the snapshot value series; there's no dividend-inclusive return, no per-year table, and no rolling windows. `charts/page.tsx` shows a value area chart only.

**What's needed.** A total-return series (price change + received income from T12, reinvested) alongside a price-return series for comparison; a calendar-year returns table; trailing 1/3/5y and since-inception rolling returns — all on a TWR basis (T8) so contributions don't distort them.

**Implementation sketch.** Extend `portfolio.ts` with the series math; a returns table/section on the Charts tab (reuse existing chart components).

**Open questions.** Annualisation for partial years; show gross vs. net-of-fees.

---

## IN1 — Income & yield dashboard

**Priority:** P2 · **Effort:** M · **Depends on:** T12, T6 · **Type:** enhancement

**Goal.** One place for the dividend/coupon calendar, received-income history, and yields.

**Current state / gap.** Income is projected only (`ticker_dividends.yield_ttm`, `holding_overrides.dividend_yield`, `/api/holdings/dividends`); no received-income store until T12, no calendar, no yield-on-cost.

**What's needed.** A dividend calendar (upcoming ex-div/pay dates, from EODHD/Finnhub dividend endpoints); received-income history (monthly) from T12's `income_events` with projected annual + growth; current yield (income ÷ price) and yield-on-cost (income ÷ cost basis, T6) per holding and portfolio-wide.

**Implementation sketch.** `/api/income` aggregating `income_events`; an Income tab reusing `Spark`/`Donut`.

**Open questions.** Coupon vs. dividend display; forward-projection basis (TTM vs. declared/announced).

---

## AC1 — Fixed income, properly

**Priority:** P2 · **Effort:** M · **Depends on:** — · **Type:** gap, enhancement

**Goal.** Real bond / T-bill / SSB metrics — a strong SG differentiator.

**Current state / gap.** `instruments` carries `par_value`/`coupon_rate`/`maturity_date`, but nothing computes yield-to-maturity, accrued interest, or a coupon schedule; `prices.ts` has no bond pricing; SSB (step-up) and T-bills (discount) aren't modelled distinctly.

**What's needed.** YTM, accrued interest, and a coupon schedule from the existing metadata; SSB and T-bill handling; current value from clean/dirty price; feed coupons into T12 income. SSB rates from MAS.

**Implementation sketch.** A bond-math module; extend the Holdings inspector; manual price entry fallback where no provider covers the instrument (RE already does this for property).

**Open questions.** Bond price sources (EODHD coverage is thin for SG retail bonds); manual valuation cadence.

---

## UX1 — Onboarding + sample portfolio + empty states

**Priority:** P2 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** A first-run experience for non-technical users.

**Current state / gap.** A fresh user hits an empty dashboard — `layout.tsx` fetches holdings/settings and renders empty; there are no empty-state components or guidance, and `add/page.tsx` assumes domain knowledge.

**What's needed.** A guided first-add flow; a "load sample portfolio" seed (a few instruments) so Charts/Analysis are populated immediately; per-tab empty states; an import-first CTA (CSV/PDF/T15).

**Implementation sketch.** A seed route/util; empty-state components; a dismissible onboarding checklist. Localise defaults for SG (SGD base, SGX examples).

**Open questions.** Cleaning up sample data on first real add; how prescriptive the checklist should be.

---

## RE1 — Provider fallback chains + circuit breakers + staleness indicators

**Priority:** P2 · **Effort:** M · **Depends on:** — · **Type:** tech debt

**Goal.** Resilient prices and honest staleness in the UI.

**Current state / gap.** `prices.ts`/`backfill`/`news` waterfall providers and silently return `{}` on failure; `ticker_quotes.price_source`/`refreshed_at` exist but staleness isn't surfaced; there's no circuit breaker (a down provider is retried on every call).

**What's needed.** Explicit fallback chains with per-provider health / circuit-breaker (skip a failing provider for a cooldown); UI badges showing price age / source / confidence; distinguish "stale" from "unavailable".

**Implementation sketch.** A provider wrapper holding breaker state; surface `refreshed_at`/`price_source` in the inspector. Pairs with RE2 (metrics) and T17 (cache-first).

**Open questions.** Breaker persistence across serverless invocations (edge/KV state).

---

## SE1 — Legal & privacy

**Priority:** P2 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** The legal baseline required before anyone but you uses it.

**Current state / gap.** Self-serve account deletion exists (`/api/account` DELETE → `purgeUser`), but there's no privacy policy or ToS, PDPA/GDPR obligations are unmet, there's no consent record, and analytics (Vercel Analytics) aren't disclosed.

**What's needed.** A privacy policy + ToS; PDPA (Singapore) + GDPR compliance — a data-export endpoint, documented right-to-deletion (extend `purgeUser`), and consent capture at signup; cookie/analytics disclosure.

**Implementation sketch.** Static legal pages; `/api/account/export` (full user data as JSON/CSV — also serves UX5); a consent flag on `user_settings`.

**Open questions.** Jurisdiction of record; DPAs with sub-processors (Supabase, EODHD, Anthropic, and the T15 aggregator).

---

## T11 — Corporate actions

**Priority:** P2 · **Effort:** L · **Depends on:** — · **Type:** gap

**Goal.** Handle splits, reverse splits, mergers, spin-offs, ticker/symbol changes, delistings, and return of capital so units, prices, and history stay correct through them.

**Current state / gap.** Zero matches for split/corporate-action. `lots.quantity`/`price` and `instruments.symbol` are static once entered — a 4:1 split silently makes a position look 75% down until every lot is hand-edited. The backfill's `adjusted_close` disagrees with unadjusted lots after a split (the T10 mismatch). A ticker change orphans the `ticker_quotes` key (keyed by `symbol`).

**What's needed.**

- A `corporate_actions` table `(instrument_id, type, effective_date, ratio/terms, new_symbol)`, shared across users (service-role write).
- An adjustment pass: split → ×units, ÷price, preserve cost; symbol change → update `instruments.symbol` + remap `ticker_quotes`; spin-off/merger → create/close positions per terms; return of capital → reduce cost basis and optionally record a cash event (T7).
- Ingest EODHD splits/dividends; **propose actions for confirmation**, don't apply silently (avoids corrupting hand-entered data).

**Implementation sketch.** Detection piggybacks on the T10 daily cron; application reuses the `POST /api/holdings` PATCH path per lot. Ship **splits-only first** (covers the vast majority of real events); defer mergers/spin-offs.

**Open questions.** Auto-apply vs. always-confirm; how far back to backfill actions; interaction with T6 FIFO matching (splits change per-lot unit counts).

---

## T15 — Read-only broker aggregation API

**Priority:** P2 · **Effort:** L · **Depends on:** T14 · **Type:** enhancement

**Goal.** Pull holdings and transactions automatically from many brokers via a single read-only aggregator — no stored brokerage credentials, no trade capability.

**Why this, not native adapters (the dropped "T3").** Native per-broker adapters are N integrations with drifting auth/rate limits and put brokerage credentials in scope. An aggregation layer (SnapTrade / Plaid Investments / Akoya / Yodlee) is one integration covering many brokers, uses the provider's OAuth vault (store a per-user connection token, not the broker password), and is read-only by default. This is the sole broker-sync path; T14 (CSV) + AC8 (parsers) cover any broker the aggregator doesn't.

**How it works — does the user need an account? (verified 2026-07-06, SnapTrade model; Plaid/Akoya/Yodlee follow the same shape).** No — the user never signs up for the aggregator; the only thing they log into is their own broker. **You** hold the developer API key (client ID + consumer key) and pay the aggregator (typically per connected user/connection). On a user's first connect, your backend silently registers a SnapTrade "user" (1:1 with your end-user) and receives a `userId` + sensitive `userSecret` to store. Your backend then generates a short-lived (~5 min) Connection Portal URL; the user opens the hosted portal (iframe/tab/webview), selects their broker, and authenticates **directly with the broker** (OAuth or username/password + MFA, all inside the portal — broker credentials never touch Vantage). After success, you pull accounts/positions/transactions via `userId`/`userSecret` + account IDs. Consequences: (1) **read-only is the default** — trading needs an explicit `connectionType="trade"`, which we never send, so the "cannot place a trade" guarantee (GTM4) holds at the API level; (2) **connections expire (~weeks) and need a reconnect/repair flow**.

**What's needed.**

- Evaluate providers against the brokers your users hold (US coverage strong; SG/Asia — Tiger, moomoo, Saxo, POEMS — verify against the provider's current broker support matrix).
- `broker_connections` (per-user `userId` + `userSecret` [secret → vault/`pgcrypto`; none exists today] + connection/account IDs — never a broker password).
- An adapter mapping provider positions/transactions → `ParsedTrade[]` + income/cash events, feeding T14's review + dedup pipeline (idempotent sync).
- Explicit read-only scoping + a reconnect/repair flow.

**Implementation sketch.** Pilot one provider + one broker end-to-end; "Sync now" first, add to the T10 cron once idempotent. Security review before storing any connection tokens.

**Open questions.** Provider cost vs. pricing (billed per connection/user); SG data residency; cover aggregator-unsupported brokers via T14 (CSV) / AC8.

---

## AL1 — Alerts & notifications engine

**Priority:** P2 · **Effort:** L · **Depends on:** T10 · **Type:** enhancement

**Goal.** One delivery system covering price / portfolio / income / corporate-action / news alerts, plus a digest.

**Current state / gap.** No alerts anywhere. The only scheduled surface is the T10 cron (once built); email infra is Supabase magic-link only; there's no push.

**What's needed.**

- An `alert_rules` table `(user_id, type, params, channel, active)`; evaluation on the T10 daily cron (and intraday for price if desired).
- Channels: transactional email (Resend/Postmark) + optional web push.
- Alert types: price above/below, portfolio value milestone / drawdown, allocation-drift/rebalance (PL1), dividend received/upcoming (T12), corporate action (T11), news-sentiment (T4).
- Opt-in daily/weekly digest.

**Implementation sketch.** Rules CRUD route + UI; a cron evaluator; a transactional email sender. Richer alert types unlock as T11/T12/T4/PL1 land.

**Open questions.** Email-provider choice; intraday cadence vs. cost (T17); dedupe/snooze.

---

# P3 — Later / own track

_Sorted by effort. The largest (T2, AC3, AC4, PL3) are multi-week and deserve their own scoping/security pass; T1 and T2 are security-sensitive._

## PL4 — DCA / recurring-contribution tracking

**Priority:** P3 · **Effort:** S · **Depends on:** T7 · **Type:** enhancement

**Goal.** Track recurring buys/contributions against a plan and show dollar-cost-averaging.

**Current state / gap.** Lots are discrete; no recurrence/plan concept. T7's cash ledger provides the contribution stream.

**What's needed.** A `contribution_plan` (amount, cadence, target instrument/allocation); track actual vs. planned; surface the DCA average cost.

**Implementation sketch.** A small plan table + a plan-vs-actual card.

**Open questions.** Auto-create lots from the plan vs. manual confirm.

---

## UX3 — Trade journal

**Priority:** P3 · **Effort:** S · **Depends on:** — · **Type:** enhancement

**Goal.** Capture the thesis/notes behind each position.

**Current state / gap.** `lots.strategy`/`notes` fields exist but are barely surfaced in the UI.

**What's needed.** Dated per-position journal entries (thesis, rating, link to lots); a journal view with filter.

**Implementation sketch.** Extend `notes`, or a small `journal` table; UI in the Holdings inspector.

**Open questions.** Per-lot vs. per-instrument journaling.

---

## UX9 — Terminal affordances

**Priority:** P3 · **Effort:** S · **Depends on:** — · **Type:** enhancement

**Goal.** Keyboard-driven UX befitting a "terminal".

**Current state / gap.** Mouse-driven; `TabBar` nav; no shortcuts or command palette.

**What's needed.** Global shortcuts (nav, refresh, add); a command palette (⌘K) to jump to a holding or action.

**Implementation sketch.** A keybinding hook + a palette component.

**Open questions.** Mobile parity.

---

## SE3 — Surface the audit log to users

**Priority:** P3 · **Effort:** S · **Depends on:** — · **Type:** enhancement

**Goal.** User-visible security activity.

**Current state / gap.** `audit_log` (append-only, service-role writes) exists but only records admin actions, not user-facing events.

**What's needed.** Extend audit to record logins/session events; a "security activity" page (self-scoped RLS read); a suspicious-login flag.

**Implementation sketch.** Write auth events via the server client; a read view.

**Open questions.** What counts as suspicious; retention window.

---

## SE4 — Dependency scanning + pen-test + CSP review

**Priority:** P3 · **Effort:** S · **Depends on:** — · **Type:** tech debt

**Goal.** Baseline application-security hygiene.

**Current state / gap.** CSP nonce present (`proxy.ts`); no dependency scanning or pen-test cadence documented.

**What's needed.** Dependabot/Snyk in CI; a CSP-tightening review; a pen-test before public launch.

**Implementation sketch.** CI config; a CSP audit; engage a pen-test vendor pre-launch.

**Open questions.** Budget/timing for the pen-test.

---

## PL2 — Goals / net-worth targets

**Priority:** P3 · **Effort:** S–M · **Depends on:** — · **Type:** enhancement

**Goal.** Set and track financial goals.

**Current state / gap.** No goals concept; the hero shows total value only.

**What's needed.** Goal targets (net worth, per-account, by date); progress vs. current + projection.

**Implementation sketch.** A `goals` table; a goals card; ties to AC5 (net worth) and T1 (retirement).

**Open questions.** Overlap with T1's retirement projection — keep goals generic, T1 SG-specific.

---

## AI2 — Scheduled AI reports

**Priority:** P3 · **Effort:** S–M · **Depends on:** T10, AL1 · **Type:** enhancement

**Goal.** Automated periodic portfolio review.

**Current state / gap.** The analyst route is on-demand SSE; no scheduling.

**What's needed.** Monthly/quarterly report generation on the T10 cron; store + deliver via AL1; grounded on real data (post T5/AI1).

**Implementation sketch.** Cron → analyst with a report prompt → store → email.

**Open questions.** Cost per user (T17); opt-in.

---

## AN2 — Attribution

**Priority:** P3 · **Effort:** M · **Depends on:** T8 · **Type:** enhancement

**Goal.** Decompose return by holding, sector, geography, and currency.

**Current state / gap.** The FX Lab decomposes asset-vs-FX gain (`computeAssetGainSGD`/`computeFxGainSGD`), but there's no contribution-to-return by holding/sector/geo/currency.

**What's needed.** Contribution-to-return over a range by each dimension; extend the existing decomposition; a waterfall/bar viz (reuse `Dumbbell`/`Donut`).

**Implementation sketch.** An attribution function in `portfolio.ts` over the T8 return series; sector needs an instrument `sector` field (AC7).

**Open questions.** Arithmetic vs. geometric attribution linking.

---

## AN3 — Risk metrics beyond Sharpe

**Priority:** P3 · **Effort:** M · **Depends on:** T9 · **Type:** enhancement

**Goal.** A fuller risk picture.

**Current state / gap.** `computeSharpeRatio` + annualised vol + max drawdown exist in `portfolio.ts`; no beta, Sortino, correlation, or VaR.

**What's needed.** Beta vs. the T9 benchmark; Sortino / downside deviation; a correlation matrix across holdings; VaR; per-holding volatility.

**Implementation sketch.** Extend the `portfolio.ts` risk functions using daily returns — needs a per-holding return series (fetch per-instrument history like the backfill does at portfolio level).

**Open questions.** Cost of per-holding history fetches (T17).

---

## IN2 — US-tax extras

**Priority:** P3 · **Effort:** M · **Depends on:** T6, T16 · **Type:** enhancement

**Goal.** Helpers for US-taxable users.

**Current state / gap.** No wash-sale or harvest logic; T16 adds realized reporting.

**What's needed.** Wash-sale detection (30-day window around losses across substantially-identical lots); tax-loss-harvest candidate flags.

**Implementation sketch.** Analysis over T6 `realized_lots` + open lots; gate by tax residency (T1) since it's US-only.

**Open questions.** "Substantially identical" scope.

---

## AC2 — Funds / unit trusts / robos

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** NAV-based tracking (Endowus, Syfe, StashAway).

**Current state / gap.** `instruments` assume listed tickers with exchange quotes; robo/fund NAVs aren't sourced.

**What's needed.** A "fund" asset type; a NAV price source (manual or provider); handling for no-ticker funds; robo portfolios as aggregate positions.

**Implementation sketch.** Extend `asset_type`; manual NAV entry like RE; optional provider feed.

**Open questions.** NAV data sources for SG funds; whether to model underlying holdings.

---

## AC5 — Private/illiquid assets → net worth

**Priority:** P3 · **Effort:** M · **Depends on:** T7 · **Type:** enhancement

**Goal.** A full net-worth view beyond market assets.

**Current state / gap.** Property is supported (manual price); no fixed deposits, savings, PE, or collectibles; no net-worth rollup distinct from the portfolio.

**What's needed.** Manual asset types (cash savings, FD with rate/maturity, PE, collectibles); a net-worth view combining portfolio + cash (T7) + CPF/SRS (T1) + manual assets.

**Implementation sketch.** Extend instruments/asset types for manual valuation; a net-worth page.

**Open questions.** Valuation cadence for illiquid assets; liabilities (mortgages) — scope creep, defer.

---

## AC7 — Fundamentals & events

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** Per-holding fundamentals and an events calendar.

**Current state / gap.** Finnhub is used for news/sparklines, but fundamentals (P/E, market cap, sector), earnings dates, analyst ratings, and insider transactions aren't surfaced; `instruments` has no `sector` field.

**What's needed.** Fetch + cache fundamentals (Finnhub/EODHD); add `sector` to `instruments` (also powers AN2/AN4); an earnings calendar; ratings/insider on the inspector.

**Implementation sketch.** `/api/fundamentals` + a fundamentals cache table; an inspector section.

**Open questions.** Provider coverage for SG/HK listings; refresh cadence + quota (T17).

---

## AC8 — Broker-specific parsers (last resort)

**Priority:** P3 · **Effort:** M · **Depends on:** T14 · **Type:** enhancement

**Goal.** Parse a specific broker's statement when neither the T15 aggregator nor a CSV works.

**Current state / gap.** `pdf-parsers/` has FSMOne + DBS Vickers with a `detectBroker()` dispatcher and a generic pipeline in `parse-pdf/route.ts`. Mostly superseded by T14 + T15.

**What's needed.** Add a parser only for a must-have broker with no aggregator support and no usable CSV export; conform to `ParsedTrade`/`ParseResult`; feed T14 dedup.

**Implementation sketch.** A new parser module + a `detectBroker` entry; reuse the enrichment + review UI.

**Open questions.** Which broker (only if a real user need arises).

---

## PL1 — Target allocation + rebalancing suggestions

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** Rebalancing guidance — compute-only, no execution (stays within the read-only constraint).

**Current state / gap.** The allocation donut exists; no targets, drift, or suggestions.

**What's needed.** Set a target allocation (by asset type / sector / geo); compute drift vs. actual; suggest buy/sell amounts to rebalance; feed the AL1 drift alert.

**Implementation sketch.** Targets on `user_settings`/a table; a rebalance card using the existing allocation maps.

**Open questions.** Rebalancing across accounts/brokers (T13); tax-aware (SG none; US wash-sale via IN2).

---

## UX2 — Multiple portfolios

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** More than one portfolio per user, plus a consolidated view.

**Current state / gap.** A single implicit portfolio per `user_id`; `layout.tsx` fetches by `user.id`; the context is single.

**What's needed.** A `portfolio_id` dimension on `lots`/`cash`/`snapshots`; a portfolio switcher + a consolidated mode.

**Implementation sketch.** Add `portfolio_id` (default one); a switcher in `NerveBar`; an aggregate mode.

**Open questions.** Migrating existing lots to a default portfolio; interaction with T2 household.

---

## UX4 — Search / filter / tagging

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** Find and organise holdings and transactions.

**Current state / gap.** The holdings table has some sorting (`feat/show-total-units`); no search, tags, or filters across lots/transactions.

**What's needed.** Free-text search; filters (asset type, broker, source, currency); user tags on lots; saved filters.

**Implementation sketch.** Client filtering over `usePortfolio` data + a tags field; server search for large sets.

**Open questions.** Tags on lot vs. instrument.

---

## UX5 — Reporting & export

**Priority:** P3 · **Effort:** M · **Depends on:** T16 · **Type:** enhancement

**Goal.** Exports/statements + full backup.

**Current state / gap.** No export; tax exports live in T16.

**What's needed.** A PDF portfolio statement; CSV export of holdings/transactions; full-account backup/import (JSON) — also serves SE1 data-portability.

**Implementation sketch.** Server-side PDF render (shared with T16); CSV endpoints; reuse the T14 import pipeline for restore.

**Open questions.** Statement layout/branding.

---

## UX6 — Time-travel (portfolio as of a date)

**Priority:** P3 · **Effort:** M · **Depends on:** T10 · **Type:** enhancement

**Goal.** View portfolio composition as of a past date, not just the value line.

**Current state / gap.** Charts use snapshots for value-over-time; the backfill reconstructs value but not composition; there's no as-of holdings view.

**What's needed.** Reconstruct holdings composition as of date D from the transaction log (net units per date — the same logic as T10); render Overview/allocation as-of.

**Implementation sketch.** Reuse the T10 net-units-per-date function; a date picker on Overview.

**Open questions.** Reconstruction performance on large histories (precompute?).

---

## UX7 — Dashboard customization

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** A user-arrangeable dashboard.

**Current state / gap.** Fixed tab layouts; cards in a fixed order.

**What's needed.** Rearrangeable/toggleable widgets; a saved layout per user.

**Implementation sketch.** A layout config on `user_settings`; a drag-and-drop grid.

**Open questions.** Mobile layout; which cards are in scope.

---

## UX8 — Mobile / PWA

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** Solid mobile experience + installable app.

**Current state / gap.** `TabBar` has a mobile drawer and responsiveness is partial; not a PWA.

**What's needed.** A responsive audit across tabs/charts; a PWA manifest + service worker (offline shell); touch-target sizing.

**Implementation sketch.** Manifest + SW; responsive fixes (`fix/landing-page-portfolio-ui` is a start).

**Open questions.** Offline data scope (read-only cache).

---

## UX10 — Accessibility + i18n

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** WCAG conformance + localisation scaffolding.

**Current state / gap.** Terminal palette (contrast unverified), no documented a11y; English-only; currency formatting via `formatters.ts`.

**What's needed.** A WCAG AA pass (contrast, keyboard, ARIA, screen-reader on charts); i18n scaffolding (e.g. next-intl) + locale formatting.

**Implementation sketch.** An a11y audit; extract strings; a locale switch.

**Open questions.** Which locales (SG: English sufficient near-term).

---

## AI1 — Conversational analysis

**Priority:** P3 · **Effort:** M · **Depends on:** T5 · **Type:** enhancement

**Goal.** Chat over live portfolio data instead of a static prompt snapshot.

**Current state / gap.** The analyst route sends a static snapshot; T5 improves grounding but there's no tool/function-calling, and Ask mode is capped at 350 tokens.

**What's needed.** Function/tool-calling so the model queries the DB on demand (positions, realized P&L, income, benchmark); an NL Q&A UI ("what's my tech exposure?", "how did I do in Q2 vs. the S&P?"); multi-turn.

**Implementation sketch.** Tools mapping to existing data functions (`fetchHoldings`, `computePortfolioAnalytics`, income, benchmark); Anthropic tool-use in the analyst route.

**Open questions.** Cost/quota (T17); read-only tool guarantees.

---

## AI3 — Anomaly detection

**Priority:** P3 · **Effort:** M · **Depends on:** AL1 · **Type:** enhancement

**Goal.** Flag unusual moves and data issues.

**Current state / gap.** None; sparklines/prices live in `ticker_quotes`.

**What's needed.** Detect abnormal daily moves per holding and data drift (stale/failed prices; currency drift is already auto-healed); surface as alerts (AL1).

**Implementation sketch.** Statistical thresholds over spark/history; feed AL1; pairs with RE1/RE2.

**Open questions.** False-positive tuning.

---

## RE3 — Backup / restore

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** tech debt

**Goal.** Recoverability.

**Current state / gap.** Supabase-managed backups only; no app-level export/restore or documented PITR strategy.

**What's needed.** Scheduled logical backups; a documented restore runbook; user-level export (overlaps SE1/UX5).

**Implementation sketch.** `pg_dump` schedule or Supabase PITR; a runbook.

**Open questions.** RPO/RTO targets.

---

## SE2 — MFA / 2FA

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** Stronger auth for financial data.

**Current state / gap.** Supabase magic link + Google OAuth (PKCE); no MFA.

**What's needed.** Enable Supabase MFA (TOTP); enforce for sensitive actions (T15 connect, account delete).

**Implementation sketch.** Supabase MFA APIs; an enrolment UI.

**Open questions.** Recovery codes; enforcement policy.

---

## GTM1 — Multi-tenant SaaS tiering

**Priority:** P3 · **Effort:** M · **Depends on:** T17 · **Type:** enhancement

**Goal.** Commercial plans (free/pro).

**Current state / gap.** Roles are `user`/`admin`/`superadmin`; no plan/tier concept. T17 adds the per-user quota mechanism.

**What's needed.** Plan tiers mapping to T17 quotas + feature flags (`app_config` already has provider flags — extend to plan gating); a `plan` field on `user_settings`.

**Implementation sketch.** `plan` on `user_settings`; gate features/quotas by plan.

**Open questions.** Pricing; grandfathering existing users.

---

## GTM2 — Billing

**Priority:** P3 · **Effort:** M · **Depends on:** GTM1 · **Type:** enhancement

**Goal.** Charge for the pro tier.

**Current state / gap.** None.

**What's needed.** Stripe subscriptions + a webhook that sets the plan (GTM1); a billing portal.

**Implementation sketch.** Stripe checkout + a webhook route (service-role updates plan).

**Open questions.** SG GST; proration.

---

## GTM3 — Sharing / referrals

**Priority:** P3 · **Effort:** M · **Depends on:** — · **Type:** enhancement

**Goal.** Growth loops.

**Current state / gap.** None; T2 household is private, not public sharing.

**What's needed.** Opt-in public/anonymised portfolio share links; referral tracking/rewards.

**Implementation sketch.** A share token + an anonymised read view; referral codes.

**Open questions.** Anonymisation guarantees; abuse prevention.

---

## GTM4 — Landing / marketing

**Priority:** P3 · **Effort:** M · **Depends on:** T15 · **Type:** enhancement

**Goal.** A public marketing site.

**Current state / gap.** Landing branches exist (`feat/landing-enhancement`, `feat/tailwind-landing-sonner`) with aurora/theming.

**What's needed.** Finish the landing; **lead with the read-only "we can't place a trade" guarantee** (from T15) as the trust hook; feature/pricing pages (GTM1/2).

**Implementation sketch.** Build on the landing branches.

**Open questions.** Positioning; SEO.

---

## T1 — Retirement & SG tax planning (SRS/CPFIS + CPF LIFE + FIRE)

**Priority:** P3 · **Effort:** M–L · **Depends on:** (T7) · **Type:** enhancement

**Goal.** A single Singapore retirement-income + tax-planning surface that (a) models SRS withdrawals to manage income-tax bracket impact (SRS withdrawals are taxable; only 50% is taxable after statutory retirement age), (b) tracks SRS/CPFIS contributions against annual caps and the tax relief they generate, and (c) projects total retirement income by folding CPF LIFE payouts with SRS drawdown and investment holdings.

**Current state / gap.** SRS exists only as a `source` tag on lots — no `srs_balances` table (unlike `cpf_balances`), no contribution-cap or CPFIS tracking, no withdrawal history; no birth-year / tax-residency / income fields anywhere (repo-wide zero matches); and no retirement-income projection combining CPF LIFE + SRS + investments (the CPF LIFE calculator branch estimates CPF payouts in isolation).

**What's needed.**

- `srs_balances` / `srs_contributions` (balance; cumulative contributions vs. annual cap — $15,300 citizens/PR, $35,700 foreigners; withdrawal history by year); CPFIS contribution/limit tracking.
- `user_settings` fields: birth year (statutory retirement age), tax residency, annual income / marginal bracket.
- SG income-tax brackets **and** SRS/CPFIS relief rules in `app_config` (like `cpf_life_rates`) so they update without a code change.
- A projection engine combining CPF LIFE payouts + a tax-minimising multi-year SRS withdrawal schedule (applying the 50% post-retirement concession) + investment drawdown into one retirement-income view.

**Implementation sketch.** Reuse the CPF LIFE estimator pattern (`overview/page.tsx`); `/api/srs` analogous to `/api/cpf`; build the projection on top of both. Build balances/contributions on **T7's ledger** rather than a point-in-time balance table (as `cpf_balances`/`cash_balances` do) so withdrawal/contribution history comes for free.

**Open questions.** Keeping bracket/relief tables current against annual SG Budget changes; projection depth (deterministic vs. Monte Carlo — the generic version is PL3); whether CPFIS gets full tracking or just contribution caps in v1.

---

## AC3 — Crypto depth

**Priority:** P3 · **Effort:** L · **Depends on:** — · **Type:** enhancement

**Goal.** Real crypto tracking beyond a single price.

**Current state / gap.** CoinGecko prices/sparklines; a single "crypto" asset type; no wallets, staking, or on-chain data.

**What's needed.** Multiple wallets/exchanges; staking rewards as income (T12); on-chain address import (balances); cost basis across venues.

**Implementation sketch.** A wallet dimension; address-based balance fetch via chain APIs; CoinGecko for price.

**Open questions.** Which chains; DeFi scope (defer).

---

## AC4 — Options / derivatives

**Priority:** P3 · **Effort:** L · **Depends on:** — · **Type:** enhancement

**Goal.** Track options positions.

**Current state / gap.** Equities/ETF/crypto/gold/RE only; no contracts, greeks, or expiry.

**What's needed.** An option instrument model (underlying, strike, expiry, type); P&L; assignment/expiry handling; a pricing source.

**Implementation sketch.** A new asset type + fields; manual or provider pricing.

**Open questions.** Complexity vs. demand — likely low priority for a tracking-first product.

---

## PL3 — Scenario & stress testing

**Priority:** P3 · **Effort:** L · **Depends on:** — · **Type:** enhancement

**Goal.** What-if analysis and projections.

**Current state / gap.** None; analytics are historical only.

**What's needed.** What-if add/remove positions; market-crash stress (apply shocks by asset/sector/geo); Monte Carlo projection of portfolio/net worth to a horizon (the generic engine behind T1's FIRE view).

**Implementation sketch.** A scenario engine over current positions + assumptions; charts.

**Open questions.** Assumption sourcing (vol/return); how much to expose to users.

---

## T2 — Household / shared portfolio view

**Priority:** P3 · **Effort:** L · **Depends on:** — · **Type:** enhancement, gap

**Goal.** Let a linked user (e.g. a spouse) grant another read access for a combined view — distinct from the admin oversight model (staff, not peer-to-peer).

**Current state / gap.** The role model (`src/lib/roles.ts`) is flat (`user`/`admin`/`superadmin`) with no relationship concept. RLS is already inconsistent — only `lots` and `user_settings` have an admin-read OR-clause; `cash_balances`, `cpf_balances`, `portfolio_snapshots`, and `holding_overrides` are self-only with no admin-read policy. `layout.tsx` hardcodes a single `user.id`; `context/portfolio.tsx` has no owner-tagging.

**What's needed.**

- A `household_links` table (`owner_id`, `viewer_id`, `status` pending/accepted).
- An `is_linked_viewer(target_user_id)` SECURITY DEFINER helper mirroring `is_admin()`.
- RLS policy additions on `lots`, `cash_balances`, `cpf_balances`, `portfolio_snapshots`, `holding_overrides`, `user_settings`.
- Data layer changes so `fetchHoldings`/`fetchSnapshots`/`fetchUserSettings` accept an array of user_ids and merge, tagging each row with `owner_id`/`ownerLabel`.
- An invite/accept flow and a merged-vs-per-person view toggle (owner colour-coding).
- Audit logging of cross-user access (`audit_log` exists — record who viewed whom).

**Implementation sketch.** Highest-risk item — RLS mistakes on financial data are the failure mode to design against. **Read-only sharing only** to start. Watch RSC read-path performance on the N-user fan-out.

**Open questions.** Pairwise links (couples) or arbitrary groups; revoke flow; whether a linked viewer sees CPF/SRS balances or only investment holdings; privacy of T15-synced positions.

---

# Roadmap (suggested build order)

The sort above is for triage. Actual execution should respect dependencies:

**Phase 1 — Correctness spine (P0):** T6 → T7 → T8, then T10 (land the sell-netting fix even before its cron). After this every number is trustworthy.

**Phase 2 — Visible value (P1):** T4 + T5 (quick wins, ship anytime), T9, T12, then T13.

**Phase 3 — Multi-broker (P1→P2):** T13 → T14 → T15. T14's dedup is the prerequisite that makes T15's sync idempotent.

**Phase 4 — Launch-enablers (P2):** early wins AN4 / AC6 / RE2, then T16 (easy once T6/T12 exist), T17 (prerequisite for any multi-user/paid launch), and T11 (splits-only first). The ★ enhancement set (AN1, IN1, AC1, UX1, RE1, SE1, AL1) slots in here — SE1 becomes mandatory the moment anyone but you uses it.

**Own track (P3):** T1 and T2 are security-sensitive (SG tax correctness; cross-user RLS) and deserve dedicated passes. The remaining P3 enhancements are pulled up individually as they reach the top of the queue.
