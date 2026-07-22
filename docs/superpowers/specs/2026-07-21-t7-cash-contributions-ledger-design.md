# T7 — Cash & Contributions Ledger (Design)

**Status:** Approved · **Date:** 2026-07-21 · **Backlog ref:** `docs/feature-backlog-scoping.md` T7 (P0)

## Problem

`cash_balances` is `(user_id, currency, amount)` — one mutable balance per currency, set via full-replace (`PATCH /api/cash`, and the `CashForm` UI in `add/page.tsx`). There's no history, no dates, no source, no broker, and no transfer concept. You cannot answer "how much have I put in?" or "what was my cash on date X?". `portfolio_snapshots.cost_sgd` is not money deposited — a DRIP-reinvested dividend raises cost with no deposit, and a sold-and-not-repurchased position removes its cost from the sum even though the original deposit happened. T8 (correct TWR/MWR returns) needs a real, dated stream of external cash flows, which nothing today provides.

## Goals

1. A `cash_transactions` ledger recording every cash-affecting event with a date, type, currency, amount, broker, source, and note.
2. `netContributions(userId, asOf?)` — the SGD sum of external capital the user has put in, for T8.
3. Buy/sell lots auto-derive matching cash entries so the ledger reconciles with holdings activity, gated by a per-user toggle.
4. Preserve existing `cash_balances` data (migrate it, don't discard it) and give existing users with lots but no cash history a reasonable non-zero contribution baseline.
5. Replace the "set my balance" `CashForm` with a real transaction-logging form.

## Data model

New table, migration `supabase/migrations/20260721140000_cash_transactions_ledger.sql`:

```sql
CREATE TABLE cash_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  lot_id            uuid REFERENCES lots(id) ON DELETE CASCADE,
  transfer_group_id uuid,
  date              date NOT NULL,
  type              text NOT NULL CHECK (type IN ('deposit','withdrawal','transfer','fee','dividend_cash','buy','sell')),
  currency          text NOT NULL,
  amount            numeric NOT NULL,           -- signed: positive = cash in, negative = cash out
  fx_rate           numeric NOT NULL DEFAULT 1,  -- SGD per unit of currency, same convention as lots.fx_rate
  broker            text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT '',    -- fund source: CPF | SRS | Cash | '' (same meaning as lots.source)
  note              text,
  created_at        timestamptz DEFAULT now()
);
-- RLS: mirror realized_lots — own-rows ALL policy + admin-read via public.is_admin().
-- Indexes: user_id, lot_id, transfer_group_id.
```

`user_settings.track_cash boolean NOT NULL DEFAULT true` — added in the same migration, with the `user_settings` GRANT column lists re-issued in full (same gotcha as T6's `cost_basis_method`).

**Data migration (same file):** every existing `cash_balances` row becomes one `deposit`-type `cash_transactions` row (`amount` = the existing balance, `date` = migration run date, `fx_rate` = looked up from `currencies.rate_sgd` at migration time, `note` = `'migrated from cash_balances'`). This preserves real user-entered data rather than discarding it when `cash_balances` is dropped.

`cash_balances` table itself is dropped at the end of the migration, after the data copy — no code should reference it going forward.

## Auto-derive (buy/sell → cash)

- Gated by `user_settings.track_cash` (default `true`).
- On `POST /api/holdings` (buy or sell): if `track_cash` is on, insert a matching `cash_transactions` row — `type: 'buy'` or `'sell'`, `lot_id` = the new lot's id, `currency`/`fx_rate`/`broker`/`date` copied from the lot, `amount` = `-(units·price + fees)` for a buy, `+(units·price − fees)` for a sell (same fee-folding convention as `computeCostBasisSGD`/realized-gain math).
- On `PATCH /api/holdings` (lot edited): if the lot has an auto-derived `cash_transactions` row (`lot_id` match) and the edit touches quantity/price/fx/date/fees, delete and recreate that row from the updated lot — never leaves it stale.
- On `DELETE /api/holdings`: the row cascades automatically via `ON DELETE CASCADE` on `lot_id` — no app-level guard needed (auto-derived rows aren't a correctness-critical historical record the way `realized_lots` is; they just mirror the lot).
- Manually-entered types (`deposit`/`withdrawal`/`transfer`/`fee`/`dividend_cash`) never get a `lot_id` and are never auto-modified.

## `netContributions` formula

```
netContributions(userId, asOf?) =
  Σ over cash_transactions where type IN ('deposit','withdrawal') [and date <= asOf, if given]
    of amount · fx_rate, converted to SGD
```

`buy`/`sell`/`dividend_cash`/`fee`/`transfer` are explicitly excluded:
- `buy`/`sell` are internal asset↔cash swaps, not external capital — this is the whole reason cash tracking exists instead of reusing `cost_sgd`.
- `dividend_cash` is portfolio-generated income, not user-contributed capital.
- `fee` is performance drag already reflected in the ending cash balance — counting it again as a withdrawal would double-count it against returns.
- `transfer` nets to zero across its two linked rows and never crosses the portfolio boundary.

## Transfers

Represented as two `cash_transactions` rows sharing one `transfer_group_id`: one `type='transfer'` row with a negative amount at the source `broker`, one with a positive amount at the destination `broker`, same `currency`/`date`. The UI creates both in one request; deleting one should delete its pair (same `transfer_group_id`).

## Legacy backfill (beyond the cash_balances migration)

For a user who has lots but, even after the `cash_balances` migration above, still has **zero** `cash_transactions` rows (never touched the old cash feature at all) and has `track_cash` on: seed one lump `deposit` = the SGD sum of cost basis (`units·price·fx_rate + fees·fx_rate`) across every buy lot the user has ever entered, open or closed, dated at their earliest lot's `trade_date`. Runs once, idempotently, from the dashboard server layout — same pattern as T6's `reconcileRealizedLots` (check-then-seed on every load, no-op after the first real run).

## API surface

- `GET /api/cash` — same response shape as today (`{currency, amount}[]`): `SELECT currency, SUM(amount) FROM cash_transactions WHERE user_id = ... GROUP BY currency` (balances stay in their native currency, same as today — no SGD conversion here, that only happens client-side via `baseFxRates` same as now). Existing Overview cash card needs no change.
- `POST /api/cash` — logs one manual transaction (`deposit`/`withdrawal`/`fee`/`dividend_cash`), or two linked rows for a `transfer`.
- `PATCH /api/cash` (existing full-replace-balance route) is removed — replaced by `POST`.
- `GET /api/cash/transactions` — the full ledger list, newest first (needed by the redesigned `CashForm` to show existing entries, and any future per-broker/history view).
- `DELETE /api/cash?id=...` — deletes one manual entry (or both rows of a transfer pair, matched by `transfer_group_id`). Auto-derived (`lot_id` set) rows can't be deleted directly here — they only go away when their originating lot is deleted.

## UI changes

`CashForm` (`add/page.tsx`) is redesigned from "set my current balance" to "log a transaction": a type selector (Deposit / Withdrawal / Transfer / Fee / Dividend cash — no Buy/Sell, those are auto-only), amount, currency, date, broker, optional note. A transfer additionally asks for a destination broker. The form also lists recent entries (from `GET /api/cash/transactions`) with a delete action.

## Explicitly out of scope for this pass

- Per-broker cash *view* (the backlog's T13 item) — this pass only makes broker-tagged data exist on each row; a dedicated per-broker breakdown UI is a later item.
- A "fees paid" or income report — `fee`/`dividend_cash` data is recorded but not yet surfaced in any dedicated report.
- Feeding `netContributions` into T8 (XIRR/TWR) — T8 is a separate, later backlog item; this pass only makes the function exist and be correct.
