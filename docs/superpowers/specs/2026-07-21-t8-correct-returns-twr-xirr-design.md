# T8 — Correct Returns: TWR + MWR/XIRR (Design)

**Status:** Approved · **Date:** 2026-07-21 · **Backlog ref:** `docs/feature-backlog-scoping.md` T8 (P0, depends on T7)

## Problem

`computePortfolioAnalytics` (`src/lib/portfolio.ts`) computes daily returns as `series[i].value / series[i-1].value − 1` straight off `portfolio_snapshots.value_sgd`, and CAGR as `computeCAGR(first.value, last.value, years)` — both cash-flow-naive. `portfolio_snapshots.value_sgd` is holdings-only (`recordSnapshot` sums `HoldingRow.valueSGD`, never touches cash) — so a raw deposit sitting in cash doesn't distort this series, but a **buy** does: it immediately inflates `value_sgd` by the purchase amount, which the naive return calc misreads as organic growth rather than deployed capital. Sharpe/vol/drawdown all inherit this distortion. There is no XIRR/MWR anywhere.

## Value model

Redefine "portfolio value" for return-calculation purposes as **holdings value + cash balance** (total net worth), computed by overlaying a running cash balance (reconstructed from T7's `cash_transactions`) onto the existing holdings-only snapshot series — **no change to `recordSnapshot` or the `portfolio_snapshots` schema**, purely a read-time overlay.

Under this model:
- Buy/sell become pure internal reallocations (cash ⇄ asset) — no special exclusion needed, they net to ~zero effect on total value at the time of trade.
- Dividends (`dividend_cash`) and fees flow through naturally as real increases/decreases in cash balance, correctly counted as return, no special-casing.
- The only genuine external flows are `deposit`/`withdrawal` — exactly what the backlog doc originally intended TWR to break on.

## New module: `src/lib/returns.ts`

Mirrors the existing pure-logic pattern (`realized.ts`, `contributions.ts`).

```
computeTotalValueSeries(snapshots: SnapshotRow[], cashTransactions: CashTransaction[])
  → { date: string; value: number; cost: number }[]
```
For each snapshot date, adds the running cash balance as of that date (cumulative sum of `amount·fxRate` over all `cashTransactions` with `date <= snapshotDate`) to `valueSgd`. `cost` passes through unchanged from the snapshot (cost basis is a holdings-only concept, unaffected by cash).

```
computeTWR(series: {date, value}[], flows: {date: string; amountSgd: number}[]) → number
```
Buckets `flows` by day, breaks `series` into consecutive-day sub-periods, computes `r_i = (V_i − F_i) / V_{i-1} − 1` per sub-period (F_i = net flow SGD on day i, 0 if none), geometrically links: `Π(1 + r_i) − 1`. Returns the raw (non-annualised) cumulative TWR over the full series span.

```
annualise(cumulativeReturn: number, days: number) → number
```
`(1 + cumulativeReturn) ** (365 / days) − 1` — same shape as today's `computeCAGR`, applied to TWR instead of a raw value ratio. This annualised figure replaces CAGR's slot in `PortfolioAnalytics`/the UI.

```
computeXIRR(flows: {date: string; amountSgd: number}[]) → number
```
Newton-Raphson (initial guess `0.1`, tolerance `1e-7`, max 100 iterations), falling back to bisection over `[-0.9999, 10]` if Newton fails to converge or the derivative is ~0. Solves for `r` such that `Σ CFᵢ / (1+r)^((tᵢ−t₀)/365) = 0`.

```
buildXirrFlows(
  cashTransactions: CashTransaction[],
  endingValueSgd: number,
  endingDate: string,
  scope?: { broker?: string; source?: string },
) → { date: string; amountSgd: number }[]
```
Filters `cashTransactions` to the types relevant for the given scope, **sign-flips to investor convention** (opposite of `cash_transactions.amount`'s own "cash into the account" convention — a deposit becomes a *negative* flow, a withdrawal/transfer-in becomes *positive*, matching the standard XIRR convention `[−deposits, +withdrawals, +endingValue]`), and appends a final `+endingValueSgd` flow at `endingDate`:
- No `scope` (portfolio-wide): `type IN ('deposit', 'withdrawal')` only — transfers net to zero across their paired legs and buy/sell are internal, so both are excluded, matching `computeNetContributions`'s existing exclusion set exactly.
- `scope.broker` (per-broker): `type IN ('deposit', 'withdrawal', 'transfer')` filtered by `broker === scope.broker` — a transfer is external to *this* broker even though internal to the whole portfolio, so it must count here (the paired opposite-signed leg lives at the other broker and correctly appears in that broker's own flow list, not this one).
- `scope.source` (per fund-source: CPF/SRS/Cash): `type IN ('deposit', 'withdrawal')` filtered by `source === scope.source`. Transfers currently carry no `source` tag (T7's `insertTransferPair` writes `source: ""` on both legs) — they simply won't bucket into any specific source's XIRR, falling into the same "untagged" treatment `computeAllocationBySource` already applies elsewhere. Not fixed in this pass.

## Per-broker / per-source XIRR

Computed using each scope's own flows (via `buildXirrFlows`) plus that scope's **current** ending value — `holdings value at scope + cash balance at scope`, both fully derivable today from `HoldingRow[]` (already carries `broker`/`source`) and `CashTransaction[]` (same fields), no historical per-scope series required (XIRR only needs dated flows + one final value, unlike TWR which needs the full series). Returned as `{ broker: string; xirr: number }[]` and `{ source: string; xirr: number }[]`, computed in `portfolio.ts` (needs both holdings and cash transactions, same shape as T6's `computeRealizedSummary`).

## Sharpe / volatility / drawdown / best-worst-day

Recomputed from the flow-adjusted daily sub-period returns (`r_i`, the same series `computeTWR` computes internally) rather than the naive `value[i]/value[i-1]-1`. `computeSharpeRatio` itself is unchanged — it already takes a plain `dailyReturns: number[]`; only the returns fed into it change.

## `PortfolioAnalytics` shape changes

- `cagr` → repurposed to hold the **annualised TWR** value (same field name kept for now to minimize UI churn, semantically redefined — the raw naive CAGR calculation is removed, not kept alongside).
- New: `xirr: number` (portfolio-wide).
- New: `xirrByBroker: { broker: string; xirr: number }[]`, `xirrBySource: { source: string; xirr: number }[]`.
- `actualSharpe`, `annualisedVol`, `maxDrawdown`/`maxDrawdownDate`, `bestDayReturn`/`bestDayDate`, `worstDayReturn`/`worstDayDate`, `days`, `series` — all retained, now computed from the flow-adjusted series/returns.

## API / data flow

`computePortfolioAnalytics(snapshots, cashTransactions, holdings)` gains two parameters. `GET /api/portfolio/analytics` fetches `fetchCashTransactions` and `fetchHoldings` alongside the existing `fetchSnapshots` call, passing all three through.

## UI changes

Charts page `AnalyticsCards`: the "CAGR" card's label changes to "TWR" (tooltip updated to describe annualised, flow-adjusted return); a new "XIRR" card is added alongside it. Sharpe/Volatility/Max Drawdown/Best-Worst-Day cards keep their exact position and appearance — only the numbers underneath change. Per-broker/per-source XIRR breakdowns are **not** given a new dedicated UI surface in this pass (no such view was requested) — the data exists on the API response for a future consumer.

## Fallback / edge cases

- T7's legacy-seed backfill guarantees virtually every user with any lots has ≥1 deposit-type cash transaction, so the existing `a.days < 2` empty-state guard (already in `AnalyticsCards`) covers the true no-data case — no separate "unadjusted" UI state is needed beyond what already exists.
- A sub-period with zero prior value (`V_{i-1} <= 0`) is skipped in the TWR link, mirroring how `computePortfolioAnalytics` already guards `prev > 0` for its naive daily-return loop.
- XIRR with fewer than 2 flows (e.g., a single ending-value flow with no deposits at all) returns `0` rather than attempting to solve — mirrors `computeSharpeRatio`'s `< 2` guard pattern.

## Explicitly out of scope for this pass

- Per-holding XIRR (the backlog doc mentions it; feasible with the same current-value + own-flows approach, but not requested for v1 here — a clean follow-up).
- Fixing `transfer` rows' missing `source` tag (a T7 gap, not this feature's to fix).
- Any new UI surface for `xirrByBroker`/`xirrBySource` beyond exposing the data on the existing API response.
- Sub-year annualisation edge cases beyond the existing `(1+r)^(365/days)-1` convention already used by `computeCAGR`.
