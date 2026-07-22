# T7 — Cash & Contributions Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mutable `cash_balances` snapshot with a real `cash_transactions` ledger (deposits/withdrawals/transfers/fees/dividend cash, plus auto-derived buy/sell entries), so the app can compute `netContributions` (the return-denominator T8 needs) and show a real cash history — without losing existing user-entered balance data.

**Architecture:** A new `cash_transactions` table is the single source of truth; `cash_balances` is migrated into it (as deposit rows) and dropped. Buy/sell lots auto-derive a linked `cash_transactions` row (gated by `user_settings.track_cash`, default on) via the same `POST`/`PATCH /api/holdings` handlers T6 already extended. A pure `src/lib/contributions.ts` module computes `netContributions` and the legacy cost-basis-based seed amount for users who never used the old cash feature at all. `GET /api/cash` keeps its existing response shape (computed live via a grouped sum) so the Overview cash card needs no change; the manual-entry `CashForm` is redesigned from "set my balance" to "log a transaction."

**Tech Stack:** Next.js 16 App Router (server components + route handlers), Supabase (Postgres + RLS), TypeScript strict, Vitest (already set up).

## Global Constraints

- TypeScript strict mode — every new/changed file must type-check with `npx tsc --noEmit` (zero errors repo-wide after each task, same standard as T6).
- No comments except where a hidden constraint or non-obvious invariant would otherwise be lost.
- All monetary values are computed in SGD internally where SGD totals are needed; native-currency balances stay in their own currency (matches the existing `cash_balances`/Overview convention — `GET /api/cash`'s response is native-currency amounts, converted to SGD only client-side via `baseFxRates`).
- **Sign convention (load-bearing, document this wherever `cash_transactions.amount` is touched): `amount` is always signed — positive means cash flowing IN, negative means cash flowing OUT.** This is what makes `SUM(amount) GROUP BY currency` give the correct balance regardless of transaction type, with no per-type special-casing needed at read time.
- Every new Supabase migration follows the existing idempotent pattern: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`.
- Pages read derived data from `usePortfolio()` context populated by the server layout — never fetch core portfolio data client-side in a page component. (The redesigned `CashForm`'s own transaction list is an exception, matching the existing `CashForm`/`CpfForm` client-fetch pattern already used in `add/page.tsx` for exactly this kind of self-contained sub-form.)
- After any mutation (POST/PATCH/DELETE), the client calls `router.refresh()`.
- Migrations in this repo are applied to the hosted Supabase project by a human operator — there is no local Supabase CLI project linked in this environment. Flag this clearly when the migration task lands.
- Fund-source semantics: `cash_transactions.source` mirrors `lots.source` (`'CPF' | 'SRS' | 'Cash' | ''`) — not "where this data came from."

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260721140000_cash_transactions_ledger.sql`

**Interfaces:**
- Produces: `cash_transactions` table, `user_settings.track_cash` column — consumed by every data.ts function in Task 3.

⚠️ **Cannot be verified by an agentic worker in this repo** — no local Supabase CLI project is linked. Write the file, review it carefully against the existing migrations' style, and flag to the user that it needs manual application (Supabase dashboard SQL editor or `supabase db push`) before Tasks 4-6 can be exercised end-to-end.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260721140000_cash_transactions_ledger.sql`:
```sql
-- T7: cash & contributions ledger.
-- Adds cash_transactions (the new source of truth for cash movement) and
-- user_settings.track_cash. Migrates existing cash_balances rows into
-- cash_transactions as deposits (preserving real user data), then drops
-- cash_balances.

-- ── 1. cash_transactions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  lot_id            uuid REFERENCES lots(id) ON DELETE CASCADE,
  transfer_group_id uuid,
  date              date NOT NULL,
  type              text NOT NULL CHECK (type IN ('deposit','withdrawal','transfer','fee','dividend_cash','buy','sell')),
  currency          text NOT NULL,
  amount            numeric NOT NULL,
  fx_rate           numeric NOT NULL DEFAULT 1,
  broker            text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT '',
  note              text,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own cash transactions" ON cash_transactions;
CREATE POLICY "Users can manage own cash transactions" ON cash_transactions
  FOR ALL
  USING ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Admins can read all cash transactions" ON cash_transactions;
CREATE POLICY "Admins can read all cash transactions" ON cash_transactions
  FOR SELECT
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS cash_transactions_user_id_idx  ON cash_transactions(user_id);
CREATE INDEX IF NOT EXISTS cash_transactions_lot_id_idx   ON cash_transactions(lot_id);
CREATE INDEX IF NOT EXISTS cash_transactions_transfer_idx ON cash_transactions(transfer_group_id);

-- ── 2. user_settings.track_cash ───────────────────────────────────────────────
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS track_cash boolean NOT NULL DEFAULT true;

GRANT INSERT (user_id, display_name, base_currency, cost_basis_method, track_cash, created_at, updated_at)
  ON public.user_settings TO authenticated;
GRANT UPDATE (user_id, display_name, base_currency, cost_basis_method, track_cash, updated_at)
  ON public.user_settings TO authenticated;

-- ── 3. Data migration: preserve existing cash_balances as deposit rows ────────
INSERT INTO cash_transactions (user_id, date, type, currency, amount, fx_rate, note)
SELECT
  cb.user_id,
  CURRENT_DATE,
  'deposit',
  cb.currency,
  cb.amount,
  COALESCE(c.rate_sgd, 1),
  'migrated from cash_balances'
FROM cash_balances cb
LEFT JOIN currencies c ON c.code = cb.currency
WHERE cb.amount > 0;

-- ── 4. Drop the superseded table ──────────────────────────────────────────────
DROP TABLE IF EXISTS cash_balances;
```

- [ ] **Step 2: Review against existing conventions**

Read `supabase/migrations/20260610025339_security_hardening.sql` to confirm the current `user_settings` GRANT lists exactly match `user_id, display_name, base_currency, cost_basis_method` before `track_cash` is appended (Task 6 of the T6 plan already added `cost_basis_method` — confirm it's there). Read `supabase/migrations/20260721130000_realized_lots_and_cost_basis_method.sql` to confirm the RLS policy shape (own-rows ALL + admin-read via `public.is_admin()`) and idempotency patterns match what's written above.

- [ ] **Step 3: Flag for manual application**

Tell the user: "This migration needs to be applied to the Supabase project before Tasks 4-6 can be exercised against real data — same manual-application situation as T6's migration."

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721140000_cash_transactions_ledger.sql
git commit -m "feat(db): add cash_transactions ledger, migrate cash_balances into it"
```

---

### Task 2: Types + pure contribution/seed math (TDD)

**Files:**
- Modify: `src/types/settings.ts`
- Create: `src/types/cash.ts`
- Create: `src/lib/contributions.ts`
- Create: `src/lib/contributions.test.ts`

**Interfaces:**
- Produces:
  - `UserSettings.trackCash: boolean` (added field)
  - `type CashTransactionType = "deposit"|"withdrawal"|"transfer"|"fee"|"dividend_cash"|"buy"|"sell"`
  - `interface CashTransaction { id, lotId: string|null, transferGroupId: string|null, date, type: CashTransactionType, currency, amount, fxRate, broker, source, note: string|null }`
  - `computeNetContributions(transactions: CashTransaction[], asOfDate?: string): number`
  - `interface LegacySeed { amountSgd: number; earliestDate: string }`
  - `computeLegacySeedAmount(holdings: HoldingRow[]): LegacySeed | null`
- Consumed by: `computeLegacySeedAmount` is consumed by Task 3 (`reconcile-cash.ts`). `computeNetContributions` is deliberately **not called anywhere in this plan** — per the design spec, "feeding `netContributions` into T8" is out of scope for T7. It's built and unit-tested now so it exists and is correct when T8 (a separate, later backlog item) needs it; it has no consumer yet, which is intentional, not a gap.

- [ ] **Step 1: Add `trackCash` to `UserSettings`**

Edit `src/types/settings.ts` — replace the whole file:
```ts
export type CostBasisMethod = "fifo" | "average" | "specific";

export interface UserSettings {
  displayName: string;
  baseCurrency: string;
  role: string;
  costBasisMethod: CostBasisMethod;
  trackCash: boolean;
}
```

- [ ] **Step 2: Create the cash transaction types**

Create `src/types/cash.ts`:
```ts
export type CashTransactionType =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "fee"
  | "dividend_cash"
  | "buy"
  | "sell";

export interface CashTransaction {
  id: string;
  lotId: string | null;
  transferGroupId: string | null;
  date: string;
  type: CashTransactionType;
  currency: string;
  amount: number;
  fxRate: number;
  broker: string;
  source: string;
  note: string | null;
}
```

- [ ] **Step 3: Write the failing tests**

Create `src/lib/contributions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeNetContributions, computeLegacySeedAmount } from "./contributions";
import type { CashTransaction } from "@/types/cash";
import type { HoldingRow } from "@/types/holding";

function makeTx(overrides: Partial<CashTransaction> = {}): CashTransaction {
  return {
    id: "t1",
    lotId: null,
    transferGroupId: null,
    date: "2026-01-01",
    type: "deposit",
    currency: "USD",
    amount: 1000,
    fxRate: 1.3,
    broker: "",
    source: "",
    note: null,
    ...overrides,
  };
}

describe("computeNetContributions", () => {
  it("sums only deposit/withdrawal, converted to SGD, ignoring everything else", () => {
    const txs = [
      makeTx({ id: "d1", type: "deposit", amount: 1000, fxRate: 1.3 }),
      makeTx({ id: "w1", type: "withdrawal", amount: -200, fxRate: 1.3 }),
      makeTx({ id: "b1", type: "buy", amount: -500, fxRate: 1.3 }),
      makeTx({ id: "f1", type: "fee", amount: -10, fxRate: 1 }),
      makeTx({ id: "s1", type: "sell", amount: 300, fxRate: 1.3 }),
      makeTx({ id: "dv1", type: "dividend_cash", amount: 20, fxRate: 1.3 }),
      makeTx({ id: "tr1", type: "transfer", amount: -100, fxRate: 1.3 }),
    ];
    expect(computeNetContributions(txs)).toBeCloseTo(1040, 6);
  });

  it("excludes transactions after asOfDate", () => {
    const txs = [
      makeTx({ id: "d1", type: "deposit", date: "2026-01-01", amount: 1000, fxRate: 1.3 }),
      makeTx({ id: "d2", type: "deposit", date: "2026-06-01", amount: 500, fxRate: 1.3 }),
    ];
    expect(computeNetContributions(txs, "2026-03-01")).toBeCloseTo(1300, 6);
  });

  it("returns 0 for an empty ledger", () => {
    expect(computeNetContributions([])).toBe(0);
  });
});

function makeHolding(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "1",
    userId: "u1",
    ticker: "AAPL",
    name: "Apple",
    assetType: "Equity",
    broker: "",
    strategy: "",
    units: 10,
    currency: "USD",
    flag: "🇺🇸",
    icon: "briefcase",
    buyPrice: 100,
    buyDate: "2026-01-01",
    buyFxRate: 1.3,
    currentPrice: 120,
    currentFxRate: 1.35,
    sparkData: [],
    createdAt: "",
    updatedAt: "",
    priceRefreshedAt: null,
    source: "",
    dividendYield: null,
    dividendYieldAuto: null,
    prevPrice: null,
    prevPriceSource: null,
    maturityDate: null,
    parValue: null,
    couponRate: null,
    transactionType: "buy",
    fees: 0,
    costSGD: 0,
    valueSGD: 0,
    assetGain: 0,
    fxGain: 0,
    totalPct: 0,
    detail: {
      buyUnits: 10,
      buyPx: 100,
      buyDate: "2026-01-01",
      buyFx: 1.3,
      curPx: 120,
      curFx: 1.35,
      ccy: "USD",
    },
    ...overrides,
  };
}

describe("computeLegacySeedAmount", () => {
  it("returns null when there are no buy lots", () => {
    const sellOnly = makeHolding({ transactionType: "sell" });
    expect(computeLegacySeedAmount([sellOnly])).toBeNull();
  });

  it("sums cost basis across all buy lots (open or closed) and finds the earliest date, excluding sells", () => {
    const lot1 = makeHolding({
      id: "b1", units: 10, buyPrice: 100, fees: 13, buyFxRate: 1.3,
      buyDate: "2025-01-01", transactionType: "buy",
    });
    const lot2 = makeHolding({
      id: "b2", units: 5, buyPrice: 50, fees: 0, buyFxRate: 1.35,
      buyDate: "2025-06-01", transactionType: "buy",
    });
    const sell = makeHolding({
      id: "s1", units: 3, buyPrice: 999, fees: 0, buyFxRate: 1.3,
      buyDate: "2024-01-01", transactionType: "sell",
    });
    const seed = computeLegacySeedAmount([lot1, lot2, sell]);
    expect(seed).not.toBeNull();
    expect(seed!.amountSgd).toBeCloseTo(1654.4, 6);
    expect(seed!.earliestDate).toBe("2025-01-01");
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/lib/contributions.test.ts`
Expected: FAIL — `Cannot find module './contributions'` (the file doesn't exist yet).

- [ ] **Step 5: Implement**

Create `src/lib/contributions.ts`:
```ts
import type { CashTransaction } from "@/types/cash";
import type { HoldingRow } from "@/types/holding";
import { computeCostBasisSGD } from "./fx";

const CONTRIBUTION_TYPES = new Set(["deposit", "withdrawal"]);

// amount is signed (+in, -out); summing it directly for deposit/withdrawal
// gives the net external capital contributed — transfers, fees, dividend
// cash, and buy/sell (internal asset<->cash swaps) are deliberately excluded.
export function computeNetContributions(
  transactions: CashTransaction[],
  asOfDate?: string,
): number {
  return transactions
    .filter((t) => CONTRIBUTION_TYPES.has(t.type))
    .filter((t) => !asOfDate || t.date <= asOfDate)
    .reduce((s, t) => s + t.amount * t.fxRate, 0);
}

export interface LegacySeed {
  amountSgd: number;
  earliestDate: string;
}

export function computeLegacySeedAmount(holdings: HoldingRow[]): LegacySeed | null {
  const buyLots = holdings.filter((h) => h.transactionType === "buy");
  if (buyLots.length === 0) return null;
  const amountSgd = buyLots.reduce((s, h) => s + computeCostBasisSGD(h), 0);
  const earliestDate = buyLots.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    buyLots[0].buyDate,
  );
  return { amountSgd, earliestDate };
}
```

- [ ] **Step 6: Run to verify success**

Run: `npx vitest run src/lib/contributions.test.ts`
Expected: PASS (6/6).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `src/lib/supabase/data.ts` (its `fetchUserSettings`/`upsertUserSettings` don't yet populate `trackCash`) — this is expected and resolved in Task 3. Confirm no *other* unexpected errors.

- [ ] **Step 8: Commit**

```bash
git add src/types/settings.ts src/types/cash.ts src/lib/contributions.ts src/lib/contributions.test.ts
git commit -m "feat(cash): add CashTransaction types and pure netContributions/legacy-seed math"
```

---

### Task 3: Data layer + reconciliation

**Files:**
- Modify: `src/lib/supabase/data.ts`
- Create: `src/lib/reconcile-cash.ts`

**Interfaces:**
- Consumes: `CashTransaction`, `CashTransactionType` (Task 2); `computeLegacySeedAmount` (Task 2).
- Produces:
  - `fetchCashTransactions(userId): Promise<CashTransaction[]>`
  - `fetchCashBalancesLive(userId): Promise<{currency: string; amount: number}[]>`
  - `interface ManualCashInput { date, type: CashTransactionType, currency, amount, fxRate, broker, source, note: string|null }`
  - `insertCashTransaction(userId, input: ManualCashInput): Promise<CashTransaction | null>`
  - `interface TransferInput { date, currency, amount (positive magnitude), fxRate, fromBroker, toBroker, note: string|null }`
  - `insertTransferPair(userId, input: TransferInput): Promise<[CashTransaction, CashTransaction] | null>`
  - `deleteCashTransaction(id, userId): Promise<"ok"|"not_found"|"auto_derived">`
  - `interface AutoCashInput { date, type: "buy"|"sell", currency, amount, fxRate, broker, source }`
  - `insertAutoCashTransaction(userId, lotId, input: AutoCashInput): Promise<void>`
  - `deleteCashTransactionsByLotId(lotId, userId): Promise<void>`
  - `insertLegacyCashSeed(userId, amountSgd, date): Promise<void>`
  - `fetchUserSettings`/`upsertUserSettings` updated for `track_cash`.
  - `reconcileCashLedger(userId, trackCash, holdings): Promise<void>` (new file)
- Consumed by: Task 4 (API routes), Task 5 (holdings route hooks), Task 6 (layout).

- [ ] **Step 1: Update `fetchUserSettings`/`upsertUserSettings` for `track_cash`**

Edit `src/lib/supabase/data.ts` — replace `fetchUserSettings`:
```ts
export async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("user_settings")
    .select("display_name, base_currency, role, cost_basis_method, track_cash")
    .eq("user_id", userId)
    .single();
  return {
    displayName: data?.display_name ?? "",
    baseCurrency: data?.base_currency ?? "SGD",
    role: data?.role ?? "user",
    costBasisMethod: (data?.cost_basis_method as CostBasisMethod) ?? "fifo",
    trackCash: data?.track_cash ?? true,
  };
}
```

Replace `upsertUserSettings`:
```ts
export async function upsertUserSettings(
  userId: string,
  settings: Partial<UserSettings>,
): Promise<void> {
  const supabase = await makeServerClient();
  await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      ...(settings.displayName !== undefined && {
        display_name: settings.displayName,
      }),
      ...(settings.baseCurrency !== undefined && {
        base_currency: settings.baseCurrency,
      }),
      ...(settings.costBasisMethod !== undefined && {
        cost_basis_method: settings.costBasisMethod,
      }),
      ...(settings.trackCash !== undefined && {
        track_cash: settings.trackCash,
      }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}
```

- [ ] **Step 2: Remove the old cash_balances functions**

Edit `src/lib/supabase/data.ts` — delete the `// ── Cash balances ──...` section (`fetchCashBalances` and `upsertCashBalance`, currently lines 691-717) entirely. The table they read/write no longer exists after Task 1's migration.

- [ ] **Step 3: Add the cash-transactions data functions**

Edit `src/lib/supabase/data.ts` — append at the end of the file (after `resolveInstrumentIdForTicker`):
```ts

// ── Cash transactions (T7) ─────────────────────────────────────────────────────

interface DbCashTransaction {
  id: string;
  lot_id: string | null;
  transfer_group_id: string | null;
  date: string;
  type: CashTransactionType;
  currency: string;
  amount: number;
  fx_rate: number;
  broker: string;
  source: string;
  note: string | null;
}

function toCashTransaction(row: DbCashTransaction): CashTransaction {
  return {
    id: row.id,
    lotId: row.lot_id,
    transferGroupId: row.transfer_group_id,
    date: row.date,
    type: row.type,
    currency: row.currency,
    amount: Number(row.amount),
    fxRate: Number(row.fx_rate),
    broker: row.broker,
    source: row.source,
    note: row.note,
  };
}

const CASH_TX_COLUMNS =
  "id, lot_id, transfer_group_id, date, type, currency, amount, fx_rate, broker, source, note";

export async function fetchCashTransactions(userId: string): Promise<CashTransaction[]> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("cash_transactions")
    .select(CASH_TX_COLUMNS)
    .eq("user_id", userId)
    .order("date", { ascending: false });
  if (error) {
    console.error("[fetchCashTransactions]", error.message);
    return [];
  }
  return (data as DbCashTransaction[]).map(toCashTransaction);
}

export async function fetchCashBalancesLive(
  userId: string,
): Promise<{ currency: string; amount: number }[]> {
  const transactions = await fetchCashTransactions(userId);
  const byCurrency = new Map<string, number>();
  for (const t of transactions) {
    byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0) + t.amount);
  }
  return Array.from(byCurrency.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface ManualCashInput {
  date: string;
  type: CashTransactionType;
  currency: string;
  amount: number;
  fxRate: number;
  broker: string;
  source: string;
  note: string | null;
}

export async function insertCashTransaction(
  userId: string,
  input: ManualCashInput,
): Promise<CashTransaction | null> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("cash_transactions")
    .insert({
      user_id: userId,
      date: input.date,
      type: input.type,
      currency: input.currency,
      amount: input.amount,
      fx_rate: input.fxRate,
      broker: input.broker,
      source: input.source,
      note: input.note,
    })
    .select(CASH_TX_COLUMNS)
    .single();
  if (error) {
    console.error("[insertCashTransaction]", error.message);
    return null;
  }
  return toCashTransaction(data as DbCashTransaction);
}

export interface TransferInput {
  date: string;
  currency: string;
  amount: number;
  fxRate: number;
  fromBroker: string;
  toBroker: string;
  note: string | null;
}

export async function insertTransferPair(
  userId: string,
  input: TransferInput,
): Promise<[CashTransaction, CashTransaction] | null> {
  const supabase = await makeServerClient();
  const groupId = crypto.randomUUID();
  const { data, error } = await supabase
    .from("cash_transactions")
    .insert([
      {
        user_id: userId,
        date: input.date,
        type: "transfer",
        currency: input.currency,
        amount: -input.amount,
        fx_rate: input.fxRate,
        broker: input.fromBroker,
        source: "",
        note: input.note,
        transfer_group_id: groupId,
      },
      {
        user_id: userId,
        date: input.date,
        type: "transfer",
        currency: input.currency,
        amount: input.amount,
        fx_rate: input.fxRate,
        broker: input.toBroker,
        source: "",
        note: input.note,
        transfer_group_id: groupId,
      },
    ])
    .select(CASH_TX_COLUMNS);
  if (error || !data || data.length !== 2) {
    console.error("[insertTransferPair]", error?.message);
    return null;
  }
  return [
    toCashTransaction(data[0] as DbCashTransaction),
    toCashTransaction(data[1] as DbCashTransaction),
  ];
}

export async function deleteCashTransaction(
  id: string,
  userId: string,
): Promise<"ok" | "not_found" | "auto_derived"> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("cash_transactions")
    .select("id, lot_id, transfer_group_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return "not_found";
  if (data.lot_id) return "auto_derived";
  if (data.transfer_group_id) {
    await supabase
      .from("cash_transactions")
      .delete()
      .eq("transfer_group_id", data.transfer_group_id)
      .eq("user_id", userId);
  } else {
    await supabase.from("cash_transactions").delete().eq("id", id).eq("user_id", userId);
  }
  return "ok";
}

export interface AutoCashInput {
  date: string;
  type: "buy" | "sell";
  currency: string;
  amount: number;
  fxRate: number;
  broker: string;
  source: string;
}

export async function insertAutoCashTransaction(
  userId: string,
  lotId: string,
  input: AutoCashInput,
): Promise<void> {
  const supabase = await makeServerClient();
  const { error } = await supabase.from("cash_transactions").insert({
    user_id: userId,
    lot_id: lotId,
    date: input.date,
    type: input.type,
    currency: input.currency,
    amount: input.amount,
    fx_rate: input.fxRate,
    broker: input.broker,
    source: input.source,
    note: null,
  });
  if (error) console.error("[insertAutoCashTransaction]", error.message);
}

export async function deleteCashTransactionsByLotId(
  lotId: string,
  userId: string,
): Promise<void> {
  const supabase = await makeServerClient();
  await supabase
    .from("cash_transactions")
    .delete()
    .eq("lot_id", lotId)
    .eq("user_id", userId);
}

export async function insertLegacyCashSeed(
  userId: string,
  amountSgd: number,
  date: string,
): Promise<void> {
  const supabase = await makeServerClient();
  const { error } = await supabase.from("cash_transactions").insert({
    user_id: userId,
    date,
    type: "deposit",
    currency: "SGD",
    amount: amountSgd,
    fx_rate: 1,
    broker: "",
    source: "",
    note: "legacy seed from cost basis",
  });
  if (error) console.error("[insertLegacyCashSeed]", error.message);
}
```

- [ ] **Step 4: Add the required imports**

Edit `src/lib/supabase/data.ts` — add to the top import block:
```ts
import type { CashTransaction, CashTransactionType } from "@/types/cash";
```
(alongside the existing `import type { UserSettings, CostBasisMethod } from "@/types/settings";` line)

- [ ] **Step 5: Create the reconciliation orchestrator**

Create `src/lib/reconcile-cash.ts`:
```ts
import { fetchCashTransactions, insertLegacyCashSeed } from "@/lib/supabase/data";
import { computeLegacySeedAmount } from "@/lib/contributions";
import type { HoldingRow } from "@/types/holding";

/**
 * One-time backfill for users who have lots but zero cash_transactions even
 * after Task 1's cash_balances migration — i.e. never touched the old cash
 * feature at all. Seeds a single lump deposit from their lifetime cost basis.
 * Idempotent: a no-op once the user has any cash_transactions row, whether
 * from this seed, the cash_balances migration, or their own manual entries.
 */
export async function reconcileCashLedger(
  userId: string,
  trackCash: boolean,
  holdings: HoldingRow[],
): Promise<void> {
  if (!trackCash) return;
  const existing = await fetchCashTransactions(userId);
  if (existing.length > 0) return;
  const seed = computeLegacySeedAmount(holdings);
  if (!seed) return;
  await insertLegacyCashSeed(userId, seed.amountSgd, seed.earliestDate);
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `data.ts`/`reconcile-cash.ts`. Any remaining errors should only be in files this task doesn't touch (resolved by later tasks).

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase/data.ts src/lib/reconcile-cash.ts
git commit -m "feat(data): add cash-transactions data access and legacy-seed reconciliation"
```

---

### Task 4: API — `/api/cash` rewrite + `/api/cash/transactions`

**Files:**
- Modify: `src/app/api/cash/route.ts`
- Create: `src/app/api/cash/transactions/route.ts`

**Interfaces:**
- Consumes: `fetchCashBalancesLive`, `insertCashTransaction`, `insertTransferPair`, `deleteCashTransaction`, `fetchCashTransactions` (Task 3); `CashTransactionType` (Task 2).
- Produces: `GET /api/cash` (unchanged response shape), `POST /api/cash` (log a manual entry or transfer), `DELETE /api/cash?id=...`, `GET /api/cash/transactions`.

- [ ] **Step 1: Rewrite `/api/cash/route.ts`**

Edit `src/app/api/cash/route.ts` — replace the whole file:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import {
  fetchCashBalancesLive,
  insertCashTransaction,
  insertTransferPair,
  deleteCashTransaction,
} from "@/lib/supabase/data";
import type { CashTransactionType } from "@/types/cash";

const CCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_MAX = 1e12;
const MANUAL_TYPES = new Set<CashTransactionType>([
  "deposit",
  "withdrawal",
  "fee",
  "dividend_cash",
]);

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const balances = await fetchCashBalancesLive(user.id);
  return NextResponse.json(balances);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { type, currency, amount, date, broker, source, note } = body;

  if (!currency || !CCY_RE.test(String(currency)))
    return NextResponse.json({ error: "invalid currency" }, { status: 400 });
  if (!date || !DATE_RE.test(String(date)))
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > NUM_MAX)
    return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  const fxRate = body.fx_rate != null ? Number(body.fx_rate) : 1;
  if (!Number.isFinite(fxRate) || fxRate <= 0)
    return NextResponse.json({ error: "invalid fx_rate" }, { status: 400 });

  if (type === "transfer") {
    const toBroker = body.to_broker;
    if (typeof toBroker !== "string" || !toBroker.trim())
      return NextResponse.json(
        { error: "transfer requires to_broker" },
        { status: 400 },
      );
    const pair = await insertTransferPair(user.id, {
      date: String(date),
      currency: String(currency),
      amount: amt,
      fxRate,
      fromBroker: broker != null ? String(broker) : "",
      toBroker: String(toBroker),
      note: note ? String(note) : null,
    });
    if (!pair) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json(pair, { status: 201 });
  }

  if (!MANUAL_TYPES.has(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }

  const signedAmount = type === "withdrawal" || type === "fee" ? -amt : amt;
  const row = await insertCashTransaction(user.id, {
    date: String(date),
    type,
    currency: String(currency),
    amount: signedAmount,
    fxRate,
    broker: broker != null ? String(broker) : "",
    source: source != null ? String(source) : "",
    note: note ? String(note) : null,
  });
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const result = await deleteCashTransaction(id, user.id);
  if (result === "not_found")
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result === "auto_derived")
    return NextResponse.json(
      {
        error:
          "This entry is linked to a buy/sell lot — delete the lot instead of this entry.",
      },
      { status: 409 },
    );
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Add the transactions-list route**

Create `src/app/api/cash/transactions/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchCashTransactions } from "@/lib/supabase/data";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const transactions = await fetchCashTransactions(user.id);
  return NextResponse.json(transactions);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in these two files.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. If the Task 1 migration is applied to a live Supabase project reachable in this environment, exercise: log a deposit, log a withdrawal, log a transfer (confirm two rows appear via `GET /api/cash/transactions`), attempt to delete an entry, confirm `GET /api/cash` reflects the net balance. If the migration isn't applied yet (same limitation T6 hit repeatedly), verify via code tracing instead and note that clearly in the report.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cash/route.ts src/app/api/cash/transactions/route.ts
git commit -m "feat(api): rewrite /api/cash as a ledger, add /api/cash/transactions"
```

---

### Task 5: Auto-derive — buy/sell lots write cash transactions

**Files:**
- Modify: `src/app/api/holdings/route.ts`

**Interfaces:**
- Consumes: `insertAutoCashTransaction`, `deleteCashTransactionsByLotId`, `fetchUserSettings` (Task 3, already imported).

- [ ] **Step 1: Add the new import**

Edit `src/app/api/holdings/route.ts` — add `insertAutoCashTransaction` and `deleteCashTransactionsByLotId` to the existing `import { ... } from "@/lib/supabase/data";` block (alongside `fetchUserSettings`, `fetchOpenBuyLots`, etc. already imported by T6).

- [ ] **Step 2: Fetch user settings once, early, in POST — replace the sell-only lazy fetch**

Edit `src/app/api/holdings/route.ts` — in the `POST` handler, immediately after the `requireAuth()` guard (before the body is parsed), add:
```ts
  const userSettings = await fetchUserSettings(user.id);
```

Then find the existing line (from T6):
```ts
    sellMethod =
      (cost_basis_method as CostBasisMethod | undefined) ??
      (await fetchUserSettings(user.id)).costBasisMethod;
```
and replace it with:
```ts
    sellMethod =
      (cost_basis_method as CostBasisMethod | undefined) ??
      userSettings.costBasisMethod;
```
(Removes a redundant second fetch — no behavior change, `userSettings` is now already available.)

- [ ] **Step 3: Auto-derive a cash transaction after the lot is inserted**

Edit `src/app/api/holdings/route.ts` — immediately after the existing block:
```ts
  if (transaction_type === "sell" && sellMatches && sellMethod) {
    await insertRealizedLots(
      user.id,
      instrumentId,
      row.id,
      sellMethod,
      String(buy_date),
      Number(buy_price),
      Number(buy_fx_rate ?? 1),
      sellMatches,
    );
  }
```
add:
```ts

  if (userSettings.trackCash) {
    const grossAmount = Number(units) * Number(buy_price);
    const feeAmount = fees != null ? Number(fees) : 0;
    const cashAmount =
      transaction_type === "sell"
        ? grossAmount - feeAmount
        : -(grossAmount + feeAmount);
    await insertAutoCashTransaction(user.id, row.id, {
      date: String(buy_date),
      type: transaction_type === "sell" ? "sell" : "buy",
      currency: String(currency),
      amount: cashAmount,
      fxRate: Number(buy_fx_rate ?? 1),
      broker: String(broker ?? ""),
      source: source != null ? String(source) : "",
    });
  }
```

- [ ] **Step 4: Fetch user settings once, early, in PATCH; compute a shared "touches financial fields" flag**

Edit `src/app/api/holdings/route.ts` — in the `PATCH` handler, immediately after the `existingLot` 404 check (`if (!existingLot) return NextResponse.json({ error: "Not found" }, { status: 404 });`), add:
```ts

  const userSettings = await fetchUserSettings(user.id);
  const touchesFinancialFields = ["quantity", "price", "trade_date", "fx_rate", "fees"].some(
    (k) => lotPatch[k] !== undefined,
  );
```

Then find the existing sell-lot guard block from T6:
```ts
  if (existingLot.transactionType === "sell") {
    const affectsMatch = ["quantity", "price", "trade_date", "fx_rate", "fees"].some(
      (k) => lotPatch[k] !== undefined,
    );
    if (affectsMatch) {
```
and replace the inner `.some(...)` computation with the shared flag (no behavior change, just removes duplication now that both this guard and the new auto-cash-regen logic need the same check):
```ts
  if (existingLot.transactionType === "sell") {
    if (touchesFinancialFields) {
```

- [ ] **Step 5: Regenerate the auto-derived cash row after a successful lot edit**

Edit `src/app/api/holdings/route.ts` — immediately after the existing:
```ts
  const row = await updateLot(id, user.id, lotPatch);
  if (!row)
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
```
and before its `return NextResponse.json(row);`, insert:
```ts

  if (userSettings.trackCash && touchesFinancialFields) {
    await deleteCashTransactionsByLotId(id, user.id);
    const grossAmount = row.units * row.buyPrice;
    const cashAmount =
      row.transactionType === "sell"
        ? grossAmount - row.fees
        : -(grossAmount + row.fees);
    await insertAutoCashTransaction(user.id, id, {
      date: row.buyDate,
      type: row.transactionType,
      currency: row.currency,
      amount: cashAmount,
      fxRate: row.buyFxRate,
      broker: row.broker,
      source: row.source,
    });
  }
```
(Delete-then-insert unconditionally is deliberate and self-healing: it's correct whether or not an auto-derived row existed before — e.g. if `track_cash` was off when the lot was created and is now on, this "ensure fresh" approach creates the missing row instead of silently doing nothing.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. If the migration is applied, exercise: add a buy lot with `track_cash` on (default), confirm a matching `cash_transactions` row with `type='buy'` and a negative amount appears; sell part of it, confirm a `type='sell'` row with a positive amount; edit the buy lot's price, confirm the auto-derived row updates to match; delete the buy lot, confirm its auto-derived row is gone (cascade). If the migration isn't applied yet, verify via code tracing and note that clearly.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/holdings/route.ts
git commit -m "feat(api): auto-derive cash transactions from buy/sell lots"
```

---

### Task 6: Layout/context wiring — reconcile + `trackCash` threading

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/components/DashboardShell.tsx`
- Modify: `src/context/portfolio.tsx`

**Interfaces:**
- Consumes: `reconcileCashLedger` (Task 3).
- Produces: `usePortfolio()` gains `trackCash: boolean`, `setTrackCash: (v: boolean) => void`.
- Consumed by: Task 7 (Settings toggle).

- [ ] **Step 1: Call the cash-ledger reconciliation from the layout**

Edit `src/app/(dashboard)/layout.tsx` — add `reconcileCashLedger` to the imports (alongside `reconcileRealizedLots`):
```ts
import { reconcileCashLedger } from "@/lib/reconcile-cash";
```
Then, immediately after the existing:
```ts
  if (user) {
    const { warnings } = await reconcileRealizedLots(
      user.id,
      userSettings.costBasisMethod,
    );
    for (const w of warnings) console.warn("[reconcileRealizedLots]", w);
  }
```
add:
```ts
  if (user) {
    await reconcileCashLedger(user.id, userSettings.trackCash, holdings);
  }
```

- [ ] **Step 2: Thread `initialTrackCash` through `DashboardShell`**

Edit `src/app/(dashboard)/layout.tsx` — in the `<DashboardShell ...>` JSX, add a new prop right after `initialCostBasisMethod={userSettings.costBasisMethod}`:
```tsx
      initialTrackCash={userSettings.trackCash}
```

Edit `src/components/DashboardShell.tsx`:
- Add `initialTrackCash: boolean;` to `DashboardShellProps`, right after `initialCostBasisMethod: CostBasisMethod;`.
- Add `initialTrackCash,` to the destructured function parameters, right after `initialCostBasisMethod,`.
- Add `initialTrackCash,` to the `<PortfolioProvider value={{ ... }}>` object, right after `initialCostBasisMethod,`.

- [ ] **Step 3: Add `trackCash`/`setTrackCash` to the portfolio context**

Edit `src/context/portfolio.tsx`:
- Add `trackCash: boolean;` and `setTrackCash: (v: boolean) => void;` to `PortfolioContextValue`, right after `costBasisMethod`/`setCostBasisMethod`.
- Add `"trackCash" | "setTrackCash"` to the `Omit<...>` exclusion list in `ProviderProps`, alongside `"costBasisMethod" | "setCostBasisMethod"`.
- Add `initialTrackCash: boolean;` to the inline type intersected onto `ProviderProps["value"]`, right after `initialCostBasisMethod: CostBasisMethod;`.
- Inside `PortfolioProvider`, add `const [trackCash, setTrackCash] = useState(value.initialTrackCash);` right after the `costBasisMethod` `useState` call.
- Add `trackCash, setTrackCash,` to the `ctx` object, right after `costBasisMethod, setCostBasisMethod,`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/layout.tsx" src/components/DashboardShell.tsx src/context/portfolio.tsx
git commit -m "feat(dashboard): wire cash-ledger reconciliation and trackCash into context"
```

---

### Task 7: Settings — "Track Cash Automatically" toggle

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `trackCash`/`setTrackCash` from `usePortfolio()` (Task 6).

- [ ] **Step 1: Accept `trackCash` in the settings API**

Edit `src/app/api/settings/route.ts` — in the `POST` handler, add parsing/validation for `trackCash` alongside the existing `costBasisMethod` handling:
```ts
  const trackCash =
    typeof body.trackCash === "boolean" ? body.trackCash : undefined;
```
(placed next to the existing `costBasisMethod` destructure), and pass it through to `upsertUserSettings`:
```ts
  await upsertUserSettings(user.id, {
    displayName,
    baseCurrency,
    costBasisMethod: costBasisMethod as "fifo" | "average" | "specific" | undefined,
    trackCash,
  });
```
No new validation branch is needed beyond the `typeof body.trackCash === "boolean"` check above (an invalid/non-boolean value simply falls through as `undefined` and is left untouched, matching how `costBasisMethod`/`baseCurrency` already handle absence — but unlike those, there's no invalid-value 400 needed since any non-boolean is silently treated as "not provided," which is acceptable for a simple toggle).

- [ ] **Step 2: Add the toggle UI**

Edit `src/app/(dashboard)/settings/page.tsx`:

Add `trackCash`/`setTrackCash` to the `usePortfolio()` destructure, alongside `costBasisMethod`/`setCostBasisMethod`.

Add state right after `const [methodInput, setMethodInput] = useState(costBasisMethod);`:
```tsx
  const [trackCashInput, setTrackCashInput] = useState(trackCash);
```

Extend `isDirty` with a fourth term:
```tsx
  const isDirty =
    nameInput !== displayName ||
    ccyInput !== baseCurrency ||
    methodInput !== costBasisMethod ||
    trackCashInput !== trackCash;
```

Extend `handleSave`'s POST body:
```tsx
      body: JSON.stringify({
        displayName: nameInput,
        baseCurrency: ccyInput,
        costBasisMethod: methodInput,
        trackCash: trackCashInput,
      }),
```
and its success branch:
```tsx
    if (res.ok) {
      setDisplayName(nameInput);
      setBaseCurrency(ccyInput);
      setCostBasisMethod(methodInput);
      setTrackCash(trackCashInput);
      setSaveState("saved");
```

Extend the discard-changes button's `onClick`:
```tsx
              onClick={() => {
                setNameInput(displayName);
                setCcyInput(baseCurrency);
                setMethodInput(costBasisMethod);
                setTrackCashInput(trackCash);
              }}
```

Insert a new card between the Cost-Basis Method card and `{/* Save */}`:
```tsx
        {/* Track Cash Automatically */}
        <div className="card flex flex-col gap-4 px-5 py-4.5 max-bp480:p-3.5 max-bp380:p-3">
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">
              Track Cash Automatically
            </span>
            <span className="font-ui text-secondary text-[11px]">
              buys/sells log a matching cash entry
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {(
              [
                { v: true, label: "On" },
                { v: false, label: "Off" },
              ] as const
            ).map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                className={
                  "bg-elevated border rounded-[11px] px-4 py-3 cursor-pointer flex flex-col gap-[3px] [transition:border-color_.15s,background_.15s,box-shadow_.15s] text-left min-w-[110px] " +
                  (trackCashInput === opt.v
                    ? "border-gold-soft bg-wash shadow-[inset_0_0_0_1px_var(--border-gold)]"
                    : "border-subtle hover:border-muted")
                }
                onClick={() => setTrackCashInput(opt.v)}
              >
                <span className="font-ui text-[13px] font-semibold text-primary">
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>

```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Browser verification**

Run: `npm run dev`, open `/settings` if a session is available (same sandbox limitation as T6's UI tasks may apply — verify what you can, note what you can't).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/route.ts "src/app/(dashboard)/settings/page.tsx"
git commit -m "feat(settings): add Track Cash Automatically toggle"
```

---

### Task 8: `CashForm` redesign — log transactions, not balances

**Files:**
- Modify: `src/app/(dashboard)/add/page.tsx`

**Interfaces:**
- Consumes: `POST /api/cash`, `GET /api/cash/transactions`, `DELETE /api/cash` (Task 4).

- [ ] **Step 1: Replace `CashForm`**

Edit `src/app/(dashboard)/add/page.tsx` — replace the entire `CashForm` function (currently lines 247-317) with:
```tsx
const CASH_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer: "Transfer",
  fee: "Fee",
  dividend_cash: "Dividend cash",
};

function CashForm() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [transactions, setTransactions] = useState<
    { id: string; lotId: string | null; date: string; type: string; currency: string; amount: number; broker: string; note: string | null }[]
  >([]);
  const [type, setType] = useState("deposit");
  const [currency, setCurrency] = useState("SGD");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(TODAY);
  const [broker, setBroker] = useState("");
  const [toBroker, setToBroker] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/cash/transactions")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setTransactions(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async () => {
    setError("");
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      const msg = "Amount must be positive.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (type === "transfer" && !toBroker.trim()) {
      const msg = "Destination broker is required for a transfer.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          currency,
          amount: amt,
          date,
          broker,
          to_broker: type === "transfer" ? toBroker : undefined,
          note: note || null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? "Save failed");
      }
      toast.success(`${CASH_TYPE_LABEL[type]} logged`);
      setAmount("");
      setNote("");
      setToBroker("");
      await load();
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/cash?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? "Delete failed");
      }
      toast.success("Entry removed");
      await load();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3.5 max-bp768:grid-cols-1">
        <Field label="Type">
          <Select
            value={CASH_TYPE_LABEL[type]}
            options={Object.values(CASH_TYPE_LABEL)}
            onChange={(v) => {
              const next = Object.entries(CASH_TYPE_LABEL).find(([, l]) => l === v)?.[0];
              if (next) setType(next);
            }}
          />
        </Field>
        <Field label="Currency">
          <Select
            value={(CCY_FLAGS[currency] ?? "🌐") + " " + currency}
            options={currencies.map((c) => (CCY_FLAGS[c] ?? "🌐") + " " + c)}
            onChange={(v) => setCurrency(v.split(" ")[1])}
          />
        </Field>
        <Field label="Amount">
          <input
            className="inp"
            type="number"
            min="0"
            step="any"
            placeholder="1000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date">
          <input
            className="inp"
            type="date"
            max={TODAY}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={type === "transfer" ? "From broker" : "Broker"}>
          <input
            className="inp"
            placeholder="e.g. IBKR"
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
          />
        </Field>
        {type === "transfer" && (
          <Field label="To broker">
            <input
              className="inp"
              placeholder="e.g. Tiger"
              value={toBroker}
              onChange={(e) => setToBroker(e.target.value)}
            />
          </Field>
        )}
        <Field label="Note (optional)" full>
          <input
            className="inp"
            placeholder="optional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      {error && (
        <div className="font-ui" style={{ color: "var(--loss)", fontSize: 12 }}>
          {error}
        </div>
      )}
      <button
        className="flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default"
        onClick={handleSubmit}
        disabled={saving}
      >
        <Icon name="plus" size={16} />
        {saving ? "Saving…" : `Log ${CASH_TYPE_LABEL[type]}`}
      </button>
      {transactions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {transactions.slice(0, 8).map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-[9px] border border-subtle bg-elevated px-2.5 py-1.5"
            >
              <span className="font-ui text-[11.5px] text-secondary">
                {t.date} · {CASH_TYPE_LABEL[t.type] ?? t.type} · {t.currency}{" "}
                {t.amount.toLocaleString()}
                {t.broker ? ` · ${t.broker}` : ""}
              </span>
              {t.lotId ? (
                <span className="font-ui text-[10.5px] text-muted">auto</span>
              ) : (
                <button
                  className="cursor-pointer rounded-[5px] border-none bg-transparent p-0.5 text-muted transition-[color] duration-150 hover:text-loss"
                  onClick={() => handleDelete(t.id)}
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the entry-type subtitle**

Edit `src/app/(dashboard)/add/page.tsx` — in the `ENTRY_SUBTITLE` constant, replace:
```ts
  cash: "update cash balances",
```
with:
```ts
  cash: "log a cash transaction",
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Browser verification**

Run: `npm run dev`, open `/add`, switch to the "Cash" tab. If a live session/migration is available, exercise: log a deposit, a withdrawal, a transfer (confirm two entries with matching amounts/opposite sign appear), attempt to delete an auto-derived entry (should not be possible — no delete button shown), delete a manual entry. If not possible in this environment, verify via code tracing and note clearly.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/add/page.tsx"
git commit -m "feat(cash): redesign CashForm from balance-setting to transaction logging"
```

---

## Post-implementation checklist

- [ ] Every task's `npx tsc --noEmit` is clean with zero errors repo-wide after Task 8.
- [ ] `npm test` (Vitest) is green for `contributions.test.ts` and the full existing suite.
- [ ] The migration (Task 1) has been applied to the actual Supabase project by a human operator before Tasks 4-8 are exercised against real data.
- [ ] `npm run lint` shows no new errors beyond pre-existing debt.
- [ ] Full manual walkthrough: log a deposit → log a withdrawal → log a transfer → buy a holding (confirm auto cash entry) → sell it (confirm auto cash entry) → edit the buy lot's price (confirm auto entry updates) → delete the lot (confirm auto entry cascades) → toggle Track Cash off in Settings → buy again (confirm no auto entry this time).
