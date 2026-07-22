# Portfolio Backup / Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the JSON export a full-fidelity backup that restores exactly (including sells and realized P&L), make the CSV export round-trip through the existing importer, and fix two `ON DELETE RESTRICT` bugs found along the way.

**Architecture:** A new pure module `portfolio-io.ts` owns all (de)serialization. Restore is server-side: `POST /api/holdings/restore` validates the whole backup up front, optionally wipes, then commits each lot through a shared `commitLot` core extracted from the existing `POST /api/holdings`. Export is `GET /api/holdings/backup` (a versioned envelope built from `fetchHoldings` + `fetchRealizedLots`).

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript (strict), Supabase (Postgres + RLS), vitest for pure-logic tests.

## Global Constraints

- All monetary values are stored in **SGD**; never format currency by hand — use `usePortfolio()` helpers in UI.
- **Commit code only — never commit files under `docs/`.** Stage only source files listed in each task.
- **No `Co-Authored-By` trailer** in commits.
- Commit messages follow **Conventional Commits**: `<type>(<scope>): <desc>` — imperative, lowercase, no trailing period, ≤72 chars; add a `- ` bulleted body for non-trivial changes.
- Tests are **pure** by convention (no Supabase mocking). Test pure functions; verify route/data-layer changes with `npx tsc --noEmit`.
- Type-check with `npx tsc --noEmit`; run tests with `npx vitest run <file>`.
- Instrument metadata (`instruments`) is shared across users and written only via the admin client (already handled inside `upsertInstrument`).

---

## File Structure

- `src/types/holding.ts` — add `exchangeCode` to `Holding` (Task 1).
- `src/lib/supabase/data.ts` — map `exchangeCode`; fix `deleteAllLotsForUser` ordering (Tasks 1, 2).
- `src/lib/supabase/delete-user.ts` — fix `purgeUser` table order (Task 2).
- `src/lib/holdings/commit-lot.ts` — **new**: `LotCommitInput`, `validateLotInput`, `commitLot` (Task 3).
- `src/app/api/holdings/route.ts` — rewrite `POST` as a thin wrapper over `commit-lot` (Task 3).
- `src/lib/portfolio-io.ts` — **new**: CSV helpers (Task 4) + JSON backup helpers (Task 5).
- `src/lib/portfolio-io.test.ts` — **new**: pure tests (Tasks 4, 5).
- `src/lib/holdings/commit-lot.test.ts` — **new**: `validateLotInput` tests (Task 3).
- `src/app/api/holdings/backup/route.ts` — **new**: `GET` export (Task 6).
- `src/app/api/holdings/restore/route.ts` — **new**: `POST` restore (Task 7).
- `src/app/(dashboard)/holdings/page.tsx` — report CSV uses `toCsv` (Task 8).
- `src/app/(dashboard)/add/page.tsx` — import CSV helpers from `portfolio-io` (Task 4); panel export buttons (Task 9); JSON import tab (Task 10).

---

## Task 1: Expose `exchangeCode` on `Holding`

**Files:**
- Modify: `src/types/holding.ts` (Holding interface)
- Modify: `src/lib/supabase/data.ts` (`toHoldingRow`, ~line 109-144)

**Interfaces:**
- Produces: `Holding.exchangeCode: string | null` — read by the export envelope (Task 6) and `backupLotToCommitInput` (Task 5).

- [ ] **Step 1: Add the field to the type**

In `src/types/holding.ts`, inside `interface Holding`, add after the `icon: string;` line:

```typescript
  icon: string;
  exchangeCode: string | null;
```

- [ ] **Step 2: Map it in `toHoldingRow`**

In `src/lib/supabase/data.ts`, inside the `base` object in `toHoldingRow`, add after the `assetType: inst.asset_type,` line:

```typescript
    assetType: inst.asset_type,
    exchangeCode: inst.exchange_code ?? null,
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`inst.exchange_code` already exists on `DbInstrument`; `fetchHoldings` already selects `instruments(*)`.)

- [ ] **Step 4: Commit**

```bash
git add src/types/holding.ts src/lib/supabase/data.ts
git commit -m "feat(holdings): expose instrument exchange_code on Holding"
```

---

## Task 2: Fix the `ON DELETE RESTRICT` bugs in the two wipe paths

`realized_lots.buy_lot_id → lots(id)` is `ON DELETE RESTRICT`, so a bulk `DELETE FROM lots` fails for any account that has recorded a sale. Both wipe paths must delete `realized_lots` before `lots`.

**Files:**
- Modify: `src/lib/supabase/data.ts` (`deleteAllLotsForUser`, ~line 536-548)
- Modify: `src/lib/supabase/delete-user.ts` (`USER_SCOPED_TABLES`, ~line 10-18)

**Interfaces:**
- Produces: `deleteAllLotsForUser(userId)` now clears the user's `realized_lots` first — relied on by the Replace path (Task 7).

- [ ] **Step 1: Fix `deleteAllLotsForUser`**

Replace the whole function body in `src/lib/supabase/data.ts`:

```typescript
export async function deleteAllLotsForUser(userId: string): Promise<number> {
  const supabase = await makeServerClient();
  // realized_lots.buy_lot_id is ON DELETE RESTRICT, so a buy lot referenced by a
  // realized sale blocks `DELETE FROM lots`. Clear the user's realized rows first
  // (RLS lets a user manage their own). Auto cash_transactions then cascade with
  // the lots; manual cash (lot_id null) is left intact.
  const { error: realizedError } = await supabase
    .from("realized_lots")
    .delete()
    .eq("user_id", userId);
  if (realizedError) {
    console.error("[deleteAllLotsForUser] realized_lots", realizedError.message);
    return 0;
  }
  const { data, error } = await supabase
    .from("lots")
    .delete()
    .eq("user_id", userId)
    .select("id");
  if (error) {
    console.error("[deleteAllLotsForUser]", error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}
```

- [ ] **Step 2: Fix `purgeUser` table order**

In `src/lib/supabase/delete-user.ts`, replace the `USER_SCOPED_TABLES` array (keep the surrounding comment, extend it):

```typescript
const USER_SCOPED_TABLES = [
  // realized_lots MUST precede lots: realized_lots.buy_lot_id → lots is
  // ON DELETE RESTRICT, so deleting lots first is blocked for any account that
  // has recorded a sale. (These rows are also the user's own data to purge.)
  "realized_lots",
  "lots",
  "holding_overrides",
  "portfolio_snapshots",
  "cash_transactions",
  "cpf_balances",
  "rate_limits",
  "user_settings",
] as const;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/data.ts src/lib/supabase/delete-user.ts
git commit -m "fix(data): clear realized_lots before lots in wipe paths

- delete realized_lots first in deleteAllLotsForUser (RESTRICT blocker)
- add realized_lots as first entry in purgeUser table order
- unblocks delete-all and account deletion for accounts with sales"
```

---

## Task 3: Extract `commit-lot.ts`; rewrite `POST /api/holdings` as a wrapper

Move the lot-commit logic out of the route so the restore endpoint can reuse it verbatim. Behaviour of `POST /api/holdings` is unchanged.

**Files:**
- Create: `src/lib/holdings/commit-lot.ts`
- Modify: `src/app/api/holdings/route.ts` (`POST`, lines 45-300)
- Test: `src/lib/holdings/commit-lot.test.ts`

**Interfaces:**
- Produces:
  - `interface LotCommitInput { … }` (below) — consumed by `backupLotToCommitInput` (Task 5) and both routes.
  - `validateLotInput(input: LotCommitInput): string | null` — returns an error message or null.
  - `commitLot(userId: string, input: LotCommitInput, userSettings: UserSettings): Promise<HoldingRow>` — inserts instrument+lot (+realized, +auto-cash, +dividend override); returns the inserted row; throws `InvalidAllocationError` / `InsufficientOpenQuantityError` / `Error("Insert failed")`.

- [ ] **Step 1: Write the failing test for `validateLotInput`**

Create `src/lib/holdings/commit-lot.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateLotInput } from "./commit-lot";

const ok = {
  ticker: "AAPL",
  name: "Apple",
  asset_type: "Equity",
  units: 10,
  currency: "USD",
  buy_price: 150,
  buy_date: "2024-01-02",
};

describe("validateLotInput", () => {
  it("accepts a well-formed buy", () => {
    expect(validateLotInput(ok)).toBeNull();
  });
  it("rejects a bad ticker format", () => {
    expect(validateLotInput({ ...ok, ticker: "has space" })).toMatch(/ticker/i);
  });
  it("rejects a bad date format", () => {
    expect(validateLotInput({ ...ok, buy_date: "02/01/2024" })).toMatch(/date/i);
  });
  it("rejects zero/negative units", () => {
    expect(validateLotInput({ ...ok, units: 0 })).toMatch(/units/i);
  });
  it("rejects a missing required field", () => {
    expect(validateLotInput({ ...ok, name: "" })).toMatch(/required/i);
  });
  it("rejects an invalid transaction_type", () => {
    expect(
      validateLotInput({ ...ok, transaction_type: "gift" as never }),
    ).toMatch(/transaction_type/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/holdings/commit-lot.test.ts`
Expected: FAIL — cannot find module `./commit-lot`.

- [ ] **Step 3: Create `commit-lot.ts`**

Create `src/lib/holdings/commit-lot.ts` (lifts the guards + mutation sequence out of `route.ts`):

```typescript
import {
  upsertInstrument,
  insertLot,
  seedTickerQuote,
  fetchOpenBuyLots,
  insertRealizedLots,
  insertAutoCashTransaction,
  upsertHoldingOverride,
  type UserSettings,
} from "@/lib/supabase/data";
import { CCY_FLAG } from "@/lib/formatters";
import { matchSell, type ManualAllocation } from "@/lib/realized";
import type { CostBasisMethod } from "@/types/settings";
import type { HoldingRow } from "@/types/holding";

const TICKER_RE = /^[A-Za-z0-9.\-:]{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_MAX = 1e12;

const finiteNonNeg = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= NUM_MAX;
};

export interface LotCommitInput {
  ticker: string;
  name: string;
  asset_type: string;
  broker?: string;
  strategy?: string;
  units: number | string;
  currency: string;
  flag?: string;
  icon?: string;
  buy_price: number | string;
  buy_date: string;
  buy_fx_rate?: number | string;
  current_price?: number | string;
  current_fx_rate?: number | string;
  spark_data?: number[];
  exchange_code?: string | null;
  source?: string;
  fees?: number | string;
  transaction_type?: "buy" | "sell";
  maturity_date?: string | null;
  par_value?: number | string | null;
  coupon_rate?: number | string | null;
  dividend_yield?: number | string | null;
  lot_allocations?: { buyLotId: string; qty: number }[];
  cost_basis_method?: CostBasisMethod;
}

/** Format/numeric guards. Returns an error message, or null when valid. */
export function validateLotInput(b: LotCommitInput): string | null {
  if (b.ticker && !TICKER_RE.test(String(b.ticker))) return "invalid ticker format";
  if (b.name && String(b.name).length > 200) return "name too long";
  if (b.buy_date && !DATE_RE.test(String(b.buy_date))) return "invalid buy_date format";
  if (!b.ticker || !b.name || !b.asset_type || !b.buy_price || !b.buy_date || !b.units || !b.currency)
    return "Missing required fields";
  if (!finiteNonNeg(b.units) || Number(b.units) <= 0) return "invalid units";
  if (!finiteNonNeg(b.buy_price)) return "invalid buy_price";
  if (b.buy_fx_rate !== undefined && !finiteNonNeg(b.buy_fx_rate)) return "invalid buy_fx_rate";
  if (b.current_price !== undefined && !finiteNonNeg(b.current_price)) return "invalid current_price";
  if (b.current_fx_rate !== undefined && !finiteNonNeg(b.current_fx_rate)) return "invalid current_fx_rate";
  if (Array.isArray(b.spark_data) && b.spark_data.length > 400) return "spark_data too large";
  if (b.source !== undefined && !["CPF", "SRS", "Cash", ""].includes(String(b.source))) return "invalid source";
  if (b.transaction_type !== undefined && !["buy", "sell"].includes(String(b.transaction_type)))
    return "invalid transaction_type";
  if (b.fees !== undefined && !finiteNonNeg(b.fees)) return "invalid fees";
  if (b.maturity_date != null && !DATE_RE.test(String(b.maturity_date))) return "invalid maturity_date";
  if (b.par_value != null && !finiteNonNeg(b.par_value)) return "invalid par_value";
  if (b.coupon_rate != null && !finiteNonNeg(b.coupon_rate)) return "invalid coupon_rate";
  if (b.dividend_yield != null && !finiteNonNeg(b.dividend_yield)) return "invalid dividend_yield";
  if (b.cost_basis_method !== undefined && !["fifo", "average", "specific"].includes(String(b.cost_basis_method)))
    return "invalid cost_basis_method";
  return null;
}

/**
 * Land one transaction leg: upsert the shared instrument, match a sell against
 * open buy lots, seed a quote, insert the lot, persist realized rows + auto-cash
 * + dividend override. Assumes `input` already passed `validateLotInput`.
 * Throws matchSell's typed errors, or Error("Insert failed").
 */
export async function commitLot(
  userId: string,
  input: LotCommitInput,
  userSettings: UserSettings,
): Promise<HoldingRow> {
  const instrumentId = await upsertInstrument({
    symbol: String(input.ticker),
    exchangeCode: input.exchange_code ? String(input.exchange_code) : null,
    assetType: String(input.asset_type),
    currency: String(input.currency),
    name: String(input.name),
    flag: String(input.flag ?? "🌐"),
    icon: String(input.icon ?? "briefcase"),
    parValue: input.par_value != null ? Number(input.par_value) : null,
    couponRate: input.coupon_rate != null ? Number(input.coupon_rate) : null,
    maturityDate: input.maturity_date ? String(input.maturity_date) : null,
  });
  if (!instrumentId) throw new Error("Insert failed");

  let sellMatches: ReturnType<typeof matchSell> | undefined;
  let sellMethod: CostBasisMethod | undefined;
  if (input.transaction_type === "sell") {
    sellMethod = input.cost_basis_method ?? userSettings.costBasisMethod;
    let manualAllocations: ManualAllocation[] | undefined;
    if (sellMethod === "specific") {
      if (!Array.isArray(input.lot_allocations) || input.lot_allocations.length === 0)
        throw new Error("specific cost-basis method requires lot_allocations");
      manualAllocations = input.lot_allocations.map((a) => ({
        buyLotId: String(a.buyLotId),
        quantity: Number(a.qty),
      }));
    }
    const openBuyLots = await fetchOpenBuyLots(userId, instrumentId);
    sellMatches = matchSell(
      {
        quantity: Number(input.units),
        price: Number(input.buy_price),
        fxRate: Number(input.buy_fx_rate ?? 1),
        fees: input.fees != null ? Number(input.fees) : 0,
      },
      openBuyLots,
      sellMethod,
      manualAllocations,
    );
  }

  await seedTickerQuote(
    String(input.ticker),
    Number(input.current_price ?? input.buy_price),
    Array.isArray(input.spark_data) ? input.spark_data : undefined,
  );

  const row = await insertLot(userId, instrumentId, {
    transactionType: input.transaction_type === "sell" ? "sell" : "buy",
    quantity: Number(input.units),
    price: Number(input.buy_price),
    tradeDate: String(input.buy_date),
    fxRate: Number(input.buy_fx_rate ?? 1),
    fees: input.fees != null ? Number(input.fees) : 0,
    source: input.source != null ? String(input.source) : "",
    broker: String(input.broker ?? ""),
    strategy: String(input.strategy ?? "long_term"),
  });
  if (!row) throw new Error("Insert failed");

  if (input.transaction_type === "sell" && sellMatches && sellMethod) {
    await insertRealizedLots(
      userId,
      instrumentId,
      row.id,
      sellMethod,
      String(input.buy_date),
      Number(input.buy_price),
      Number(input.buy_fx_rate ?? 1),
      sellMatches,
    );
  }

  if (userSettings.trackCash) {
    const grossAmount = Number(input.units) * Number(input.buy_price);
    const feeAmount = input.fees != null ? Number(input.fees) : 0;
    const cashAmount =
      input.transaction_type === "sell" ? grossAmount - feeAmount : -(grossAmount + feeAmount);
    await insertAutoCashTransaction(userId, row.id, {
      date: String(input.buy_date),
      type: input.transaction_type === "sell" ? "sell" : "buy",
      currency: String(input.currency),
      amount: cashAmount,
      fxRate: Number(input.buy_fx_rate ?? 1),
      broker: String(input.broker ?? ""),
      source: input.source != null ? String(input.source) : "",
    });
  }

  if (input.dividend_yield != null) {
    await upsertHoldingOverride(userId, instrumentId, Number(input.dividend_yield));
    row.dividendYield = Number(input.dividend_yield);
  }

  return row;
}
```

Note: `CCY_FLAG` import is unused here — remove it if lint flags it. (Kept out of `commitLot`; the PATCH path owns flag realignment.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/holdings/commit-lot.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Rewrite `POST` in `route.ts` as a wrapper**

In `src/app/api/holdings/route.ts`, replace the entire `POST` function (lines 45-300) with:

```typescript
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const userSettings = await fetchUserSettings(user.id);
  const body = (await req.json()) as LotCommitInput;

  const invalid = validateLotInput(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const row = await commitLot(user.id, body, userSettings);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof InvalidAllocationError || e instanceof InsufficientOpenQuantityError)
      return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof Error && e.message === "specific cost-basis method requires lot_allocations")
      return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[POST /api/holdings]", e);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
}
```

Update the imports at the top of `route.ts`:
- Add: `import { commitLot, validateLotInput, type LotCommitInput } from "@/lib/holdings/commit-lot";`
- Add: `import { InvalidAllocationError, InsufficientOpenQuantityError } from "@/lib/realized";`
- Remove now-unused imports from the POST path if no longer referenced elsewhere in the file (`upsertInstrument`, `insertLot`, `seedTickerQuote`, `fetchOpenBuyLots`, `insertRealizedLots`, `insertAutoCashTransaction`, `matchSell`, `ManualAllocation`, `CCY_FLAG`). **Check PATCH/DELETE first — several are still used there.** Keep any still referenced. The module-level `TICKER_RE`, `DATE_RE`, `NUM_MAX`, `finiteNonNeg` are still used by PATCH — leave them.

- [ ] **Step 6: Type-check and run the full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run`
Expected: all pass (existing suites + new commit-lot test).

- [ ] **Step 7: Commit**

```bash
git add src/lib/holdings/commit-lot.ts src/lib/holdings/commit-lot.test.ts src/app/api/holdings/route.ts
git commit -m "refactor(holdings): extract commitLot core from POST route

- move validation + instrument/lot/realized/cash sequence to commit-lot
- POST /api/holdings becomes a thin wrapper mapping errors to statuses
- add validateLotInput unit tests"
```

---

## Task 4: `portfolio-io.ts` — CSV helpers (move + harden)

Move CSV parsing/mapping out of `add/page.tsx` into the shared module, make `parseCsv` quote-aware, and add quote-safe export helpers.

**Files:**
- Create: `src/lib/portfolio-io.ts`
- Create/append: `src/lib/portfolio-io.test.ts`
- Modify: `src/app/(dashboard)/add/page.tsx` (remove local CSV defs, import them)

**Interfaces:**
- Produces:
  - `interface CsvRow { [k: string]: string }`
  - `CSV_FIELD_MAP: Record<string,string>`, `csvHeaderKey(h): string`, `parseCsvNumber(v): number`
  - `parseCsv(text): { headers: string[]; rows: CsvRow[] }` (quote-aware)
  - `toCsv(rows: (string|number)[][]): string`
  - `CSV_EXPORT_COLUMNS`, `holdingsToImportCsv(holdings: Holding[]): string`

- [ ] **Step 1: Write failing CSV tests**

Create `src/lib/portfolio-io.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseCsv,
  toCsv,
  parseCsvNumber,
  holdingsToImportCsv,
  CSV_FIELD_MAP,
  csvHeaderKey,
} from "./portfolio-io";
import type { Holding } from "@/types/holding";

const holding = (over: Partial<Holding>): Holding =>
  ({
    id: "1", userId: "u", ticker: "VWRA", name: "Vanguard, All-World",
    assetType: "ETF", exchangeCode: "LSE", broker: "IBKR", strategy: "long_term",
    units: 10, currency: "USD", flag: "🇺🇸", icon: "briefcase",
    buyPrice: 100, buyDate: "2024-01-02", buyFxRate: 1.35,
    currentPrice: 110, currentFxRate: 1.34, sparkData: [],
    createdAt: "", updatedAt: "", priceRefreshedAt: null, source: "",
    dividendYield: null, dividendYieldAuto: null, prevPrice: null,
    prevPriceSource: null, maturityDate: null, parValue: null, couponRate: null,
    transactionType: "buy", fees: 0, ...over,
  }) as Holding;

describe("parseCsvNumber", () => {
  it("strips thousands separators", () => {
    expect(parseCsvNumber("1,234.5")).toBe(1234.5);
  });
});

describe("toCsv / parseCsv round-trip", () => {
  it("survives commas and quotes in a field", () => {
    const csv = toCsv([
      ["Name", "Units"],
      ['Vanguard, "All-World"', 10],
    ]);
    const { rows } = parseCsv(csv);
    expect(rows[0]["Name"]).toBe('Vanguard, "All-World"');
    expect(rows[0]["Units"]).toBe("10");
  });
});

describe("holdingsToImportCsv", () => {
  it("emits importer-mappable headers and re-parses to the original name", () => {
    const csv = holdingsToImportCsv([holding({})]);
    const { headers, rows } = parseCsv(csv);
    // every header maps to a known import field
    for (const h of headers) expect(CSV_FIELD_MAP[csvHeaderKey(h)]).toBeDefined();
    const nameHeader = headers.find((h) => csvHeaderKey(h) === "name")!;
    expect(rows[0][nameHeader]).toBe("Vanguard, All-World");
  });
  it("excludes sell lots", () => {
    const csv = holdingsToImportCsv([holding({ transactionType: "sell" })]);
    expect(parseCsv(csv).rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/portfolio-io.test.ts`
Expected: FAIL — cannot find module `./portfolio-io`.

- [ ] **Step 3: Create `portfolio-io.ts` (CSV section)**

Create `src/lib/portfolio-io.ts`:

```typescript
import type { Holding } from "@/types/holding";

// ── CSV import mapping (moved from add/page.tsx) ─────────────────────────────
export interface CsvRow {
  [key: string]: string;
}

// Lowercased keys — headers are normalized (trim + toLowerCase) before lookup.
export const CSV_FIELD_MAP: Record<string, string> = {
  "name": "name",
  "asset name": "name",
  "stock name": "name",
  "ticker": "ticker",
  "symbol": "ticker",
  "asset type": "asset_type",
  "type": "asset_type",
  "strategy": "strategy",
  "broker": "broker",
  "units": "units",
  "qty": "units",
  "quantity": "units",
  "shares": "units",
  "no. of shares": "units",
  "nominal": "units",
  "currency": "currency",
  "ccy": "currency",
  "purchase price": "buy_price",
  "buy price": "buy_price",
  "price": "buy_price",
  "avg price": "buy_price",
  "cost basis": "buy_price",
  "purchase date": "buy_date",
  "date bought": "buy_date",
  "date": "buy_date",
  "trade date": "buy_date",
  "fx rate": "buy_fx_rate",
  "purchase fx rate": "buy_fx_rate",
};

export const csvHeaderKey = (h: string) => h.trim().toLowerCase();

// parseFloat("1,000") stops at the comma → silent data loss. Strip non-numeric
// characters before parsing.
export function parseCsvNumber(v: string | undefined): number {
  if (v == null) return NaN;
  const cleaned = String(v).replace(/[^\d.\-eE+]/g, "");
  return cleaned === "" ? NaN : parseFloat(cleaned);
}

// Quote-aware, RFC-4180-ish parser: quoted fields may contain commas, newlines,
// and "" escaped quotes. Replaces the old split(",") which broke on those.
export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n") {
      record.push(field); records.push(record); record = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((vals) =>
      Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()])),
    );
  return { headers, rows };
}

// ── CSV export (round-trippable through the importer above) ──────────────────
function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => csvEscape(String(c))).join(",")).join("\n");
}

// Headers chosen so csvHeaderKey(header) is a key in CSV_FIELD_MAP → the export
// re-imports without manual column mapping.
export const CSV_EXPORT_COLUMNS: { header: string; get: (h: Holding) => string | number }[] = [
  { header: "Name", get: (h) => h.name },
  { header: "Ticker", get: (h) => h.ticker },
  { header: "Asset Type", get: (h) => h.assetType },
  { header: "Strategy", get: (h) => h.strategy },
  { header: "Broker", get: (h) => h.broker },
  { header: "Units", get: (h) => h.units },
  { header: "Currency", get: (h) => h.currency },
  { header: "Buy Price", get: (h) => h.buyPrice },
  { header: "Buy Date", get: (h) => h.buyDate },
  { header: "FX Rate", get: (h) => h.buyFxRate },
];

// Buy lots only — the importer has no concept of sells/matching (that's JSON's
// job), so exporting sells here would silently re-import them as buys.
export function holdingsToImportCsv(holdings: Holding[]): string {
  const buys = holdings.filter((h) => h.transactionType !== "sell");
  const header = CSV_EXPORT_COLUMNS.map((c) => c.header);
  const body = buys.map((h) => CSV_EXPORT_COLUMNS.map((c) => c.get(h)));
  return toCsv([header, ...body]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/portfolio-io.test.ts`
Expected: PASS.

- [ ] **Step 5: Point `add/page.tsx` at the shared helpers**

In `src/app/(dashboard)/add/page.tsx`:
- Delete the local `interface CsvRow`, `CSV_FIELD_MAP`, `csvHeaderKey`, `parseCsv`, `parseCsvNumber` (currently lines ~71-129).
- Add to the imports: `import { parseCsv, parseCsvNumber, CSV_FIELD_MAP, csvHeaderKey, type CsvRow } from "@/lib/portfolio-io";`

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (all former local references now resolve to the import).

- [ ] **Step 7: Commit**

```bash
git add src/lib/portfolio-io.ts src/lib/portfolio-io.test.ts src/app/(dashboard)/add/page.tsx
git commit -m "refactor(io): move CSV helpers to portfolio-io with quote-aware parse

- add quote-aware parseCsv + quote-safe toCsv
- add holdingsToImportCsv (buy lots, importer-mappable headers)
- import shared helpers in add page"
```

---

## Task 5: `portfolio-io.ts` — JSON backup helpers

**Files:**
- Modify: `src/lib/portfolio-io.ts` (append JSON section)
- Modify: `src/lib/portfolio-io.test.ts` (append tests)

**Interfaces:**
- Consumes: `LotCommitInput` (Task 3), `Holding` (Task 1), `RealizedLot`, `CostBasisMethod`.
- Produces:
  - `BACKUP_SCHEMA = "portfolio-backup"`, `BACKUP_VERSION = 1`
  - `interface SellRestore { method: CostBasisMethod; allocations: { buyLotId: string; qty: number }[] }`
  - `interface BackupEnvelope { schema: "portfolio-backup"; version: 1; exportedAt: string; lots: Holding[]; sells: Record<string, SellRestore> }`
  - `buildBackupEnvelope(holdings: Holding[], realized: RealizedLot[], exportedAt: string): BackupEnvelope`
  - `parseBackup(text: string): BackupEnvelope`
  - `backupLotToCommitInput(lot: Holding): LotCommitInput`
  - `orderLotsForRestore(lots: Holding[]): { buys: Holding[]; sells: Holding[] }`
  - `remapAllocations(allocations, idMap): { buyLotId: string; qty: number }[]`

- [ ] **Step 1: Write failing JSON tests (append to `portfolio-io.test.ts`)**

Add these imports to the existing import block and a new describe block:

```typescript
import {
  buildBackupEnvelope,
  parseBackup,
  orderLotsForRestore,
  remapAllocations,
  backupLotToCommitInput,
  BACKUP_SCHEMA,
} from "./portfolio-io";
import type { RealizedLot } from "@/types/realized";

describe("buildBackupEnvelope", () => {
  it("groups realized rows into per-sell allocations", () => {
    const realized = [
      { sellLotId: "s1", buyLotId: "b1", method: "specific", matchedQuantity: 4 },
      { sellLotId: "s1", buyLotId: "b2", method: "specific", matchedQuantity: 6 },
    ] as RealizedLot[];
    const env = buildBackupEnvelope([holding({ id: "b1" })], realized, "2026-07-22T00:00:00Z");
    expect(env.schema).toBe(BACKUP_SCHEMA);
    expect(env.sells["s1"].method).toBe("specific");
    expect(env.sells["s1"].allocations).toEqual([
      { buyLotId: "b1", qty: 4 },
      { buyLotId: "b2", qty: 6 },
    ]);
  });
});

describe("parseBackup", () => {
  it("rejects a non-backup file", () => {
    expect(() => parseBackup(JSON.stringify([{ ticker: "x" }]))).toThrow();
  });
  it("rejects an unknown version", () => {
    expect(() =>
      parseBackup(JSON.stringify({ schema: BACKUP_SCHEMA, version: 999, lots: [] })),
    ).toThrow(/version/i);
  });
  it("accepts a valid envelope", () => {
    const env = buildBackupEnvelope([holding({})], [], "t");
    expect(parseBackup(JSON.stringify(env)).lots).toHaveLength(1);
  });
});

describe("orderLotsForRestore", () => {
  it("splits buys/sells and sorts each by date", () => {
    const lots = [
      holding({ id: "a", transactionType: "sell", buyDate: "2024-03-01" }),
      holding({ id: "b", transactionType: "buy", buyDate: "2024-02-01" }),
      holding({ id: "c", transactionType: "buy", buyDate: "2024-01-01" }),
    ];
    const { buys, sells } = orderLotsForRestore(lots);
    expect(buys.map((l) => l.id)).toEqual(["c", "b"]);
    expect(sells.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("remapAllocations", () => {
  it("translates old ids and throws on an unmapped id", () => {
    expect(remapAllocations([{ buyLotId: "old", qty: 2 }], { old: "new" })).toEqual([
      { buyLotId: "new", qty: 2 },
    ]);
    expect(() => remapAllocations([{ buyLotId: "x", qty: 1 }], {})).toThrow();
  });
});

describe("backupLotToCommitInput", () => {
  it("maps camelCase to snake_case and carries exchange_code", () => {
    const input = backupLotToCommitInput(holding({ exchangeCode: "LSE" }));
    expect(input.asset_type).toBe("ETF");
    expect(input.buy_price).toBe(100);
    expect(input.exchange_code).toBe("LSE");
    expect(input.transaction_type).toBe("buy");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/portfolio-io.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Append the JSON section to `portfolio-io.ts`**

```typescript
// ── JSON backup envelope ─────────────────────────────────────────────────────
import type { LotCommitInput } from "@/lib/holdings/commit-lot";
import type { RealizedLot } from "@/types/realized";
import type { CostBasisMethod } from "@/types/settings";

export const BACKUP_SCHEMA = "portfolio-backup";
export const BACKUP_VERSION = 1;

export interface SellRestore {
  method: CostBasisMethod;
  allocations: { buyLotId: string; qty: number }[];
}

export interface BackupEnvelope {
  schema: typeof BACKUP_SCHEMA;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  lots: Holding[];
  sells: Record<string, SellRestore>;
}

export function buildBackupEnvelope(
  holdings: Holding[],
  realized: RealizedLot[],
  exportedAt: string,
): BackupEnvelope {
  const sells: Record<string, SellRestore> = {};
  for (const r of realized) {
    const entry = sells[r.sellLotId] ?? { method: r.method, allocations: [] };
    entry.allocations.push({ buyLotId: r.buyLotId, qty: r.matchedQuantity });
    sells[r.sellLotId] = entry;
  }
  return { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt, lots: holdings, sells };
}

export function parseBackup(text: string): BackupEnvelope {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj))
    throw new Error("This file isn't a portfolio backup.");
  const e = obj as Record<string, unknown>;
  if (e.schema !== BACKUP_SCHEMA) throw new Error("This file isn't a portfolio backup.");
  if (e.version !== BACKUP_VERSION)
    throw new Error(`Unsupported backup version (${String(e.version)}).`);
  if (!Array.isArray(e.lots)) throw new Error("Backup is missing its lots.");
  const sells =
    e.sells && typeof e.sells === "object" && !Array.isArray(e.sells)
      ? (e.sells as Record<string, SellRestore>)
      : {};
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: String(e.exportedAt ?? ""),
    lots: e.lots as Holding[],
    sells,
  };
}

export function orderLotsForRestore(lots: Holding[]): { buys: Holding[]; sells: Holding[] } {
  const byDate = (a: Holding, b: Holding) => a.buyDate.localeCompare(b.buyDate);
  return {
    buys: lots.filter((l) => l.transactionType !== "sell").sort(byDate),
    sells: lots.filter((l) => l.transactionType === "sell").sort(byDate),
  };
}

export function remapAllocations(
  allocations: { buyLotId: string; qty: number }[],
  idMap: Record<string, string>,
): { buyLotId: string; qty: number }[] {
  return allocations.map((a) => {
    const mapped = idMap[a.buyLotId];
    if (!mapped) throw new Error(`No restored buy lot for id ${a.buyLotId}`);
    return { buyLotId: mapped, qty: a.qty };
  });
}

export function backupLotToCommitInput(lot: Holding): LotCommitInput {
  return {
    ticker: lot.ticker,
    name: lot.name,
    asset_type: lot.assetType,
    broker: lot.broker,
    strategy: lot.strategy,
    units: lot.units,
    currency: lot.currency,
    flag: lot.flag,
    icon: lot.icon,
    buy_price: lot.buyPrice,
    buy_date: lot.buyDate,
    buy_fx_rate: lot.buyFxRate,
    current_price: lot.currentPrice,
    current_fx_rate: lot.currentFxRate,
    spark_data: lot.sparkData,
    exchange_code: lot.exchangeCode,
    source: lot.source,
    fees: lot.fees,
    transaction_type: lot.transactionType,
    maturity_date: lot.maturityDate,
    par_value: lot.parValue,
    coupon_rate: lot.couponRate,
    dividend_yield: lot.dividendYield,
  };
}
```

(The `import type` lines may be moved to the top of the file with the other imports — grouping is a lint preference, not correctness.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/portfolio-io.test.ts`
Expected: PASS (CSV + JSON blocks).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/portfolio-io.ts src/lib/portfolio-io.test.ts
git commit -m "feat(io): add versioned JSON backup helpers

- buildBackupEnvelope groups realized rows into per-sell allocations
- parseBackup validates schema/version/shape
- add orderLotsForRestore, remapAllocations, backupLotToCommitInput"
```

---

## Task 6: Export endpoint `GET /api/holdings/backup`

**Files:**
- Create: `src/app/api/holdings/backup/route.ts`

**Interfaces:**
- Consumes: `fetchHoldings`, `fetchRealizedLots`, `buildBackupEnvelope`, `requireAuth`.

- [ ] **Step 1: Create the route**

Create `src/app/api/holdings/backup/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchHoldings, fetchRealizedLots } from "@/lib/supabase/data";
import { buildBackupEnvelope } from "@/lib/portfolio-io";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const [holdings, realized] = await Promise.all([
    fetchHoldings(user.id),
    fetchRealizedLots(user.id),
  ]);

  const envelope = buildBackupEnvelope(holdings, realized, new Date().toISOString());
  return NextResponse.json(envelope, {
    headers: {
      "Content-Disposition": 'attachment; filename="portfolio-backup.json"',
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`fetchHoldings` returns `HoldingRow[]`, assignable to `Holding[]`.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/holdings/backup/route.ts
git commit -m "feat(api): add GET /api/holdings/backup export endpoint"
```

---

## Task 7: Restore endpoint `POST /api/holdings/restore`

**Files:**
- Create: `src/app/api/holdings/restore/route.ts`

**Interfaces:**
- Consumes: `requireAuth`, `fetchUserSettings`, `deleteAllLotsForUser`, `commitLot`, `validateLotInput`, `parseBackup`, `orderLotsForRestore`, `backupLotToCommitInput`, `remapAllocations`.

- [ ] **Step 1: Create the route**

Create `src/app/api/holdings/restore/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchUserSettings, deleteAllLotsForUser } from "@/lib/supabase/data";
import { commitLot, validateLotInput } from "@/lib/holdings/commit-lot";
import {
  parseBackup,
  orderLotsForRestore,
  backupLotToCommitInput,
  remapAllocations,
} from "@/lib/portfolio-io";

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || (body.mode !== "append" && body.mode !== "replace"))
    return NextResponse.json({ error: "mode must be 'append' or 'replace'" }, { status: 400 });

  let envelope;
  try {
    const text = typeof body.envelope === "string" ? body.envelope : JSON.stringify(body.envelope);
    envelope = parseBackup(text);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid backup" },
      { status: 400 },
    );
  }

  const { buys, sells } = orderLotsForRestore(envelope.lots);

  // Validate the whole envelope before touching the DB (never wipe on bad data).
  for (const lot of [...buys, ...sells]) {
    const msg = validateLotInput(backupLotToCommitInput(lot));
    if (msg)
      return NextResponse.json(
        { error: `Invalid lot (${lot.ticker || "?"}): ${msg}` },
        { status: 400 },
      );
  }

  const userSettings = await fetchUserSettings(user.id);

  if (body.mode === "replace") await deleteAllLotsForUser(user.id);

  const idMap: Record<string, string> = {};
  let restored = 0;
  let failed = 0;
  const errors: string[] = [];
  const note = (t: string, e: unknown) => {
    failed++;
    if (errors.length < 5) errors.push(`${t}: ${e instanceof Error ? e.message : "failed"}`);
  };

  for (const lot of buys) {
    try {
      const row = await commitLot(user.id, backupLotToCommitInput(lot), userSettings);
      idMap[lot.id] = row.id;
      restored++;
    } catch (e) {
      note(lot.ticker, e);
    }
  }

  for (const lot of sells) {
    const input = backupLotToCommitInput(lot);
    input.transaction_type = "sell";
    const meta = envelope.sells[lot.id];
    if (meta) {
      input.cost_basis_method = meta.method;
      if (meta.method === "specific") {
        try {
          input.lot_allocations = remapAllocations(meta.allocations, idMap);
        } catch (e) {
          note(lot.ticker, e);
          continue;
        }
      }
    }
    try {
      await commitLot(user.id, input, userSettings);
      restored++;
    } catch (e) {
      note(lot.ticker, e);
    }
  }

  return NextResponse.json({ restored, failed, errors });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/holdings/restore/route.ts
git commit -m "feat(api): add POST /api/holdings/restore server-side restore

- validate whole envelope up front before any wipe/insert
- replace mode wipes via deleteAllLotsForUser, then replays
- commit buys (build id map), then sells with remapped allocations"
```

---

## Task 8: Holdings report CSV uses `toCsv`

**Files:**
- Modify: `src/app/(dashboard)/holdings/page.tsx` (`handleCsvExport`, ~line 1129-1163)

- [ ] **Step 1: Swap the manual join for `toCsv`**

In `handleCsvExport`, replace:

```typescript
    const csv = [cols, ...rowData].map((r) => r.join(",")).join("\n");
```

with:

```typescript
    const csv = toCsv([cols, ...rowData]);
```

Add to the imports at the top of the file: `import { toCsv } from "@/lib/portfolio-io";`

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`cols` is `string[]`, `rowData` is `(string|number)[][]` — both accepted by `toCsv`.)

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/holdings/page.tsx
git commit -m "fix(holdings): quote-safe report CSV export via toCsv"
```

---

## Task 9: Panel-level export buttons (JSON backup + importable CSV)

Replace the existing "Export JSON" button (which dumps raw `/api/holdings`) with two exports wired to the new endpoint and helper.

**Files:**
- Modify: `src/app/(dashboard)/add/page.tsx` (`ImportPanel`, export button block ~line 891-903)

**Interfaces:**
- Consumes: `GET /api/holdings/backup`, `holdingsToImportCsv`.

- [ ] **Step 1: Add the import**

Extend the `portfolio-io` import in `add/page.tsx` to include `holdingsToImportCsv`:

```typescript
import { parseCsv, parseCsvNumber, CSV_FIELD_MAP, csvHeaderKey, holdingsToImportCsv, type CsvRow } from "@/lib/portfolio-io";
```

- [ ] **Step 2: Add two download handlers inside `ImportPanel`**

Add near the top of the `ImportPanel` component body (after the existing `useState` hooks):

```typescript
  const downloadJsonBackup = async () => {
    const res = await fetch("/api/holdings/backup");
    if (!res.ok) { toast.error("Export failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "portfolio-backup.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = async () => {
    const res = await fetch("/api/holdings");
    if (!res.ok) { toast.error("Export failed"); return; }
    const holdings = await res.json();
    const csv = holdingsToImportCsv(holdings);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "portfolio-holdings.csv"; a.click();
    URL.revokeObjectURL(url);
  };
```

- [ ] **Step 3: Replace the export button block**

Replace the existing export `<div className="flex gap-3 mt-5"> … </div>` block (the current single "Export JSON" button, lines ~891-903) with two buttons:

```tsx
          <div className="flex gap-3 mt-5">
            <button
              className="flex flex-1 items-center justify-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle p-[11px] font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-primary light:border-black/[.12]"
              onClick={downloadJsonBackup}>
              <Icon name="download" size={15} />
              Export JSON
            </button>
            <button
              className="flex flex-1 items-center justify-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle p-[11px] font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-primary light:border-black/[.12]"
              onClick={downloadCsv}>
              <Icon name="download" size={15} />
              Export CSV
            </button>
          </div>
          <div className="font-ui text-secondary text-[11px] tracking-[.04em] text-center mt-3">
            JSON is a full backup (restore on the JSON tab). CSV holds buy lots only.
          </div>
```

Note: this block currently lives inside the `importMode === "csv"` fragment. Leave it there for now; it becomes shared across CSV/JSON tabs in Task 10 when the JSON tab is added. `toast` is already imported in this file.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/add/page.tsx
git commit -m "feat(add): wire JSON backup + importable CSV export buttons"
```

---

## Task 10: JSON import tab + restore wiring

Add a third import tab that parses a backup for a preview, offers Append/Replace (Replace gated on typing `REPLACE`), and POSTs to `/api/holdings/restore`.

**Files:**
- Modify: `src/app/(dashboard)/add/page.tsx` (`ImportPanel`)

**Interfaces:**
- Consumes: `parseBackup`, `POST /api/holdings/restore`.

- [ ] **Step 1: Extend the import**

Add `parseBackup` and its type to the `portfolio-io` import:

```typescript
import { parseCsv, parseCsvNumber, CSV_FIELD_MAP, csvHeaderKey, holdingsToImportCsv, parseBackup, type CsvRow, type BackupEnvelope } from "@/lib/portfolio-io";
```

- [ ] **Step 2: Add JSON state + handlers in `ImportPanel`**

Add after the existing state hooks:

```typescript
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const [jsonEnv, setJsonEnv] = useState<BackupEnvelope | null>(null);
  const [restoreMode, setRestoreMode] = useState<"append" | "replace">("append");
  const [replaceConfirm, setReplaceConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState("");

  const handleJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const env = parseBackup((e.target?.result as string) ?? "");
        setJsonEnv(env);
        setRestoreResult("");
      } catch (err) {
        setJsonEnv(null);
        toast.error(err instanceof Error ? err.message : "Invalid backup file");
      }
    };
    reader.readAsText(file);
  };

  const handleRestore = async () => {
    if (!jsonEnv) return;
    if (restoreMode === "replace" && replaceConfirm !== "REPLACE") return;
    setRestoring(true);
    setRestoreResult("");
    try {
      const res = await fetch("/api/holdings/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelope: jsonEnv, mode: restoreMode }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Restore failed"); setRestoring(false); return; }
      const summary = `Restored ${data.restored}${data.failed ? ` · ${data.failed} failed` : ""}.`;
      setRestoreResult(summary);
      if (data.failed) toast.warning(summary); else toast.success(summary);
      router.refresh();
    } catch {
      toast.error("Restore failed");
    }
    setRestoring(false);
  };

  const jsonCounts = jsonEnv
    ? {
        buys: jsonEnv.lots.filter((l) => l.transactionType !== "sell").length,
        sells: jsonEnv.lots.filter((l) => l.transactionType === "sell").length,
      }
    : null;
```

- [ ] **Step 3: Add "json" to the tab switcher**

Change the tab-button map to include `json`. Replace:

```tsx
          {(["csv", "pdf"] as const).map((mode) => (
```

with:

```tsx
          {(["csv", "json", "pdf"] as const).map((mode) => (
```

Update the `importMode` state type from `useState<"csv" | "pdf">("csv")` to `useState<"csv" | "json" | "pdf">("csv")`.

- [ ] **Step 4: Add the JSON panel JSX**

After the `{importMode === "csv" && ( … )}` fragment and before `{importMode === "pdf" && <PdfImportPanel />}`, add:

```tsx
      {importMode === "json" && (
        <>
          <input ref={jsonFileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.[0]) handleJsonFile(e.target.files[0]); }} />
          <div
            className="flex flex-col items-center gap-[7px] text-center border-[1.5px] border-dashed rounded-[13px] cursor-pointer px-5 py-[30px] bg-surface border-gold-soft hover:bg-elevated hover:border-gold [transition:background_.2s,border-color_.2s]"
            onClick={() => jsonFileRef.current?.click()}>
            <Icon name="upload" size={26} style={{ color: "var(--gold)" }} />
            <div className="font-ui text-[14px] font-semibold mt-1">Drop a portfolio-backup.json</div>
            <div className="font-ui text-secondary">or click to browse</div>
            <div className="font-ui text-secondary text-[11px] tracking-[.04em] mt-2">Full restore — buys, sells &amp; realized P&amp;L</div>
          </div>

          {jsonEnv && jsonCounts && (
            <div className="mt-[18px] flex flex-col gap-3">
              <div className="font-ui text-[13px] text-primary">
                {jsonCounts.buys} buy{jsonCounts.buys !== 1 ? "s" : ""}, {jsonCounts.sells} sell{jsonCounts.sells !== 1 ? "s" : ""} in this backup.
              </div>
              <div className="flex gap-1.5">
                {(["append", "replace"] as const).map((m) => (
                  <button key={m}
                    className={"cursor-pointer rounded-lg border px-[11px] py-[5px] font-ui text-[11px] uppercase tracking-[.06em] transition-all duration-150 " + (restoreMode === m ? "border-gold-soft bg-wash text-gold" : "border-subtle bg-surface text-secondary hover:border-muted hover:text-primary")}
                    onClick={() => setRestoreMode(m)}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="font-ui text-secondary text-[11.5px]">
                {restoreMode === "append"
                  ? "Adds these lots on top of your current holdings (may duplicate)."
                  : "Deletes all current holdings first, then restores this backup."}
              </div>
              {restoreMode === "replace" && (
                <input type="text" value={replaceConfirm} onChange={(e) => setReplaceConfirm(e.target.value)}
                  placeholder="Type REPLACE to confirm"
                  className="rounded-[9px] border border-subtle bg-surface px-3 py-2 font-ui text-[13px] text-primary outline-none focus:border-gold-soft" />
              )}
              {restoreResult && <div className="font-ui text-[12.5px]" style={{ color: "var(--gain)" }}>{restoreResult}</div>}
              <button
                className="flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default"
                onClick={handleRestore}
                disabled={restoring || (restoreMode === "replace" && replaceConfirm !== "REPLACE")}>
                <Icon name="upload" size={15} />
                {restoring ? "Restoring…" : restoreMode === "replace" ? "Replace & restore" : "Restore"}
              </button>
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button
              className="flex flex-1 items-center justify-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle p-[11px] font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-primary light:border-black/[.12]"
              onClick={downloadJsonBackup}>
              <Icon name="download" size={15} />
              Export JSON
            </button>
            <button
              className="flex flex-1 items-center justify-center gap-[7px] cursor-pointer rounded-[9px] border border-subtle p-[11px] font-ui text-[12.5px] text-secondary transition-all duration-150 hover:border-gold-soft hover:text-primary light:border-black/[.12]"
              onClick={downloadCsv}>
              <Icon name="download" size={15} />
              Export CSV
            </button>
          </div>
        </>
      )}
```

- [ ] **Step 5: Type-check + lint + full test run**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no new errors.
Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, log in, go to Add → Import & Backup:
1. **Export JSON** → downloads `portfolio-backup.json`.
2. JSON tab → drop that file → shows "N buys, M sells".
3. **Append** → Restore → toast "Restored N" and holdings double (append semantics).
4. Undo by deleting duplicates, then **Replace** → type `REPLACE` → Restore → holdings match the backup exactly, including any closed/sold positions (check the Closed tab on Holdings).
Expected: realized P&L on restored sells matches the pre-export values.

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/add/page.tsx
git commit -m "feat(add): add JSON restore tab with append/replace modes"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** exchangeCode (T1) ✓; RESTRICT fixes for both `deleteAllLotsForUser` and `purgeUser` (T2) ✓; commitLot extraction + POST wrapper (T3) ✓; CSV move/harden + round-trip (T4, T8) ✓; JSON envelope + parse/order/remap/map (T5) ✓; export endpoint (T6) ✓; server-side restore with up-front validation + append/replace (T7, T10) ✓; typed REPLACE confirm (T10) ✓; buys-only CSV export (T4/T9) ✓.
- **Type consistency:** `LotCommitInput` defined in T3 and consumed by `backupLotToCommitInput` (T5) and both routes; `BackupEnvelope.lots: Holding[]` consumed consistently by `orderLotsForRestore`/routes; `commitLot(userId, input, userSettings): Promise<HoldingRow>` used identically in POST and restore.
- **Known scope notes:** lot `notes` not carried (Holding doesn't expose it); restore is single-request, not a DB transaction (matches `purgeUser`). Both documented in the spec.
