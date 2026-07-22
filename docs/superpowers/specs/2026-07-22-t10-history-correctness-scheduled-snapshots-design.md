# T10 — History Correctness + Scheduled Snapshotting (Design)

**Status:** Approved · **Date:** 2026-07-22 · **Backlog ref:** `docs/feature-backlog-scoping.md` T10 (P0)
**Companion spec:** `2026-07-22-daily-auto-refresh-design.md` (client-side first-visit refresh — the active-user counterpart to this spec's cron).

## Problem

The portfolio value-over-time series is wrong in three ways, and it only accrues when a user manually refreshes.

1. **Sold positions inflate history (historical rebuild).** In `src/app/api/holdings/backfill/route.ts` the per-date loop does `const active = holdings.filter((h) => h.buyDate <= date)` and then sums `h.units · histPrice · histFxRate` for every lot. It **never checks `transactionType`**, so a `sell` lot is *added* like a buy — a closed position keeps contributing its market value to history forever.

2. **The same bug exists in the live snapshot path.** `recordSnapshot` (`src/lib/supabase/data.ts`) sums per-lot `valueSGD`/`costSGD`/`fxGain` over the **raw** `holdings` array, and it is called with raw lots from `src/app/api/holdings/refresh/route.ts`. Every other aggregate in the app runs holdings through `toNetPositions()` first; this one does not, so today's live snapshot double-counts sells too. (The backlog only named the backfill bug; this is a second instance of it.)

3. **Inconsistent price basis.** Historical value uses EODHD `adjusted_close` (split- and dividend-adjusted), the Yahoo fallback (`fetchDailyCloses`) uses raw `close`, and `cost_sgd` uses the raw `buyPrice`. After any split or dividend these live on different scales, so value-vs-cost (and therefore gain) is distorted.

4. **No automatic accrual.** Snapshots are written only on the on-demand `POST /api/holdings/backfill` and on the manual refresh. No app open on a given day → no data point that day → a gappy series that T8's returns math inherits. There is no `vercel.json`; `pg_cron` is only commented out in migrations.

## Scope of this pass

One deliverable covering both halves:

- **(A) Correctness** — net-units-per-date in the historical rebuild, the same net-position fix in the live snapshot path, and a single consistent (raw) price basis.
- **(B) Scheduling** — a portable, secret-guarded internal route that snapshots every active user daily and backfills any missing days, callable by any scheduler.

Snapshots remain **holdings-only net-position market value**. Cash is *not* added to snapshots — T8 overlays the running cash balance at read time (`computeTotalValueSeries`), and that division of responsibility is preserved. **No `portfolio_snapshots` schema change.**

## Value model (unchanged from today, made correct)

A snapshot row stays `{ value_sgd, cost_sgd, fx_impact_sgd, fx_by_currency }`, holdings-only. The only change is *what units* feed it: the **net** position per instrument as of the snapshot date, at a **raw** price basis, instead of every raw lot at a mixed basis.

## New pure module: `src/lib/history.ts`

Mirrors the existing pure-logic pattern (`realized.ts`, `returns.ts`, `contributions.ts`) — no DB, no network, unit-testable in isolation.

```
netUnitsAsOf(lots: LotLite[], date: string) → number
```
`Σ buy.units (trade_date ≤ date) − Σ sell.units (trade_date ≤ date)`, floored at 0. `LotLite` is the minimal shape it needs (`transactionType`, `units`, `buyDate`, `buyPrice`, `buyFxRate`, `fees`, `currency`) — satisfied by `HoldingRow`.

```
computeSnapshotAsOf(
  lots: LotLite[],              // all lots for ONE user, any instruments
  date: string,
  priceOf: (ticker: string, date: string) => number,   // raw historical close, fill-forward applied by caller
  fxOf:    (ccy: string, date: string) => number,       // SGD-per-ccy, fill-forward applied by caller
) → { valueSgd: number; costSgd: number; fxImpactSgd: number; fxByCurrency: Record<string, number> }
```
This is `netAggregate` (from `group-holdings.ts`) time-sliced and re-priced. Per instrument, over the lots with `trade_date ≤ date`:
- `avgBuyPx` / `avgBuyFx` = value-weighted average over the **buy** lots as of `date` (sells never change average cost — same rule as `netAggregate`).
- `netUnits` = `netUnitsAsOf(...)`; instruments with `netUnits ≤ 0` contribute nothing.
- `value += netUnits · priceOf(ticker,date) · fxOf(ccy,date)`
- `cost  += netUnits · (avgBuyPx + avgFeePerUnit) · avgBuyFx` (fee-per-unit averaged over buy units, matching `netAggregate`'s `costSGD`)
- `fxImpact += netUnits · avgBuyPx · (fxOf(ccy,date) − avgBuyFx)` for non-SGD, accumulated into `fxByCurrency[ccy.toLowerCase()]`.

Untickered physical assets (ticker `—`, e.g. Gold/RE) use their `buyPrice` as `priceOf` — the caller wires this, matching today's `h.ticker === "—" ? h.buyPrice : …` branch.

## Shared snapshot-build core: `src/lib/snapshots/build.ts`

The on-demand backfill and the cron need the same machinery (fetch prices/FX for a window, fill-forward, assemble rows), differing only in *which users* and *which date range*. Extract it once so both call it and stay in sync.

```
buildSnapshotRows(params: {
  userId: string;
  lots: HoldingRow[];              // that user's lots
  dates: string[];                 // the dates to (re)build
  prices: Record<string, Record<string, number>>;   // ticker → date → raw close (fill-forward already applied)
  fx: Record<string, Record<string, number>>;        // date → ccy → SGD-per-ccy (fill-forward already applied)
}) → SnapshotRow[]
```
Loops `dates`, calls `computeSnapshotAsOf`, rounds to integers, returns rows ready to upsert. The provider-fetch + fill-forward helpers currently inline in `backfill/route.ts` (`fetchEohdHistory`, `fetchFxHistory`, `dateRange`, `fillForward`, EODHD remap, the FX-cache top-up) move into this module (or a sibling `fetch.ts`) so both callers share one implementation. The on-demand route becomes a thin wrapper: fetch over `[earliestLot … today]`, `buildSnapshotRows`, upsert.

## Backfill route refactor (`src/app/api/holdings/backfill/route.ts`)

The value-assembly loop (currently lines ~260–296) is replaced by `buildSnapshotRows`. All provider-fetching, FX-cache top-up, and fill-forward logic is preserved but relocated to the shared module. Behaviour is unchanged **except** the two correctness fixes: net-units-per-date, and raw basis. Rate limiting, auth, and the "recompute full range so back-dated lots fold in" behaviour stay.

## Live snapshot fix (`recordSnapshot`)

`recordSnapshot(userId, holdings)` computes over `toNetPositions(holdings)` instead of the raw array. This path only ever writes **today's** row, so it correctly pairs today's price with today's FX rate — the net position already carries correct `valueSGD`/`costSGD`/`fxGain` from live quotes (raw) at the day's current FX, so the existing sum-reduce is correct once fed net positions. (The *historical* rebuild is the separate path above and uses each date's **own** FX via `fxOf(ccy, date)` — today's rate is never applied to past dates.) The two call sites in `refresh/route.ts` are unchanged. This closes the live double-count with a one-function change.

### Snapshot dating: SGT, not UTC

`recordSnapshot` currently keys `recorded_date` off `new Date().toISOString().slice(0, 10)` — **UTC**. The whole snapshot model (and the companion auto-refresh spec) reasons in **SGT**, so a snapshot written between 00:00–08:00 SGT would be labelled the previous UTC day and mismatch the SGT "today", causing redundant refreshes near the boundary. Fix: a shared `sgtDate(d?: Date): string` helper (`src/lib/dates.ts`) returns the `Asia/Singapore` calendar date as `YYYY-MM-DD`, and **`recordSnapshot`, the cron's "today", and the backfill's `today`** all use it. Going forward every write is SGT-dated; the on-conflict key stays `(user_id, recorded_date)`. (Pre-existing UTC-dated rows are untouched; the next full backfill rebuilds on the SGT grid.)

## Price basis: raw / unadjusted everywhere

- `fetchEohdHistory` reads `close` (not `adjusted_close`).
- Yahoo `fetchDailyCloses` already returns raw `close` — unchanged.
- Cost uses raw `buyPrice` — unchanged.

All three align on the same (raw) scale, so gains are correct for un-split positions. **Documented limitation:** across a stock split whose units the user has not manually adjusted, the raw price steps down while stored units stay flat, so the value line shows a one-day artifact until the user edits units (today's manual model). Full automatic split adjustment is **deferred to T11** (corporate actions); this spec deliberately does not pull that unbuilt dependency in.

## Scheduled snapshot (portable)

**New route: `POST /api/internal/snapshot-all`.**
- **Auth:** a shared secret compared (constant-time) against `process.env.CRON_SECRET` — accepted either as an `x-cron-secret` header (arbitrary callers) **or** as an `Authorization: Bearer <secret>` token (the convention Vercel Cron injects, since it cannot send a custom header). Any mismatch or missing secret → `401`. This is *not* a user cookie/session — it is a service trigger. Runs its DB work through the service-role admin client.
- **No Vercel-specific APIs** — a standard Next.js route handler that runs on any Node host, so the trigger stays swappable and the future phone-app backend can call it too. `maxDuration = 60` as with the backfill.

**Algorithm:**
1. `fetchActiveUserIds()` — new query: distinct `user_id` from `lots` via the admin client.
2. Refresh **once, deduped across all users:** collect every distinct instrument symbol across all active users' lots, refresh any whose shared `ticker_quotes` are stale (reusing the existing live-price path), and refresh FX once. This keeps the shared cache warm without per-user provider fan-out (bounds cost; the per-user quota work is T17, out of scope here).
3. Determine the **global backfill window**. Each user's per-user window starts at `lastSnapshotDate + 1`, or at their `earliestLot` date if they have no snapshots. The global fetch window is `min(over all users)(per-user window start) … today` — so a cold-start user's older history is covered rather than under-fetched. Fetch each distinct instrument's daily closes and FX for that window **once**, build fill-forward maps.
4. For each user, `buildSnapshotRows` over **that user's own missing dates** (`lastSnapshotDate+1 … today`, or `earliestLot … today` if the user has no snapshots), then upsert into `portfolio_snapshots` (`onConflict: user_id,recorded_date`).

**Records:** every missing day per user, not just today — self-heals a missed cron run, an outage, or a back-dated lot. In steady state (cron ran yesterday) the per-user window is a single day.

**Cold-start bound:** a user with zero snapshots and an old first lot gets a full-history build on the first cron pass; `maxDuration` caps a single invocation, and the deduped-per-instrument fetch keeps provider calls proportional to *instruments*, not *user·days*. If cold-start cost ever bites, capping the per-user window to a trailing N days is a one-line change — noted, not implemented.

**Trigger (swappable, config not code).** The route is the contract. Ship one **example** trigger in-repo:
```json
// vercel.json
{ "crons": [{ "path": "/api/internal/snapshot-all", "schedule": "0 21 * * *" }] }
```
`21:00 UTC` ≈ shortly after US market close (~05:00 SGT next day), capturing both SGX and US closes for the SGT calendar day. Because Vercel Cron cannot send a custom header, if that trigger is used the route must **also** accept Vercel's built-in `Authorization: Bearer $CRON_SECRET` convention (Vercel injects it) — so the guard checks *either* `x-cron-secret` *or* the bearer token against `CRON_SECRET`. The spec documents equivalent drop-in triggers — a GitHub Actions scheduled workflow, an external cron service (cron-job.org), a self-hosted scheduler, or the phone-app backend — each just issuing an authenticated POST. Swapping schedulers is a config change.

## Testing

`src/lib/history.test.ts` (pure, no DB/network):
- **buy-then-partial-sell:** after a partial sale, `netUnitsAsOf` and `computeSnapshotAsOf` value/cost reflect the reduced quantity at the unchanged average cost; before the sale date, the full quantity.
- **fully-closed position:** net units reach 0 on/after the final sell date → contributes nothing to value or cost.
- **back-dated lot:** a lot with an earlier `trade_date` appears in snapshots from that date forward.
- **multi-currency FX impact:** `fxImpactSgd` and `fxByCurrency` accumulate correctly for a non-SGD holding as the historical FX rate diverges from the buy rate.
- **untickered physical asset:** priced off `buyPrice`, no market lookup.

`src/lib/snapshots/build.test.ts` (optional, if the fill-forward/window logic is non-trivial after extraction): fill-forward carries the last known price/FX across weekend gaps; the window excludes dates before the earliest lot.

## API / data-flow summary

- New: `POST /api/internal/snapshot-all` (secret-guarded, admin client).
- New: `fetchActiveUserIds()` in `data.ts`.
- New: `src/lib/history.ts`, `src/lib/snapshots/build.ts` (+ relocated fetch/fill-forward helpers), `src/lib/dates.ts` (`sgtDate`).
- Changed: `backfill/route.ts` (delegates to shared core; raw basis; SGT `today`), `recordSnapshot` (net positions; SGT date), `fetchEohdHistory` (raw `close`).
- New env: `CRON_SECRET`. New file: `vercel.json` (example trigger).
- Unchanged: `portfolio_snapshots` schema, `fetchSnapshots`, `refresh/route.ts` call sites, T8's read-time cash overlay.

## Explicitly out of scope

- **T11 corporate actions / automatic split adjustment** — the raw-basis limitation above is accepted for this pass.
- **Adding cash to snapshots** — owned by T8's read-time overlay.
- **Per-user provider-cost quotas (T17)** — the cron bounds cost via deduped-per-instrument fetches, but no per-user accounting is added.
- **A dedicated UI surface** — this spec fixes the data feeding existing charts; no new chart/view.
- **Client-side first-visit refresh** — the companion spec `2026-07-22-daily-auto-refresh-design.md`.
