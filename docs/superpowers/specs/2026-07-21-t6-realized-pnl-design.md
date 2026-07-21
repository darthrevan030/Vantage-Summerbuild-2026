# T6 — Realized P&L + Cost-Basis Engine (Design)

**Status:** Approved · **Date:** 2026-07-21 · **Backlog ref:** `docs/feature-backlog-scoping.md` T6 (P0, keystone)

## Problem

`netAggregate` (`src/lib/group-holdings.ts`) computes average buy price as `pxWeighted / buyUnits`; sell lots only increment `sellUnits` — the stored sale price/date/fx is read into the loop but never used for any gain calculation. `toNetPositions` drops any position with `netUnits <= 0`, so a fully-exited ticker disappears from every total and view, and its realized profit/loss is unrecoverable in the UI. There is no cost-basis method selector (average is implicitly hardcoded), and lot `fees` are stored but never enter any gain calculation anywhere in the codebase — for open positions either.

## Goals

1. Record realized gain/loss when a sell lot is matched against prior buy lot(s), under a user-selectable cost-basis method (FIFO / Average / Specific-lot).
2. Keep closed positions visible (a dedicated view), excluded from live value/allocation totals but rolled into a lifetime realized-gains figure.
3. Fold `fees` into both the new realized-gain calculation *and* the existing unrealized-gain calculation (today's `computeAssetGainSGD`/`computeCostBasisSGD`/`computeFxGainSGD` in `src/lib/fx.ts` ignore fees entirely).
4. Backfill realized data for sells that already exist in the database.

## Data model

New table, migration `supabase/migrations/20260721XXXXXX_realized_lots_and_cost_basis_method.sql`:

```sql
CREATE TABLE realized_lots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  instrument_id     uuid NOT NULL REFERENCES instruments(id),
  sell_lot_id       uuid NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  buy_lot_id        uuid NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  method            text NOT NULL CHECK (method IN ('fifo','average','specific')),
  matched_quantity  numeric NOT NULL CHECK (matched_quantity > 0),
  matched_buy_price numeric NOT NULL,
  matched_buy_fx    numeric NOT NULL,
  sell_price        numeric NOT NULL,
  sell_fx           numeric NOT NULL,
  asset_gain_sgd    numeric NOT NULL,
  fx_gain_sgd       numeric NOT NULL,
  realized_date     date NOT NULL,
  created_at        timestamptz DEFAULT now()
);
-- RLS: mirror `lots` ("own rows" ALL policy + admin-read), indexes on user_id, instrument_id, sell_lot_id, buy_lot_id.
```

Design decisions:
- **Frozen snapshot, not a live join.** `matched_buy_price`/`matched_buy_fx`/`sell_price`/`sell_fx` are copied at match time so editing the original lots afterward never retroactively corrupts realized history.
- **`buy_lot_id` is `ON DELETE RESTRICT`.** A buy lot that has been matched can't be deleted; editing its quantity below the already-matched sum is rejected (409, mirrors the existing sole-holder-instrument 409 pattern in `updateInstrumentForLot`). `sell_lot_id` cascades — deleting a sell removes its realized record.
- **Uniform schema across all 3 methods.** Even `average`-method sells produce multiple rows (one per contributing open buy lot, quantity-weighted) — average cost is FIFO/pro-rata matching with a different lot-selection rule, so one schema covers all three. `method` is stored per-row so changing the default later doesn't rewrite history.
- **Written once, at sell-commit time.** No lazy/background recomputation. A sell locks in matches against whatever's open *right now*, using whatever method is in effect *right now*.

`user_settings.cost_basis_method text NOT NULL DEFAULT 'fifo' CHECK (IN ('fifo','average','specific'))` — added in the same migration, with the `GRANT INSERT (...)`/`GRANT UPDATE (...)` column lists on `user_settings` re-issued to include it (same pattern `20260610025339_security_hardening.sql` used for `display_name`/`base_currency`).

## Fee convention (applies to both realized and unrealized gain)

Fees are valued in SGD at their own transaction's FX rate and folded entirely into the **asset** gain component (not FX gain) — a fee is a fixed historical outlay, not something with ongoing FX exposure to decompose.

```
// Unrealized (open lot) — replaces computeCostBasisSGD/computeAssetGainSGD in src/lib/fx.ts:
costSGD    = (units·buyPrice + fees)·buyFx
assetGain  = units·(curPx − buyPrice)·curFx − fees·buyFx
fxGain     = units·buyPrice·(curFx − buyFx)              // unchanged
// assetGain + fxGain still telescopes exactly to valueSGD − costSGD

// Realized (matched pair) — same shape with sell terms replacing "current":
assetGain  = qty·(sellPrice − matchedBuyPrice)·sellFx − sellFeeAlloc·sellFx − buyFeeAlloc·matchedBuyFx
fxGain     = qty·matchedBuyPrice·(sellFx − matchedBuyFx)
```

Fee allocation across multiple matches is pro-rated by quantity fraction: `buyFeeAlloc = buyLot.fees × (matchedQty / buyLot.quantity)`, `sellFeeAlloc = sellLot.fees × (matchedQty / sellLot.quantity)`. Every unit of a lot's quantity gets exactly one such fraction (summing to 1 across all matches, plus any open remainder for buy lots), so fees are always fully and exactly accounted for.

Fees are assumed denominated in the lot's own currency (same currency as `price`), consistent with how `price`/`fx_rate` already combine — no separate fee-currency field.

## Matching algorithm

New file `src/lib/realized.ts`:

```
matchSell(sellLot, openBuyLots[], method, manualAllocations?)
  → Array<{ buyLotId, matchedQty }>
```

- `fifo`: sort open buy lots by `trade_date` ascending, consume oldest-first.
- `average`: consume proportionally across all currently-open buy lots, weighted by each lot's remaining open quantity (reproduces today's blended-average cost for the matched slice).
- `specific`: use `manualAllocations` verbatim (from the sell-form lot-picker), validated to sum to the sell quantity and not exceed any lot's remaining open quantity.

"Open quantity" for a buy lot = `lot.quantity − Σ(matched_quantity in realized_lots for that buy_lot_id)`, computed fresh at match time.

## Method selection UX

- **Global default**: `cost_basis_method` set on the Settings page (FIFO / Average / Specific-lot).
- **Per-sell override**: the sell form can override the default for that one sale. If the effective method is `specific` (by default or override), a lot-picker appears listing open buy lots (date, remaining qty, price, currency) with per-lot quantity inputs, validated client-side to sum to the sell quantity. FIFO/Average need no extra UI — sell proceeds exactly as today.

## API changes

- **`POST /api/holdings`** (sell path): after inserting the sell lot, fetch open buy lots for `(user_id, instrument_id)`, resolve the effective method (request override → `user_settings.cost_basis_method` → `'fifo'`), run `matchSell`, insert the resulting `realized_lots` rows in the same request. New optional body field `lot_allocations?: [{ buyLotId, qty }]`, required only when the effective method is `specific`.
- **`DELETE /api/holdings/[id]`**: buy lot with existing matches → 409 (`"matched"`, mirrors the existing `"shared"` pattern). Sell lot → cascades its `realized_lots` automatically.
- **`PATCH /api/holdings/[id]`**: buy lot quantity edited below its matched sum → 409. Sell lot edited (price/quantity/date) after it already has realized rows → delete its existing `realized_lots` and re-run matching against currently-open buy lots (the one place recomputation happens, triggered by the edit itself, not lazily).
- **`POST /api/holdings/reconcile-realized`** (new route): walks a user's sell lots in `trade_date` order, skips any that already have `realized_lots` rows, matches the rest using the resolved method. Idempotent; called once per page load from the dashboard layout server component (cheap existence check, no-op after the first real run). A historical sell that overdraws available buy quantity (bad legacy data) is matched as far as possible and flagged rather than failing the whole backfill.
- **`src/lib/portfolio.ts`**: new `computeRealizedSummary(realizedLots)` → lifetime realized total + per-instrument closed-position rows (ticker, total qty sold, lifetime realized gain with asset/fx split, last sale date). Threaded through `(dashboard)/layout.tsx` → `DashboardShell` → `PortfolioProvider`, exposed via `usePortfolio()` as `realizedLots`/`closedPositions`.
- `HeroStats` gains a `realizedGain` field (lifetime sum); the existing `totalGain` is renamed `unrealizedGain` (same computation — from `toNetPositions` only — now fee-aware per the convention above).

## UI changes

- **Settings page**: new "Cost-basis method" selector, written via the existing settings PATCH pattern.
- **Sell form** (`DetailCard` in `holdings/page.tsx`): lot-picker as described above, shown conditionally.
- **Holdings page**: new **Open / Closed** sub-tabs (structural, not a third toggle state on the existing Flat/Grouped control). "Closed" lists one row per fully-exited ticker sourced from `computeRealizedSummary`; excluded from all value/allocation totals (already true today via `toNetPositions`'s filter).
- **Overview hero**: split the current "Total Gain" tile into two sibling tiles — **Unrealized Gain** (renamed, same computation, now fee-aware) and **Realized Gain** (new, lifetime total). `NerveBar` gets the same two fields.

## Edge cases

- Selling more than currently open: 400 at the API, same validation tier as today's format checks.
- `specific` allocations that don't sum to the sell quantity, or overdraw a single lot: 400.
- Backfill hitting a historical sell that overdraws (bad legacy data): partial-match + flag, not a hard failure.

## Explicitly out of scope for this pass

- Sector/geo-based concentration metrics, benchmark comparison, tax reporting — later backlog items (AN4, T9, T16) that depend on this one.
- Any change to `src/lib/positions.ts` (`groupIntoPositions`/`Position`) — confirmed dead code elsewhere in the app; not touched.
