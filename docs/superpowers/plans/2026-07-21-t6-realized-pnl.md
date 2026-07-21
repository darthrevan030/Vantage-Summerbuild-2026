# T6 — Realized P&L + Cost-Basis Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record realized gain/loss when a sell lot is matched against prior buy lots (FIFO / average / specific-lot, user-selectable), keep closed positions visible with their lifetime realized P&L, and fold `fees` into gain math everywhere (it's currently stored but never used).

**Architecture:** A new `realized_lots` table stores one frozen row per matched buy↔sell pair, written once at sell-commit time (never recomputed lazily). A pure matching module (`src/lib/realized.ts`) implements FIFO/average/specific-lot allocation. The existing per-lot SGD gain formulas (`src/lib/fx.ts`) and the netted-position formulas (`src/lib/group-holdings.ts`) both gain a fee term using the same convention. The API, dashboard data flow, Settings page, sell form, and Holdings page are extended to surface method selection and realized/closed-position data.

**Tech Stack:** Next.js 16 App Router (server components + route handlers), Supabase (Postgres + RLS), TypeScript strict, Vitest (new — see Task 1).

## Global Constraints

- TypeScript strict mode — every new file must type-check with `npx tsc --noEmit` (no errors introduced anywhere in the repo).
- No comments except where a hidden constraint or non-obvious invariant would otherwise be lost — match the terse style already in the codebase (e.g. `fx.ts`, `group-holdings.ts`).
- All monetary values are computed and stored in SGD internally; UI display conversion happens only via `usePortfolio()`'s `toBase`/`fmtVal`/`fmtSigned` — never format currency by hand in a page.
- Pages read derived data from `usePortfolio()` context, populated by the server layout (`src/app/(dashboard)/layout.tsx`) — never fetch core portfolio data client-side in a page component.
- After any mutation (POST/PATCH/DELETE), the client calls `router.refresh()` — do not manually re-fetch and patch local state.
- Every new Supabase migration follows the existing idempotent pattern: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`.
- **Design refinement made during planning** (not in the original design doc): editing a sell lot's financial fields (quantity/price/date/fx/fees) after it already has `realized_lots` rows is **blocked with a 409**, not silently rematched. This is simpler and safer than the "delete and rematch" approach originally sketched, and avoids a subtlety where a rematch could silently discard a user's original specific-lot choice. Deleting and re-entering the sale is the supported path to fix a mistake (delete cascades `realized_lots` automatically via `ON DELETE CASCADE`).
- **Design refinement:** the *open* (unrealized) position's average cost basis, shown via `toNetPositions`/`netAggregate`, always uses simple average-cost across all buy lots minus total sold — it does **not** re-derive itself from whichever specific lots FIFO/specific-lot matching actually closed. The chosen cost-basis method only controls which gain is recognized as *realized* at the moment of sale (this is what matters for tax/record-keeping, the stated reason FIFO/specific-lot exists at all per the backlog doc). This keeps `toNetPositions` (used by Hero stats, allocations, movers, currency cards, the Holdings Grouped view) simple and untouched by realized-lot bookkeeping.
- No new API route for manual reconcile-trigger — the backfill (`reconcileRealizedLots`) runs automatically and idempotently from the dashboard server layout on every load; it's a no-op after the first real run. Any legacy oversold-sell warnings are `console.warn`'d server-side (matches the codebase's existing best-effort logging style, e.g. `correctInstrumentCurrency`).

---

### Task 1: Vitest infra + fee-aware unrealized gain math (`fx.ts`)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `src/lib/fx.ts`
- Create: `src/lib/fx.test.ts`

**Interfaces:**
- Produces: `computeCurrentValueSGD`, `computeCostBasisSGD`, `computeAssetGainSGD`, `computeFxGainSGD` (same signatures as today, `(h: Holding) => number`) — now fee-aware. Every later task that reads `HoldingRow.costSGD`/`assetGain`/`fxGain` (all of them, since these are computed once in `toHoldingRow`) inherits this fix automatically.

- [ ] **Step 1: Add Vitest as a dev dependency and wire the test script**

Edit `package.json`: add to `"scripts"`:
```json
    "test": "vitest run",
```
(insert as a new line after `"lint": "eslint"`, with a trailing comma added to the `lint` line)

Add to `"devDependencies"`:
```json
    "vitest": "^3.2.4",
```

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Install and verify the runner works with zero tests**

Run: `npm install`
Then run: `npm test`
Expected: Vitest reports "No test files found" (non-zero exit is fine here — there are no `*.test.ts` files yet). This just confirms the binary and config load without error.

- [ ] **Step 4: Write the failing tests for fee-aware gain math**

Create `src/lib/fx.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  computeCurrentValueSGD,
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "./fx";
import type { Holding } from "@/types/holding";

function makeHolding(overrides: Partial<Holding> = {}): Holding {
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
    ...overrides,
  };
}

describe("fee-aware SGD gain calculations", () => {
  it("computeCostBasisSGD includes fees converted at the buy FX rate", () => {
    const h = makeHolding({ fees: 20 });
    expect(computeCostBasisSGD(h)).toBeCloseTo(1326, 6);
  });

  it("computeCostBasisSGD matches the zero-fee case (regression)", () => {
    const h = makeHolding({ fees: 0 });
    expect(computeCostBasisSGD(h)).toBeCloseTo(10 * 100 * 1.3, 6);
  });

  it("computeAssetGainSGD subtracts the fee valued at buyFxRate", () => {
    const h = makeHolding({ fees: 20 });
    expect(computeAssetGainSGD(h)).toBeCloseTo(244, 6);
  });

  it("computeFxGainSGD is unaffected by fees", () => {
    const h = makeHolding({ fees: 20 });
    expect(computeFxGainSGD(h)).toBeCloseTo(50, 6);
  });

  it("assetGain + fxGain telescopes exactly to valueSGD - costSGD", () => {
    const h = makeHolding({ fees: 37 });
    const value = computeCurrentValueSGD(h);
    const cost = computeCostBasisSGD(h);
    expect(computeAssetGainSGD(h) + computeFxGainSGD(h)).toBeCloseTo(
      value - cost,
      6,
    );
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run src/lib/fx.test.ts`
Expected: FAIL — `computeCostBasisSGD`/`computeAssetGainSGD` don't yet include the fee term, so the first, third, and fifth assertions fail (the zero-fee regression test and the FX-gain test should already pass, since fees default to 0 in the current implementation too).

- [ ] **Step 6: Implement the fee-aware formulas**

Edit `src/lib/fx.ts` — replace the whole file:
```ts
import type { Holding } from "@/types/holding";

export function computeCurrentValueSGD(h: Holding): number {
  return h.units * h.currentPrice * h.currentFxRate;
}

// Cost basis includes the buy-side fee, converted to SGD at the buy's own FX
// rate — a fee is a fixed historical outlay, valued once at the rate in force
// when it was paid.
export function computeCostBasisSGD(h: Holding): number {
  return (h.units * h.buyPrice + h.fees) * h.buyFxRate;
}

// Fee is subtracted here (not from fxGain) and valued at buyFxRate, matching
// computeCostBasisSGD, so assetGain + fxGain telescopes exactly to
// computeCurrentValueSGD(h) - computeCostBasisSGD(h).
export function computeAssetGainSGD(h: Holding): number {
  return (
    h.units * (h.currentPrice - h.buyPrice) * h.currentFxRate -
    h.fees * h.buyFxRate
  );
}

export function computeFxGainSGD(h: Holding): number {
  return h.units * h.buyPrice * (h.currentFxRate - h.buyFxRate);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/fx.test.ts`
Expected: PASS (5/5).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/fx.ts src/lib/fx.test.ts
git commit -m "Add Vitest and fold fees into unrealized SGD gain math"
```

---

### Task 2: Fee-aware netted-position math (`group-holdings.ts`)

**Files:**
- Modify: `src/lib/group-holdings.ts`
- Create: `src/lib/group-holdings.test.ts`

**Interfaces:**
- Consumes: nothing new (operates on `HoldingRow[]`, unchanged type).
- Produces: `netAggregate` (internal), `groupHoldings`, `toNetPositions` — same signatures as today. `toNetPositions` feeds `computeHeroStats`, `computeAllocationByAsset/ByGeo/BySource`, `computeMovers`, `computeCurrencyCards` in `portfolio.ts` (Task 7 onward) — all inherit this fix automatically.

**Why this task exists:** `netAggregate` computes cost/gain independently from `fx.ts` (its own weighted-average math), so Task 1's fix does not reach it. Without this task, the flat per-lot Holdings table would show fee-adjusted numbers while every netted total (Hero stats, allocations, movers, the Holdings Grouped view) would not — an inconsistency, not a fix.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/group-holdings.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { groupHoldings, toNetPositions } from "./group-holdings";
import type { HoldingRow } from "@/types/holding";

function makeRow(overrides: Partial<HoldingRow> = {}): HoldingRow {
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

describe("netAggregate fee-awareness (via toNetPositions)", () => {
  it("folds fees from two buy lots into the netted cost basis and asset gain", () => {
    const lot1 = makeRow({ id: "b1", units: 10, buyPrice: 100, fees: 13 });
    const lot2 = makeRow({ id: "b2", units: 20, buyPrice: 110, fees: 0 });
    const [pos] = toNetPositions([lot1, lot2]);
    expect(pos.costSGD).toBeCloseTo(4176.9, 6);
    expect(pos.assetGain).toBeCloseTo(523.1, 6);
    expect(pos.fxGain).toBeCloseTo(160, 6);
    expect(pos.assetGain + pos.fxGain).toBeCloseTo(pos.valueSGD - pos.costSGD, 6);
  });

  it("scales the allocated fee down proportionally after a partial sell", () => {
    const buy = makeRow({
      id: "b1",
      units: 10,
      buyPrice: 100,
      fees: 20,
      transactionType: "buy",
    });
    const sell = makeRow({
      id: "s1",
      units: 4,
      buyPrice: 999, // sale price — irrelevant to netAggregate's cost math
      fees: 0,
      transactionType: "sell",
    });
    const [pos] = toNetPositions([buy, sell]);
    expect(pos.units).toBeCloseTo(6, 6);
    expect(pos.costSGD).toBeCloseTo(795.6, 6);
    expect(pos.assetGain).toBeCloseTo(146.4, 6);
    expect(pos.fxGain).toBeCloseTo(30, 6);
    expect(pos.assetGain + pos.fxGain).toBeCloseTo(pos.valueSGD - pos.costSGD, 6);
  });

  it("matches the zero-fee case (regression)", () => {
    const lot = makeRow({ fees: 0 });
    const [pos] = toNetPositions([lot]);
    expect(pos.costSGD).toBeCloseTo(10 * 100 * 1.3, 6);
    expect(pos.assetGain).toBeCloseTo(10 * (120 - 100) * 1.35, 6);
  });

  it("still drops a fully-closed position (regression)", () => {
    const buy = makeRow({ id: "b1", units: 10, transactionType: "buy" });
    const sell = makeRow({ id: "s1", units: 10, transactionType: "sell" });
    expect(toNetPositions([buy, sell])).toHaveLength(0);
  });
});

describe("groupHoldings fee-awareness", () => {
  it("carries the same fee-aware totals into the grouped view", () => {
    const lot1 = makeRow({ id: "b1", units: 10, buyPrice: 100, fees: 13 });
    const lot2 = makeRow({ id: "b2", units: 20, buyPrice: 110, fees: 0 });
    const [group] = groupHoldings([lot1, lot2]);
    expect(group.costSGD).toBeCloseTo(4176.9, 6);
    expect(group.assetGain).toBeCloseTo(523.1, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/group-holdings.test.ts`
Expected: FAIL on the two fee-bearing assertions (costSGD/assetGain) in the first two `netAggregate` tests and the `groupHoldings` test; the zero-fee regression and closed-position tests should already pass.

- [ ] **Step 3: Implement the fee-aware `netAggregate`**

Edit `src/lib/group-holdings.ts` — replace the `netAggregate` function body:
```ts
function netAggregate(lots: HoldingRow[]): NetAgg {
  let buyUnits = 0;
  let sellUnits = 0;
  let pxWeighted = 0;
  let fxWeighted = 0;
  let buyFeesTotal = 0;
  let curPx = 0;
  let curFx = 1;

  for (const l of lots) {
    if (l.transactionType === "sell") {
      sellUnits += l.units;
    } else {
      buyUnits += l.units;
      pxWeighted += l.units * l.buyPrice;
      fxWeighted += l.units * l.buyFxRate;
      buyFeesTotal += l.fees;
      // Same instrument across the group → same live quote/FX.
      curPx = l.currentPrice;
      curFx = l.currentFxRate;
    }
  }

  // No buys (only sells, or empty) → nothing held, no basis.
  if (buyUnits === 0) {
    const f = lots[0];
    return {
      netUnits: 0,
      costSGD: 0,
      valueSGD: 0,
      assetGain: 0,
      fxGain: 0,
      totalPct: 0,
      avgBuyPx: f?.buyPrice ?? 0,
      avgBuyFx: f?.buyFxRate ?? 1,
      curPx: f?.currentPrice ?? 0,
      curFx: f?.currentFxRate ?? 1,
    };
  }

  const avgBuyPx = pxWeighted / buyUnits;
  const avgBuyFx = fxWeighted / buyUnits;
  const avgFeePerUnit = buyFeesTotal / buyUnits;
  const netUnits = Math.max(buyUnits - sellUnits, 0);
  const costSGD = netUnits * (avgBuyPx + avgFeePerUnit) * avgBuyFx;
  const valueSGD = netUnits * curPx * curFx;
  const assetGain =
    netUnits * (curPx - avgBuyPx) * curFx - netUnits * avgFeePerUnit * avgBuyFx;
  const fxGain = netUnits * avgBuyPx * (curFx - avgBuyFx);
  const totalPct = costSGD > 0 ? ((valueSGD - costSGD) / costSGD) * 100 : 0;

  return {
    netUnits,
    costSGD,
    valueSGD,
    assetGain,
    fxGain,
    totalPct,
    avgBuyPx,
    avgBuyFx,
    curPx,
    curFx,
  };
}
```
(Only the function body changes — the docstring comment above it, `bucketByPosition`, `groupHoldings`, and `toNetPositions` are unchanged.)

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run src/lib/group-holdings.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/group-holdings.ts src/lib/group-holdings.test.ts
git commit -m "Fold fees into netted-position cost basis and gain math"
```

---

### Task 3: Matching algorithm (`src/lib/realized.ts`)

**Files:**
- Create: `src/lib/realized.ts`
- Create: `src/lib/realized.test.ts`
- Modify: `src/types/settings.ts` (add `CostBasisMethod` type — needed by `realized.ts`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type CostBasisMethod = "fifo" | "average" | "specific"` (in `types/settings.ts`)
  - `interface OpenBuyLot { id: string; tradeDate: string; price: number; fxRate: number; fees: number; quantity: number; openQuantity: number }`
  - `interface SellLot { quantity: number; price: number; fxRate: number; fees: number }`
  - `interface ManualAllocation { buyLotId: string; quantity: number }`
  - `interface LotMatch { buyLotId: string; matchedQuantity: number; matchedBuyPrice: number; matchedBuyFx: number; assetGainSgd: number; fxGainSgd: number }`
  - `class InsufficientOpenQuantityError extends Error`
  - `class InvalidAllocationError extends Error`
  - `function matchSell(sellLot: SellLot, openBuyLots: OpenBuyLot[], method: CostBasisMethod, manualAllocations?: ManualAllocation[]): LotMatch[]`
  - These are consumed directly by Task 6 (`data.ts`/`reconcile-realized.ts`) and Task 8/9 (API routes).

- [ ] **Step 1: Add `CostBasisMethod` to the settings type**

Edit `src/types/settings.ts` — replace the whole file:
```ts
export type CostBasisMethod = "fifo" | "average" | "specific";

export interface UserSettings {
  displayName: string;
  baseCurrency: string;
  role: string;
  costBasisMethod: CostBasisMethod;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/realized.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  matchSell,
  InsufficientOpenQuantityError,
  InvalidAllocationError,
  type OpenBuyLot,
} from "./realized";

const b1: OpenBuyLot = {
  id: "b1",
  tradeDate: "2026-01-01",
  price: 100,
  fxRate: 1.3,
  fees: 10,
  quantity: 10,
  openQuantity: 10,
};
const b2: OpenBuyLot = {
  id: "b2",
  tradeDate: "2026-02-01",
  price: 110,
  fxRate: 1.32,
  fees: 0,
  quantity: 20,
  openQuantity: 20,
};
const sell = { quantity: 15, price: 130, fxRate: 1.35, fees: 5 };

describe("matchSell — fifo", () => {
  it("consumes the oldest lot first, then the next, with fee-aware gains", () => {
    const matches = matchSell(sell, [b1, b2], "fifo");
    expect(matches).toHaveLength(2);
    const m1 = matches.find((m) => m.buyLotId === "b1")!;
    const m2 = matches.find((m) => m.buyLotId === "b2")!;
    expect(m1.matchedQuantity).toBeCloseTo(10, 6);
    expect(m2.matchedQuantity).toBeCloseTo(5, 6);
    expect(m1.assetGainSgd).toBeCloseTo(387.5, 6);
    expect(m1.fxGainSgd).toBeCloseTo(50, 6);
    expect(m2.assetGainSgd).toBeCloseTo(132.75, 6);
    expect(m2.fxGainSgd).toBeCloseTo(16.5, 6);
  });

  it("total realized gain across matches equals proceeds minus cost basis", () => {
    const matches = matchSell(sell, [b1, b2], "fifo");
    const totalGain = matches.reduce((s, m) => s + m.assetGainSgd + m.fxGainSgd, 0);
    const proceeds = sell.quantity * sell.price * sell.fxRate - sell.fees * sell.fxRate;
    const costBasis = matches.reduce((s, m) => {
      const lot = [b1, b2].find((l) => l.id === m.buyLotId)!;
      const buyFeeAlloc = lot.fees * (m.matchedQuantity / lot.quantity);
      return s + m.matchedQuantity * m.matchedBuyPrice * m.matchedBuyFx + buyFeeAlloc * lot.fxRate;
    }, 0);
    expect(totalGain).toBeCloseTo(proceeds - costBasis, 6);
  });

  it("throws InsufficientOpenQuantityError when overselling", () => {
    expect(() => matchSell({ ...sell, quantity: 31 }, [b1, b2], "fifo")).toThrow(
      InsufficientOpenQuantityError,
    );
  });
});

describe("matchSell — average", () => {
  it("pro-rates quantity across all open lots by remaining open quantity", () => {
    const matches = matchSell(sell, [b1, b2], "average");
    expect(matches).toHaveLength(2);
    const m1 = matches.find((m) => m.buyLotId === "b1")!;
    const m2 = matches.find((m) => m.buyLotId === "b2")!;
    expect(m1.matchedQuantity).toBeCloseTo(5, 6);
    expect(m2.matchedQuantity).toBeCloseTo(10, 6);
    expect(m1.matchedQuantity + m2.matchedQuantity).toBeCloseTo(sell.quantity, 9);
  });
});

describe("matchSell — specific", () => {
  it("uses the caller's manual allocation verbatim", () => {
    const matches = matchSell(sell, [b1, b2], "specific", [
      { buyLotId: "b1", quantity: 7 },
      { buyLotId: "b2", quantity: 8 },
    ]);
    expect(matches.find((m) => m.buyLotId === "b1")!.matchedQuantity).toBeCloseTo(7, 6);
    expect(matches.find((m) => m.buyLotId === "b2")!.matchedQuantity).toBeCloseTo(8, 6);
  });

  it("throws InvalidAllocationError when allocations don't sum to the sell quantity", () => {
    expect(() =>
      matchSell(sell, [b1, b2], "specific", [
        { buyLotId: "b1", quantity: 7 },
        { buyLotId: "b2", quantity: 1 },
      ]),
    ).toThrow(InvalidAllocationError);
  });

  it("throws InvalidAllocationError when an allocation exceeds a lot's open quantity", () => {
    expect(() =>
      matchSell({ ...sell, quantity: 10 }, [b1, b2], "specific", [
        { buyLotId: "b1", quantity: 11 },
      ]),
    ).toThrow(InvalidAllocationError);
  });

  it("throws InvalidAllocationError when no allocations are supplied", () => {
    expect(() => matchSell(sell, [b1, b2], "specific")).toThrow(InvalidAllocationError);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/realized.test.ts`
Expected: FAIL — `Cannot find module './realized'` (the file doesn't exist yet).

- [ ] **Step 4: Implement the matching algorithm**

Create `src/lib/realized.ts`:
```ts
import type { CostBasisMethod } from "@/types/settings";

export interface OpenBuyLot {
  id: string;
  tradeDate: string;
  price: number;
  fxRate: number;
  fees: number;
  quantity: number;
  openQuantity: number;
}

export interface SellLot {
  quantity: number;
  price: number;
  fxRate: number;
  fees: number;
}

export interface ManualAllocation {
  buyLotId: string;
  quantity: number;
}

export interface LotMatch {
  buyLotId: string;
  matchedQuantity: number;
  matchedBuyPrice: number;
  matchedBuyFx: number;
  assetGainSgd: number;
  fxGainSgd: number;
}

export class InsufficientOpenQuantityError extends Error {}
export class InvalidAllocationError extends Error {}

const EPS = 1e-9;

/**
 * Match a sell against open buy lots under FIFO / average / specific-lot,
 * then compute each match's fee-aware asset/FX gain. Fees are valued in SGD
 * at their own transaction's FX rate and folded entirely into assetGainSgd —
 * a fee is a fixed historical outlay, not something with FX exposure to
 * decompose. Written once at sell-commit time; callers persist the result
 * verbatim (see reconcile-realized.ts / the API routes).
 */
export function matchSell(
  sellLot: SellLot,
  openBuyLots: OpenBuyLot[],
  method: CostBasisMethod,
  manualAllocations?: ManualAllocation[],
): LotMatch[] {
  const available = openBuyLots.filter((l) => l.openQuantity > EPS);
  let allocations: { lot: OpenBuyLot; qty: number }[];

  if (method === "specific") {
    if (!manualAllocations || manualAllocations.length === 0) {
      throw new InvalidAllocationError(
        "specific-lot method requires manualAllocations",
      );
    }
    const byId = new Map(available.map((l) => [l.id, l]));
    allocations = manualAllocations.map((a) => {
      const lot = byId.get(a.buyLotId);
      if (!lot) {
        throw new InvalidAllocationError(`buy lot ${a.buyLotId} is not open`);
      }
      if (a.quantity <= 0) {
        throw new InvalidAllocationError("allocation quantity must be positive");
      }
      if (a.quantity > lot.openQuantity + EPS) {
        throw new InvalidAllocationError(
          `allocation exceeds open quantity for lot ${a.buyLotId}`,
        );
      }
      return { lot, qty: a.quantity };
    });
    const allocatedTotal = allocations.reduce((s, a) => s + a.qty, 0);
    if (Math.abs(allocatedTotal - sellLot.quantity) > 1e-6) {
      throw new InvalidAllocationError(
        "allocations must sum to the sell quantity",
      );
    }
  } else {
    const totalOpen = available.reduce((s, l) => s + l.openQuantity, 0);
    if (totalOpen + EPS < sellLot.quantity) {
      throw new InsufficientOpenQuantityError(
        `only ${totalOpen} units open, cannot sell ${sellLot.quantity}`,
      );
    }
    if (method === "fifo") {
      const sorted = [...available].sort((a, b) =>
        a.tradeDate.localeCompare(b.tradeDate),
      );
      allocations = [];
      let remaining = sellLot.quantity;
      for (const lot of sorted) {
        if (remaining <= EPS) break;
        const take = Math.min(lot.openQuantity, remaining);
        allocations.push({ lot, qty: take });
        remaining -= take;
      }
    } else {
      allocations = available
        .map((lot) => ({
          lot,
          qty: (lot.openQuantity / totalOpen) * sellLot.quantity,
        }))
        .filter((a) => a.qty > EPS);
    }
    // Floating-point division in the "average" branch (and, rarely, the
    // running-remainder subtraction in "fifo") can leave a tiny residual —
    // absorb it into the last allocation so the total is exact.
    const allocatedTotal = allocations.reduce((s, a) => s + a.qty, 0);
    const diff = sellLot.quantity - allocatedTotal;
    if (Math.abs(diff) > EPS && allocations.length > 0) {
      allocations[allocations.length - 1].qty += diff;
    }
  }

  return allocations.map(({ lot, qty }) => {
    const buyFeeAlloc = lot.fees * (qty / lot.quantity);
    const sellFeeAlloc = sellLot.fees * (qty / sellLot.quantity);
    const assetGainSgd =
      qty * (sellLot.price - lot.price) * sellLot.fxRate -
      sellFeeAlloc * sellLot.fxRate -
      buyFeeAlloc * lot.fxRate;
    const fxGainSgd = qty * lot.price * (sellLot.fxRate - lot.fxRate);
    return {
      buyLotId: lot.id,
      matchedQuantity: qty,
      matchedBuyPrice: lot.price,
      matchedBuyFx: lot.fxRate,
      assetGainSgd,
      fxGainSgd,
    };
  });
}
```

- [ ] **Step 5: Run to verify success**

Run: `npx vitest run src/lib/realized.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors (note: other files still reference the old 3-field `UserSettings` shape without `costBasisMethod` — this is expected to break until Task 6/11 update them; if `tsc` reports missing-property errors on `UserSettings` object literals elsewhere, that's fine at this point in the plan and will be resolved by Task 6).

- [ ] **Step 7: Commit**

```bash
git add src/lib/realized.ts src/lib/realized.test.ts src/types/settings.ts
git commit -m "Add FIFO/average/specific-lot sell-matching algorithm"
```

---

### Task 4: Database migration

**Files:**
- Create: `supabase/migrations/20260721130000_realized_lots_and_cost_basis_method.sql`

**Interfaces:**
- Produces: `realized_lots` table, `user_settings.cost_basis_method` column — consumed by every data.ts function in Task 6.

⚠️ **This task cannot be verified by an agentic worker running commands in this repo** — there is no local Supabase CLI project (`supabase/config.toml` doesn't exist; migrations are applied directly to the hosted project). Applying this migration requires the Supabase dashboard SQL editor or `supabase db push` with project credentials, which must be done by a human operator with access. Write the file, review it carefully against the existing migrations' style (already matched below), and flag to the user that it needs manual application before Task 6 onward can be tested end-to-end against a real database — Tasks 1-3 and the type-only parts of later tasks don't need it.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260721130000_realized_lots_and_cost_basis_method.sql`:
```sql
-- T6: realized P&L + cost-basis engine.
-- Adds realized_lots (one row per matched buy<->sell pair, frozen at
-- sell-commit time — never a live join against the current lot values) and a
-- per-user cost-basis method default.

-- ── 1. realized_lots ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realized_lots (
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

ALTER TABLE realized_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own realized lots" ON realized_lots;
CREATE POLICY "Users can manage own realized lots" ON realized_lots
  FOR ALL
  USING ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Admins can read all realized lots" ON realized_lots;
CREATE POLICY "Admins can read all realized lots" ON realized_lots
  FOR SELECT
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS realized_lots_user_id_idx       ON realized_lots(user_id);
CREATE INDEX IF NOT EXISTS realized_lots_instrument_id_idx ON realized_lots(instrument_id);
CREATE INDEX IF NOT EXISTS realized_lots_sell_lot_id_idx   ON realized_lots(sell_lot_id);
CREATE INDEX IF NOT EXISTS realized_lots_buy_lot_id_idx    ON realized_lots(buy_lot_id);

-- ── 2. user_settings.cost_basis_method ────────────────────────────────────────
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS cost_basis_method text NOT NULL DEFAULT 'fifo';

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_cost_basis_method_check;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_cost_basis_method_check
  CHECK (cost_basis_method IN ('fifo', 'average', 'specific'));

-- Re-issue the column-privilege grants from 20260610025339_security_hardening.sql
-- with cost_basis_method appended — GRANT on a column list replaces the set,
-- it doesn't incrementally add, so the full list must be restated.
GRANT INSERT (user_id, display_name, base_currency, cost_basis_method, created_at, updated_at)
  ON public.user_settings TO authenticated;
GRANT UPDATE (user_id, display_name, base_currency, cost_basis_method, updated_at)
  ON public.user_settings TO authenticated;
```

- [ ] **Step 2: Review against existing conventions**

Confirm (read the file back): table uses `CREATE TABLE IF NOT EXISTS`, RLS policies are dropped before recreated, indexes use `IF NOT EXISTS`, the `user_settings` grants restate the *full* column list exactly as `20260610025339_security_hardening.sql` did (verify by reading that file's current `GRANT INSERT`/`GRANT UPDATE` lines and confirming `display_name, base_currency` match, with only `cost_basis_method` added).

- [ ] **Step 3: Flag for manual application**

Tell the user: "This migration needs to be applied to the Supabase project (dashboard SQL editor or `supabase db push`) before the sell path (Task 8) can be exercised against a real database. I can't do this myself — no local Supabase CLI project is configured in this repo."

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721130000_realized_lots_and_cost_basis_method.sql
git commit -m "Add realized_lots table and user_settings.cost_basis_method"
```

---

### Task 5: Types (`realized.ts`, `portfolio.ts` HeroStats split)

**Files:**
- Create: `src/types/realized.ts`
- Modify: `src/types/portfolio.ts`

**Interfaces:**
- Produces:
  - `interface RealizedLot { id, instrumentId, ticker, name, assetType, currency, flag, icon, sellLotId, buyLotId, method: CostBasisMethod, matchedQuantity, matchedBuyPrice, matchedBuyFx, sellPrice, sellFx, assetGainSgd, fxGainSgd, realizedDate }`
  - `interface ClosedPosition { ticker, name, assetType, currency, flag, icon, totalQuantitySold, realizedGainSgd, assetGainSgd, fxGainSgd, lastSaleDate }`
  - `HeroStats` gains `unrealizedGain`/`unrealizedGainPct`/`realizedGain`/`realizedGainPct`, loses `totalGain`/`totalGainPct` (renamed).
- Consumed by: Task 6 (`data.ts`), Task 7 (`portfolio.ts` compute functions), Task 10 (context/layout), Task 11-13 (UI).

- [ ] **Step 1: Create the realized-domain types**

Create `src/types/realized.ts`:
```ts
import type { CostBasisMethod } from "@/types/settings";

export interface RealizedLot {
  id: string;
  instrumentId: string;
  ticker: string;
  name: string;
  assetType: string;
  currency: string;
  flag: string;
  icon: string;
  sellLotId: string;
  buyLotId: string;
  method: CostBasisMethod;
  matchedQuantity: number;
  matchedBuyPrice: number;
  matchedBuyFx: number;
  sellPrice: number;
  sellFx: number;
  assetGainSgd: number;
  fxGainSgd: number;
  realizedDate: string;
}

export interface ClosedPosition {
  ticker: string;
  name: string;
  assetType: string;
  currency: string;
  flag: string;
  icon: string;
  totalQuantitySold: number;
  realizedGainSgd: number;
  assetGainSgd: number;
  fxGainSgd: number;
  lastSaleDate: string;
}
```

- [ ] **Step 2: Split `HeroStats` into unrealized/realized**

Edit `src/types/portfolio.ts` — replace the `HeroStats` interface (lines 1-13):
```ts
export interface HeroStats {
  total: number;
  dayChange: number;
  dayPct: number;
  unrealizedGain: number;
  unrealizedGainPct: number;
  realizedGain: number;
  realizedGainPct: number;
  fxImpact: number;
  fxPct: number;
  neutral: number;
  updated: string;
  portfolioYield: number;
  annualIncome: number;
}
```

- [ ] **Step 3: Type-check (expect known-broken call sites)**

Run: `npx tsc --noEmit`
Expected: errors in `src/lib/portfolio.ts` (still returns `totalGain`/`totalGainPct`), `src/app/(dashboard)/overview/page.tsx`, and `src/components/SummaryRail.tsx` (still read `hero.totalGain`/`totalGainPct`). This is expected — Task 7 and Task 10 fix these. Confirm no *other* unexpected errors appear (e.g. in files unrelated to this rename).

- [ ] **Step 4: Commit**

```bash
git add src/types/realized.ts src/types/portfolio.ts
git commit -m "Add RealizedLot/ClosedPosition types; split HeroStats gain into realized/unrealized"
```

---

### Task 6: Data layer (`data.ts` additions, `reconcile-realized.ts`)

**Files:**
- Modify: `src/lib/supabase/data.ts`
- Create: `src/lib/reconcile-realized.ts`

**Interfaces:**
- Consumes: `matchSell`, `LotMatch`, `OpenBuyLot`, `ManualAllocation` (Task 3); `RealizedLot` (Task 5); `CostBasisMethod` (Task 3).
- Produces:
  - `fetchOpenBuyLots(userId: string, instrumentId: string): Promise<OpenBuyLot[]>`
  - `insertRealizedLots(userId: string, instrumentId: string, sellLotId: string, method: CostBasisMethod, realizedDate: string, sellPrice: number, sellFx: number, matches: LotMatch[]): Promise<void>`
  - `fetchRealizedLots(userId: string): Promise<RealizedLot[]>`
  - `interface UnmatchedSellLot { id, instrumentId, ticker, quantity, price, fxRate, fees, tradeDate }`
  - `fetchUnmatchedSellLots(userId: string): Promise<UnmatchedSellLot[]>`
  - `fetchLotById(id: string, userId: string): Promise<{ id, instrumentId, transactionType: "buy"|"sell", quantity, tradeDate } | null>`
  - `fetchMatchedQuantityForBuyLot(buyLotId: string, userId: string): Promise<number>`
  - `fetchMatchedQuantityForSellLot(sellLotId: string, userId: string): Promise<number>`
  - `resolveInstrumentIdForTicker(userId: string, ticker: string): Promise<string | null>`
  - `fetchUserSettings`/`upsertUserSettings` updated to read/write `cost_basis_method`.
  - `reconcileRealizedLots(userId: string, method: CostBasisMethod): Promise<{ reconciled: number; warnings: string[] }>` (new file)
- Consumed by: Task 8/9 (API routes), Task 10 (layout.tsx).

- [ ] **Step 1: Update imports in `data.ts`**

Edit `src/lib/supabase/data.ts` — replace the top import block (lines 1-11):
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { HoldingRow } from "@/types/holding";
import type { UserSettings, CostBasisMethod } from "@/types/settings";
import type { RealizedLot } from "@/types/realized";
import type { LotMatch, OpenBuyLot } from "@/lib/realized";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeCurrentValueSGD,
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "@/lib/fx";
```

- [ ] **Step 2: Update `fetchUserSettings`/`upsertUserSettings` for `cost_basis_method`**

Edit `src/lib/supabase/data.ts` — replace `fetchUserSettings`:
```ts
export async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("user_settings")
    .select("display_name, base_currency, role, cost_basis_method")
    .eq("user_id", userId)
    .single();
  return {
    displayName: data?.display_name ?? "",
    baseCurrency: data?.base_currency ?? "SGD",
    role: data?.role ?? "user",
    costBasisMethod: (data?.cost_basis_method as CostBasisMethod) ?? "fifo",
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
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}
```

- [ ] **Step 3: Add the realized-lots data functions**

Edit `src/lib/supabase/data.ts` — append at the end of the file:
```ts

// ── Realized lots (T6) ────────────────────────────────────────────────────────

interface DbRealizedLot {
  id: string;
  instrument_id: string;
  sell_lot_id: string;
  buy_lot_id: string;
  method: CostBasisMethod;
  matched_quantity: number;
  matched_buy_price: number;
  matched_buy_fx: number;
  sell_price: number;
  sell_fx: number;
  asset_gain_sgd: number;
  fx_gain_sgd: number;
  realized_date: string;
  instruments?: DbInstrument | null;
}

function toRealizedLot(row: DbRealizedLot, inst: DbInstrument): RealizedLot {
  return {
    id: row.id,
    instrumentId: row.instrument_id,
    ticker: inst.symbol,
    name: inst.name,
    assetType: inst.asset_type,
    currency: inst.currency,
    flag: inst.flag,
    icon: inst.icon,
    sellLotId: row.sell_lot_id,
    buyLotId: row.buy_lot_id,
    method: row.method,
    matchedQuantity: Number(row.matched_quantity),
    matchedBuyPrice: Number(row.matched_buy_price),
    matchedBuyFx: Number(row.matched_buy_fx),
    sellPrice: Number(row.sell_price),
    sellFx: Number(row.sell_fx),
    assetGainSgd: Number(row.asset_gain_sgd),
    fxGainSgd: Number(row.fx_gain_sgd),
    realizedDate: row.realized_date,
  };
}

// Buy lots still open for an instrument, netted against every existing
// realized_lots match. Fresh on every call — never cached, since sells must
// always match against the true current remainder.
export async function fetchOpenBuyLots(
  userId: string,
  instrumentId: string,
): Promise<OpenBuyLot[]> {
  const supabase = await makeServerClient();
  const [{ data: buyLots }, { data: matches }] = await Promise.all([
    supabase
      .from("lots")
      .select("id, quantity, price, fx_rate, fees, trade_date")
      .eq("user_id", userId)
      .eq("instrument_id", instrumentId)
      .eq("transaction_type", "buy"),
    supabase
      .from("realized_lots")
      .select("buy_lot_id, matched_quantity")
      .eq("user_id", userId)
      .eq("instrument_id", instrumentId),
  ]);

  const matchedByLot = new Map<string, number>();
  for (const m of matches ?? []) {
    const key = m.buy_lot_id as string;
    matchedByLot.set(key, (matchedByLot.get(key) ?? 0) + Number(m.matched_quantity));
  }

  return (buyLots ?? [])
    .map((l) => {
      const quantity = Number(l.quantity);
      const matched = matchedByLot.get(l.id as string) ?? 0;
      return {
        id: l.id as string,
        tradeDate: l.trade_date as string,
        price: Number(l.price),
        fxRate: Number(l.fx_rate),
        fees: Number(l.fees),
        quantity,
        openQuantity: quantity - matched,
      };
    })
    .filter((l) => l.openQuantity > 1e-9);
}

export async function insertRealizedLots(
  userId: string,
  instrumentId: string,
  sellLotId: string,
  method: CostBasisMethod,
  realizedDate: string,
  sellPrice: number,
  sellFx: number,
  matches: LotMatch[],
): Promise<void> {
  if (matches.length === 0) return;
  const supabase = await makeServerClient();
  const { error } = await supabase.from("realized_lots").insert(
    matches.map((m) => ({
      user_id: userId,
      instrument_id: instrumentId,
      sell_lot_id: sellLotId,
      buy_lot_id: m.buyLotId,
      method,
      matched_quantity: m.matchedQuantity,
      matched_buy_price: m.matchedBuyPrice,
      matched_buy_fx: m.matchedBuyFx,
      sell_price: sellPrice,
      sell_fx: sellFx,
      asset_gain_sgd: m.assetGainSgd,
      fx_gain_sgd: m.fxGainSgd,
      realized_date: realizedDate,
    })),
  );
  if (error) console.error("[insertRealizedLots]", error.message);
}

export async function fetchRealizedLots(userId: string): Promise<RealizedLot[]> {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("realized_lots")
    .select("*, instruments(*)")
    .eq("user_id", userId)
    .order("realized_date", { ascending: true });
  if (error) {
    console.error("[fetchRealizedLots]", error.message);
    return [];
  }
  return (data as DbRealizedLot[])
    .filter((r) => r.instruments)
    .map((r) => toRealizedLot(r, r.instruments!));
}

export interface UnmatchedSellLot {
  id: string;
  instrumentId: string;
  ticker: string;
  quantity: number;
  price: number;
  fxRate: number;
  fees: number;
  tradeDate: string;
}

// Sell lots with zero realized_lots rows yet, oldest first — reconcileRealizedLots
// (reconcile-realized.ts) processes these sequentially so each sell's matches are
// committed before the next sell's open-quantity is computed.
export async function fetchUnmatchedSellLots(
  userId: string,
): Promise<UnmatchedSellLot[]> {
  const supabase = await makeServerClient();
  const [{ data: sells }, { data: matched }] = await Promise.all([
    supabase
      .from("lots")
      .select("id, instrument_id, quantity, price, fx_rate, fees, trade_date, instruments(symbol)")
      .eq("user_id", userId)
      .eq("transaction_type", "sell")
      .order("trade_date", { ascending: true }),
    supabase.from("realized_lots").select("sell_lot_id").eq("user_id", userId),
  ]);
  const matchedIds = new Set((matched ?? []).map((m) => m.sell_lot_id as string));
  return (sells ?? [])
    .filter((s) => !matchedIds.has(s.id as string))
    .map((s) => ({
      id: s.id as string,
      instrumentId: s.instrument_id as string,
      ticker: (s.instruments as { symbol: string } | null)?.symbol ?? "",
      quantity: Number(s.quantity),
      price: Number(s.price),
      fxRate: Number(s.fx_rate),
      fees: Number(s.fees),
      tradeDate: s.trade_date as string,
    }));
}

export async function fetchLotById(
  id: string,
  userId: string,
): Promise<{
  id: string;
  instrumentId: string;
  transactionType: "buy" | "sell";
  quantity: number;
  tradeDate: string;
} | null> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("lots")
    .select("id, instrument_id, transaction_type, quantity, trade_date")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    instrumentId: data.instrument_id as string,
    transactionType: data.transaction_type as "buy" | "sell",
    quantity: Number(data.quantity),
    tradeDate: data.trade_date as string,
  };
}

export async function fetchMatchedQuantityForBuyLot(
  buyLotId: string,
  userId: string,
): Promise<number> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("realized_lots")
    .select("matched_quantity")
    .eq("buy_lot_id", buyLotId)
    .eq("user_id", userId);
  return (data ?? []).reduce((s, r) => s + Number(r.matched_quantity), 0);
}

export async function fetchMatchedQuantityForSellLot(
  sellLotId: string,
  userId: string,
): Promise<number> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("realized_lots")
    .select("matched_quantity")
    .eq("sell_lot_id", sellLotId)
    .eq("user_id", userId);
  return (data ?? []).reduce((s, r) => s + Number(r.matched_quantity), 0);
}

// Resolves a ticker to its instrument id via the user's own lots — tickers are
// the grouping key everywhere else in the app (bucketByPosition), so this
// follows the same convention rather than requiring the client to know
// instrument ids at all.
export async function resolveInstrumentIdForTicker(
  userId: string,
  ticker: string,
): Promise<string | null> {
  const supabase = await makeServerClient();
  const { data } = await supabase
    .from("lots")
    .select("instrument_id, instruments!inner(symbol)")
    .eq("user_id", userId)
    .eq("instruments.symbol", ticker)
    .limit(1)
    .maybeSingle();
  return (data?.instrument_id as string) ?? null;
}
```

- [ ] **Step 4: Create the reconciliation orchestrator**

Create `src/lib/reconcile-realized.ts`:
```ts
import {
  fetchUnmatchedSellLots,
  fetchOpenBuyLots,
  insertRealizedLots,
} from "@/lib/supabase/data";
import { matchSell, type SellLot } from "@/lib/realized";
import type { CostBasisMethod } from "@/types/settings";

/**
 * Backfills realized_lots for sells that predate this feature (or were left
 * unmatched by an earlier partial run). Idempotent — a sell already carrying
 * realized_lots rows is skipped, so calling this on every dashboard load is
 * cheap after the first real run. Processes sells sequentially and in
 * trade_date order per instrument's cross-cutting timeline so each sell's
 * freshly-inserted matches are accounted for before the next sell's open
 * quantity is computed.
 */
export async function reconcileRealizedLots(
  userId: string,
  method: CostBasisMethod,
): Promise<{ reconciled: number; warnings: string[] }> {
  const unmatchedSells = await fetchUnmatchedSellLots(userId);
  let reconciled = 0;
  const warnings: string[] = [];

  for (const sell of unmatchedSells) {
    const openBuyLots = await fetchOpenBuyLots(userId, sell.instrumentId);
    const totalOpen = openBuyLots.reduce((s, l) => s + l.openQuantity, 0);

    let sellLot: SellLot = {
      quantity: sell.quantity,
      price: sell.price,
      fxRate: sell.fxRate,
      fees: sell.fees,
    };

    if (totalOpen + 1e-9 < sell.quantity) {
      warnings.push(
        `${sell.ticker || sell.instrumentId}: sell of ${sell.quantity} on ${sell.tradeDate} exceeds open buy quantity (${totalOpen}); matched ${totalOpen} and left the rest unmatched`,
      );
      if (totalOpen <= 1e-9) continue;
      sellLot = { ...sellLot, quantity: totalOpen };
    }

    const matches = matchSell(sellLot, openBuyLots, method);
    if (matches.length > 0) {
      await insertRealizedLots(
        userId,
        sell.instrumentId,
        sell.id,
        method,
        sell.tradeDate,
        sell.price,
        sell.fxRate,
        matches,
      );
      reconciled++;
    }
  }

  return { reconciled, warnings };
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `data.ts`/`reconcile-realized.ts` themselves. The pre-existing `HeroStats`/`portfolio.ts` mismatch from Task 5 still shows — unaffected by this task, resolved in Task 7/10.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/data.ts src/lib/reconcile-realized.ts
git commit -m "Add realized-lots data access and reconciliation backfill"
```

---

### Task 7: `portfolio.ts` — `computeRealizedSummary` + `computeHeroStats` split

**Files:**
- Modify: `src/lib/portfolio.ts`

**Interfaces:**
- Consumes: `RealizedLot`, `ClosedPosition` (Task 5); `toNetPositions` (unchanged, Task 2).
- Produces:
  - `computeHeroStats(holdings: HoldingRow[], snapshots?: SnapshotRow[], realizedLots?: RealizedLot[]): HeroStats` (now 3-arg, `realizedLots` defaults to `[]`)
  - `computeRealizedSummary(holdings: HoldingRow[], realizedLots: RealizedLot[]): ClosedPosition[]`
- Consumed by: Task 10 (`layout.tsx`).

- [ ] **Step 1: Update imports**

Edit `src/lib/portfolio.ts` — replace the top import block (lines 1-19):
```ts
import type { HoldingRow } from "@/types/holding";
import type { SnapshotRow } from "@/lib/supabase/data";
import type {
  HeroStats,
  MoverItem,
  CurrencyCard,
  WaterfallItem,
  AllocationSlice,
  AllocationBySource,
  PortfolioSeriesPoint,
  FxSeriesPoint,
  PortfolioAnalytics,
} from "@/types/portfolio";
import type { RealizedLot, ClosedPosition } from "@/types/realized";
import {
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "./fx";
import { toNetPositions } from "./group-holdings";
```

- [ ] **Step 2: Replace `computeHeroStats`**

Edit `src/lib/portfolio.ts` — replace the `computeHeroStats` function:
```ts
export function computeHeroStats(
  holdings: HoldingRow[],
  snapshots: SnapshotRow[] = [],
  realizedLots: RealizedLot[] = [],
): HeroStats {
  // Net out sells so totals reflect what's actually held, not gross lots.
  const positions = toNetPositions(holdings);
  const total = positions.reduce((s, h) => s + h.valueSGD, 0);
  const cost = positions.reduce((s, h) => s + h.costSGD, 0);
  const unrealizedGain = total - cost;
  const unrealizedGainPct = cost > 0 ? (unrealizedGain / cost) * 100 : 0;
  const fxImpact = positions.reduce((s, h) => s + h.fxGain, 0);
  const fxPct = cost > 0 ? (fxImpact / cost) * 100 : 0;
  const neutral = total - fxImpact;

  const realizedGain = realizedLots.reduce(
    (s, r) => s + r.assetGainSgd + r.fxGainSgd,
    0,
  );
  const realizedCostBasis = realizedLots.reduce(
    (s, r) => s + r.matchedQuantity * r.matchedBuyPrice * r.matchedBuyFx,
    0,
  );
  const realizedGainPct =
    realizedCostBasis > 0 ? (realizedGain / realizedCostBasis) * 100 : 0;

  // Day change from the most recent two distinct-date snapshots
  const today = new Date().toISOString().slice(0, 10);
  const prevSnap = [...snapshots].reverse().find((s) => s.recordedDate < today);
  const dayChange = prevSnap ? total - prevSnap.valueSgd : 0;
  const dayPct = prevSnap && prevSnap.valueSgd > 0 ? (dayChange / prevSnap.valueSgd) * 100 : 0;

  // Portfolio yield and annual income (weighted by SGD value)
  let yieldedValue = 0;
  let annualIncome = 0;
  for (const h of positions) {
    const y = h.dividendYield ?? h.dividendYieldAuto;
    if (y != null) {
      yieldedValue += h.valueSGD;
      annualIncome += (y / 100) * h.valueSGD;
    }
  }
  const portfolioYield = yieldedValue > 0 ? (annualIncome / yieldedValue) * 100 : 0;

  return {
    total,
    dayChange,
    dayPct,
    unrealizedGain,
    unrealizedGainPct,
    realizedGain,
    realizedGainPct,
    fxImpact,
    fxPct,
    neutral,
    updated: new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" }) + " SGT",
    portfolioYield,
    annualIncome,
  };
}

// Per-ticker lifetime realized totals, restricted to tickers with zero net
// open units left (still-open tickers with a partial sell are excluded here —
// their realized gain is already folded into hero.realizedGain, but they
// belong on the Holdings "Open" view, not "Closed").
export function computeRealizedSummary(
  holdings: HoldingRow[],
  realizedLots: RealizedLot[],
): ClosedPosition[] {
  const openTickers = new Set(toNetPositions(holdings).map((h) => h.ticker));

  const byTicker = new Map<string, ClosedPosition>();
  for (const r of realizedLots) {
    const gain = r.assetGainSgd + r.fxGainSgd;
    const existing = byTicker.get(r.ticker);
    if (existing) {
      existing.totalQuantitySold += r.matchedQuantity;
      existing.realizedGainSgd += gain;
      existing.assetGainSgd += r.assetGainSgd;
      existing.fxGainSgd += r.fxGainSgd;
      if (r.realizedDate > existing.lastSaleDate) existing.lastSaleDate = r.realizedDate;
    } else {
      byTicker.set(r.ticker, {
        ticker: r.ticker,
        name: r.name,
        assetType: r.assetType,
        currency: r.currency,
        flag: r.flag,
        icon: r.icon,
        totalQuantitySold: r.matchedQuantity,
        realizedGainSgd: gain,
        assetGainSgd: r.assetGainSgd,
        fxGainSgd: r.fxGainSgd,
        lastSaleDate: r.realizedDate,
      });
    }
  }

  return Array.from(byTicker.values())
    .filter((p) => !openTickers.has(p.ticker))
    .sort((a, b) => b.lastSaleDate.localeCompare(a.lastSaleDate));
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: the `HeroStats` errors from Task 5 in `portfolio.ts` are now gone; `overview/page.tsx` and `SummaryRail.tsx` still show `totalGain`/`totalGainPct` errors (fixed in Task 10).

- [ ] **Step 4: Commit**

```bash
git add src/lib/portfolio.ts
git commit -m "Add computeRealizedSummary; split computeHeroStats into realized/unrealized"
```

---

### Task 8: API — sell path matches against open buy lots

**Files:**
- Modify: `src/app/api/holdings/route.ts`

**Interfaces:**
- Consumes: `fetchUserSettings`, `fetchOpenBuyLots`, `insertRealizedLots` (Task 6); `matchSell`, `ManualAllocation` (Task 3); `CostBasisMethod` (Task 3).
- Produces: `POST /api/holdings` now accepts optional `cost_basis_method` and `lot_allocations` in the body when `transaction_type === "sell"`.

- [ ] **Step 1: Update imports**

Edit `src/app/api/holdings/route.ts` — replace the import block (lines 1-16):
```ts
import { NextRequest, NextResponse } from "next/server";
import {
  fetchHoldings,
  upsertInstrument,
  insertLot,
  deleteLot,
  deleteAllLotsForUser,
  updateLot,
  updateInstrumentForLot,
  upsertHoldingOverride,
  upsertHoldingOverrideForLot,
  seedTickerQuote,
  fetchUserSettings,
  fetchOpenBuyLots,
  insertRealizedLots,
  fetchLotById,
  fetchMatchedQuantityForBuyLot,
  fetchMatchedQuantityForSellLot,
} from "@/lib/supabase/data";
import { requireAuth } from "@/lib/supabase/guards";
import { CCY_FLAG, SUPPORTED_CURRENCIES } from "@/lib/formatters";
import { ASSET_TYPES } from "@/types/holding";
import { matchSell, type ManualAllocation } from "@/lib/realized";
import type { CostBasisMethod } from "@/types/settings";
```

- [ ] **Step 2: Resolve method and match BEFORE writing the sell lot**

Edit `src/app/api/holdings/route.ts` — in the `POST` handler, insert this block immediately after the `if (!instrumentId) return NextResponse.json({ error: "Insert failed" }, { status: 500 });` check (i.e. right before the existing `// 2. Seed a quote...` comment):
```ts

  // 3. If this is a sell, resolve the cost-basis method and match it against
  //    open buy lots BEFORE writing anything — an invalid/oversold match
  //    should reject the whole request, not leave an unmatched sell lot behind.
  let sellMatches: ReturnType<typeof matchSell> | undefined;
  let sellMethod: CostBasisMethod | undefined;
  if (transaction_type === "sell") {
    const { lot_allocations, cost_basis_method } = body;
    if (
      cost_basis_method !== undefined &&
      !["fifo", "average", "specific"].includes(String(cost_basis_method))
    ) {
      return NextResponse.json({ error: "invalid cost_basis_method" }, { status: 400 });
    }
    sellMethod =
      (cost_basis_method as CostBasisMethod | undefined) ??
      (await fetchUserSettings(user.id)).costBasisMethod;

    let manualAllocations: ManualAllocation[] | undefined;
    if (sellMethod === "specific") {
      if (!Array.isArray(lot_allocations) || lot_allocations.length === 0) {
        return NextResponse.json(
          { error: "specific cost-basis method requires lot_allocations" },
          { status: 400 },
        );
      }
      manualAllocations = lot_allocations.map(
        (a: { buyLotId: string; qty: number }) => ({
          buyLotId: String(a.buyLotId),
          quantity: Number(a.qty),
        }),
      );
    }

    const openBuyLots = await fetchOpenBuyLots(user.id, instrumentId);
    try {
      sellMatches = matchSell(
        {
          quantity: Number(units),
          price: Number(buy_price),
          fxRate: Number(buy_fx_rate ?? 1),
          fees: fees != null ? Number(fees) : 0,
        },
        openBuyLots,
        sellMethod,
        manualAllocations,
      );
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "Could not match sell against open lots",
        },
        { status: 400 },
      );
    }
  }
```

- [ ] **Step 3: Insert the realized_lots rows once the sell lot exists**

Edit `src/app/api/holdings/route.ts` — in the `POST` handler, immediately after the existing:
```ts
  if (!row) {
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
```
insert:
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

- [ ] **Step 4: Manual verification (no test runner coverage for route handlers — Next.js route handlers need a running server; verify via the dev server and a manual request)**

Run: `npm run dev`
In a second terminal, with a real logged-in session cookie (or via the browser's dev tools Network tab while using the app), exercise:
1. Add a buy lot for a test ticker (units 10, price 100, fx 1.3).
2. Sell 4 units via the existing UI sell form (still using the old request shape — no `cost_basis_method`/`lot_allocations` yet, since Task 12 adds that UI). Confirm the response is `201` and the app doesn't error (Task 12 lands the UI that actually surfaces this; for now confirm the default FIFO path silently works via the user's stored `cost_basis_method` default, which defaults to `'fifo'` — no DB row read failure).
3. Attempt to sell more units than held (e.g. sell 999) and confirm a `400` with a clear message instead of a silent overcommit.

Expected: sells succeed and match; overselling is rejected with 400. (Full UI verification with method override happens in Task 12's browser check.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors in `route.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/holdings/route.ts
git commit -m "Match sells against open buy lots and record realized_lots on sell-commit"
```

---

### Task 9: API — guard matched lots against invalidating edits/deletes

**Files:**
- Modify: `src/app/api/holdings/route.ts`

**Interfaces:**
- Consumes: `fetchLotById`, `fetchMatchedQuantityForBuyLot`, `fetchMatchedQuantityForSellLot` (Task 6, already imported in Task 8).

- [ ] **Step 1: Guard the PATCH handler**

Edit `src/app/api/holdings/route.ts` — in the `PATCH` handler, immediately after:
```ts
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
```
insert:
```ts

  const existingLot = await fetchLotById(id, user.id);
  if (!existingLot) return NextResponse.json({ error: "Not found" }, { status: 404 });
```

Then, immediately after the existing numeric-guards block ends (right after `if (lotPatch.quantity !== undefined && Number(lotPatch.quantity) <= 0) return NextResponse.json({ error: "invalid units" }, { status: 400 });`), insert:
```ts

  // A buy lot that's already been matched by a realized sale can't have its
  // quantity reduced below the matched amount — realized_lots stores a frozen
  // price/fx snapshot, not a live join, but the remaining OPEN quantity must
  // still make physical sense.
  if (existingLot.transactionType === "buy" && lotPatch.quantity !== undefined) {
    const matched = await fetchMatchedQuantityForBuyLot(id, user.id);
    if (matched > 0 && Number(lotPatch.quantity) < matched) {
      return NextResponse.json(
        {
          error: `This lot has ${matched} unit(s) already matched to realized sales and can't be reduced below that.`,
        },
        { status: 409 },
      );
    }
  }

  // A sell lot that's already been matched can't have its financial terms
  // edited — the realized record is frozen at sell-commit time and editing
  // the sale afterward would make it inconsistent with what was recorded.
  // Delete and re-enter the sale instead (delete cascades realized_lots).
  if (existingLot.transactionType === "sell") {
    const affectsMatch = ["quantity", "price", "trade_date", "fx_rate", "fees"].some(
      (k) => lotPatch[k] !== undefined,
    );
    if (affectsMatch) {
      const matched = await fetchMatchedQuantityForSellLot(id, user.id);
      if (matched > 0) {
        return NextResponse.json(
          {
            error:
              "This sale has already been matched to realized P&L. Delete it and record a new sale instead of editing the amount, price, date, FX rate, or fees.",
          },
          { status: 409 },
        );
      }
    }
  }
```

- [ ] **Step 2: Guard the DELETE handler**

Edit `src/app/api/holdings/route.ts` — in the `DELETE` handler, replace:
```ts
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await deleteLot(id, user.id);
  return NextResponse.json({ ok: true });
```
with:
```ts
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existingLot = await fetchLotById(id, user.id);
  if (existingLot?.transactionType === "buy") {
    const matched = await fetchMatchedQuantityForBuyLot(id, user.id);
    if (matched > 0) {
      return NextResponse.json(
        {
          error: "This lot has units matched to realized sales and can't be deleted.",
        },
        { status: 409 },
      );
    }
  }

  await deleteLot(id, user.id);
  return NextResponse.json({ ok: true });
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`
1. Buy 10 units, sell 4 (creates a realized match on the 10-unit buy lot). Attempt to edit the buy lot's units down to 3 via the Holdings edit form — expect a 409 with the "already matched" message surfaced as a toast.
2. Attempt to delete that same buy lot — expect a 409, not a silent delete.
3. Attempt to edit the sell lot's units/price/date — expect a 409 ("already matched to realized P&L").
4. Delete the sell lot instead — expect success, and confirm (via a follow-up read, e.g. re-opening the Holdings > Closed tab once Task 13 lands, or a direct Supabase table check) that its `realized_lots` rows are gone too (cascade).

Expected: all four behave as described.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/holdings/route.ts
git commit -m "Guard matched buy/sell lots against invalidating edits and deletes"
```

---

### Task 10: Wire realized data through the dashboard layout/context; rename hero fields

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/components/DashboardShell.tsx`
- Modify: `src/context/portfolio.tsx`
- Modify: `src/app/(dashboard)/overview/page.tsx`
- Modify: `src/components/SummaryRail.tsx`

**Interfaces:**
- Consumes: `fetchRealizedLots` (Task 6), `reconcileRealizedLots` (Task 6), `computeRealizedSummary` (Task 7), `ClosedPosition` (Task 5), `CostBasisMethod` (Task 3).
- Produces: `usePortfolio()` gains `closedPositions: ClosedPosition[]`, `costBasisMethod: CostBasisMethod`, `setCostBasisMethod: (v: CostBasisMethod) => void`. `hero.totalGain`/`totalGainPct` → `hero.unrealizedGain`/`unrealizedGainPct` everywhere; new `hero.realizedGain`/`realizedGainPct` surfaced on Overview.
- Consumed by: Task 11 (Settings), Task 12 (sell form), Task 13 (Holdings Closed tab).

- [ ] **Step 1: Update the dashboard layout**

Edit `src/app/(dashboard)/layout.tsx` — replace the whole file:
```tsx
export const dynamic = "force-dynamic";

import {
  fetchHoldings,
  fetchUserSettings,
  fetchSnapshots,
  fetchRealizedLots,
} from "@/lib/supabase/data";
import { reconcileRealizedLots } from "@/lib/reconcile-realized";
import {
  computeHeroStats,
  computeAllocationByAsset,
  computeAllocationByGeo,
  computeMovers,
  computeCurrencyCards,
  computeWaterfall,
  computeRealizedSummary,
  generatePortfolioSeries,
  generatePortfolioSeriesDaily,
  generateFxSeries,
  buildFxColors,
  buildBaseFxRates,
} from "@/lib/portfolio";
import { DashboardShell } from "@/components/DashboardShell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [holdings, userSettings, snapshots] = await Promise.all([
    user ? fetchHoldings(user.id) : Promise.resolve([]),
    user
      ? fetchUserSettings(user.id)
      : Promise.resolve({
          displayName: "",
          baseCurrency: "SGD",
          role: "user",
          costBasisMethod: "fifo" as const,
        }),
    user ? fetchSnapshots(user.id) : Promise.resolve([]),
  ]);

  if (user) {
    const { warnings } = await reconcileRealizedLots(
      user.id,
      userSettings.costBasisMethod,
    );
    for (const w of warnings) console.warn("[reconcileRealizedLots]", w);
  }
  const realizedLots = user ? await fetchRealizedLots(user.id) : [];

  const hero = computeHeroStats(holdings, snapshots, realizedLots);
  const closedPositions = computeRealizedSummary(holdings, realizedLots);
  const assetAllocation = computeAllocationByAsset(holdings);
  const geoAllocation = computeAllocationByGeo(holdings);
  const movers = computeMovers(holdings);
  const currencyCards = computeCurrencyCards(holdings);
  const waterfallData = computeWaterfall(currencyCards);
  const portfolioSeries = generatePortfolioSeries(snapshots, holdings);
  const portfolioSeriesDaily = generatePortfolioSeriesDaily(
    snapshots,
    holdings,
  );
  const { series: fxSeries, fxLabels } = generateFxSeries(
    snapshots,
    currencyCards,
    holdings,
  );
  const fxColors = buildFxColors(currencyCards);
  const baseFxRates = buildBaseFxRates(currencyCards);

  return (
    <DashboardShell
      holdings={holdings}
      hero={hero}
      closedPositions={closedPositions}
      assetAllocation={assetAllocation}
      geoAllocation={geoAllocation}
      movers={movers}
      currencyCards={currencyCards}
      waterfallData={waterfallData}
      portfolioSeries={portfolioSeries}
      portfolioSeriesDaily={portfolioSeriesDaily}
      fxSeries={fxSeries}
      fxLabels={fxLabels}
      fxColors={fxColors}
      baseFxRates={baseFxRates}
      initialDisplayName={userSettings.displayName}
      initialBaseCurrency={userSettings.baseCurrency}
      initialRole={userSettings.role}
      initialCostBasisMethod={userSettings.costBasisMethod}
    >
      {children}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Thread the new props through `DashboardShell`**

Edit `src/components/DashboardShell.tsx` — replace the whole file:
```tsx
"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { NerveBar } from "@/components/NerveBar";
import { TabBar } from "@/components/TabBar";
import { SummaryRail } from "@/components/SummaryRail";
import { TweaksPanel } from "@/components/TweaksPanel";
import { PortfolioProvider } from "@/context/portfolio";
import type { HoldingRow } from "@/types/holding";
import type { ClosedPosition } from "@/types/realized";
import type { CostBasisMethod } from "@/types/settings";
import type {
  HeroStats,
  AllocationSlice,
  MoverItem,
  CurrencyCard,
  WaterfallItem,
  PortfolioSeriesPoint,
  FxSeriesPoint,
} from "@/types/portfolio";

interface DashboardShellProps {
  holdings: HoldingRow[];
  hero: HeroStats;
  closedPositions: ClosedPosition[];
  assetAllocation: AllocationSlice[];
  geoAllocation: AllocationSlice[];
  movers: { gainers: MoverItem[]; losers: MoverItem[] };
  currencyCards: CurrencyCard[];
  waterfallData: WaterfallItem[];
  portfolioSeries: PortfolioSeriesPoint[];
  portfolioSeriesDaily: PortfolioSeriesPoint[];
  fxSeries: FxSeriesPoint[];
  fxLabels: string[];
  fxColors: Record<string, string>;
  baseFxRates: Record<string, number>;
  initialDisplayName: string;
  initialBaseCurrency: string;
  initialRole: string;
  initialCostBasisMethod: CostBasisMethod;
  children: React.ReactNode;
}

export function DashboardShell({
  holdings,
  hero,
  closedPositions,
  assetAllocation,
  geoAllocation,
  movers,
  currencyCards,
  waterfallData,
  portfolioSeries,
  portfolioSeriesDaily,
  fxSeries,
  fxLabels,
  fxColors,
  baseFxRates,
  initialDisplayName,
  initialBaseCurrency,
  initialRole,
  initialCostBasisMethod,
  children,
}: DashboardShellProps) {
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const showSidebar = !["/overview", "/settings", "/admin"].includes(pathname);

  return (
    <PortfolioProvider
      value={{
        holdings,
        hero,
        closedPositions,
        assetAllocation,
        geoAllocation,
        movers,
        currencyCards,
        waterfallData,
        portfolioSeries,
        portfolioSeriesDaily,
        fxSeries,
        fxLabels,
        fxColors,
        baseFxRates,
        initialDisplayName,
        initialBaseCurrency,
        initialRole,
        initialCostBasisMethod,
      }}
    >
      <div className="flex min-h-screen flex-col">
        <NerveBar
          hero={hero}
          animate
          onTweaksToggle={() => setTweaksOpen((o) => !o)}
          onHamburger={() => setMobileNavOpen(true)}
        />
        <TabBar
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          onTweaksToggle={() => setTweaksOpen((o) => !o)}
        />
        <div className="flex min-w-0 flex-1 items-start">
          {showSidebar && <SummaryRail />}
          <main
            className={
              "min-w-0 flex-1 px-[30px] pb-20 pt-[26px] " +
              "max-bp900:px-[22px] max-bp900:pb-[60px] max-bp900:pt-5 " +
              "max-bp768:px-4 max-bp768:pt-4 max-bp600:px-3 max-bp600:pt-3 max-bp380:px-2 max-bp380:pt-2 " +
              (showSidebar ? "" : "[&>*]:mx-auto [&>*]:max-w-[1600px]")
            }
            key={pathname}
          >
            {children}
          </main>
        </div>
        <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} />
      </div>
    </PortfolioProvider>
  );
}
```

- [ ] **Step 3: Update the portfolio context**

Edit `src/context/portfolio.tsx` — replace the whole file:
```tsx
"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { HoldingRow } from "@/types/holding";
import type { ClosedPosition } from "@/types/realized";
import type { CostBasisMethod } from "@/types/settings";
import type {
  HeroStats,
  AllocationSlice,
  MoverItem,
  CurrencyCard,
  WaterfallItem,
  PortfolioSeriesPoint,
  FxSeriesPoint,
} from "@/types/portfolio";
import { ccyFmt, ccySigned } from "@/lib/formatters";

interface PortfolioContextValue {
  holdings: HoldingRow[];
  hero: HeroStats;
  closedPositions: ClosedPosition[];
  assetAllocation: AllocationSlice[];
  geoAllocation: AllocationSlice[];
  movers: { gainers: MoverItem[]; losers: MoverItem[] };
  currencyCards: CurrencyCard[];
  waterfallData: WaterfallItem[];
  portfolioSeries: PortfolioSeriesPoint[];
  portfolioSeriesDaily: PortfolioSeriesPoint[];
  fxSeries: FxSeriesPoint[];
  fxLabels: string[];
  fxColors: Record<string, string>;
  baseFxRates: Record<string, number>;
  // user settings — mutable
  displayName: string;
  baseCurrency: string;
  role: string;
  costBasisMethod: CostBasisMethod;
  setDisplayName: (v: string) => void;
  setBaseCurrency: (v: string) => void;
  setCostBasisMethod: (v: CostBasisMethod) => void;
  // derived converters
  toBase: (sgdVal: number) => number;
  fmtVal: (sgdVal: number) => string;
  fmtSigned: (sgdVal: number) => string;
}

interface ProviderProps {
  value: Omit<
    PortfolioContextValue,
    | "displayName"
    | "baseCurrency"
    | "role"
    | "costBasisMethod"
    | "setDisplayName"
    | "setBaseCurrency"
    | "setCostBasisMethod"
    | "toBase"
    | "fmtVal"
    | "fmtSigned"
  > & {
    initialDisplayName: string;
    initialBaseCurrency: string;
    initialRole: string;
    initialCostBasisMethod: CostBasisMethod;
  };
  children: React.ReactNode;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ value, children }: ProviderProps) {
  const [displayName, setDisplayName] = useState(value.initialDisplayName);
  const [baseCurrency, setBaseCurrency] = useState(value.initialBaseCurrency);
  const [costBasisMethod, setCostBasisMethod] = useState(
    value.initialCostBasisMethod,
  );
  const role = value.initialRole;

  const toBase = useCallback(
    (sgdVal: number) => {
      const rate = value.baseFxRates[baseCurrency] ?? 1;
      return sgdVal / rate;
    },
    [baseCurrency, value.baseFxRates],
  );

  const fmtVal = useCallback(
    (sgdVal: number) => ccyFmt(toBase(sgdVal), baseCurrency),
    [toBase, baseCurrency],
  );

  const fmtSigned = useCallback(
    (sgdVal: number) => ccySigned(toBase(sgdVal), baseCurrency),
    [toBase, baseCurrency],
  );

  const ctx: PortfolioContextValue = {
    ...value,
    displayName,
    baseCurrency,
    role,
    costBasisMethod,
    setDisplayName,
    setBaseCurrency,
    setCostBasisMethod,
    toBase,
    fmtVal,
    fmtSigned,
  };

  return (
    <PortfolioContext.Provider value={ctx}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext);
  if (!ctx)
    throw new Error("usePortfolio must be used within PortfolioProvider");
  return ctx;
}
```

- [ ] **Step 4: Rename `hero.totalGain`/`totalGainPct` in `SummaryRail.tsx`**

Edit `src/components/SummaryRail.tsx`:
- Line 19: replace `const invested = hero.total - hero.totalGain;` with `const invested = hero.total - hero.unrealizedGain;`
- Line 92: replace `color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)",` with `color: hero.unrealizedGain >= 0 ? "var(--gain)" : "var(--loss)",`
- Line 95: replace `{fmtSigned(hero.totalGain)}` with `{fmtSigned(hero.unrealizedGain)}`
- Line 100: replace `color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)",` with `color: hero.unrealizedGain >= 0 ? "var(--gain)" : "var(--loss)",`
- Line 103: replace `{pct(hero.totalGainPct)}` with `{pct(hero.unrealizedGainPct)}`

(The "Total Gain" label text at line 88 is left as-is — it's still showing the same unrealized-only figure it always has; only the underlying field name changed.)

- [ ] **Step 5: Rename and split the hero tile in `overview/page.tsx`**

Edit `src/app/(dashboard)/overview/page.tsx` — line 192: replace
```tsx
  const assetGain = hero.totalGain - hero.fxImpact;
```
with
```tsx
  const assetGain = hero.unrealizedGain - hero.fxImpact;
```

Edit the hero grid: replace
```tsx
      <div className="grid grid-cols-3 gap-3.5 animate-reveal max-bp1080:grid-cols-2 max-bp480:grid-cols-2">
```
with
```tsx
      <div className="grid grid-cols-4 gap-3.5 animate-reveal max-bp1080:grid-cols-2 max-bp480:grid-cols-2">
```

Replace the "Total Gain" tile (currently the second of three tiles, right after the "Total Value" tile — identified by the `Total Gain` label and `hero.totalGain` reads):
```tsx
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">
            Total Gain
          </span>
          <span
            className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]"
            style={{
              color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            <CountUp
              to={toBase(hero.totalGain)}
              format={(v) => ccySigned(v, baseCurrency)}
              startOnView={false}
            />
          </span>
          <span
            className="font-mono text-xs tabular-nums"
            style={{
              color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            {pct(hero.totalGainPct)}
          </span>
        </div>
```
with two tiles:
```tsx
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">
            Unrealized Gain
          </span>
          <span
            className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]"
            style={{
              color: hero.unrealizedGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            <CountUp
              to={toBase(hero.unrealizedGain)}
              format={(v) => ccySigned(v, baseCurrency)}
              startOnView={false}
            />
          </span>
          <span
            className="font-mono text-xs tabular-nums"
            style={{
              color: hero.unrealizedGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            {pct(hero.unrealizedGainPct)}
          </span>
        </div>
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">
            Realized Gain
          </span>
          <span
            className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]"
            style={{
              color: hero.realizedGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            <CountUp
              to={toBase(hero.realizedGain)}
              format={(v) => ccySigned(v, baseCurrency)}
              startOnView={false}
            />
          </span>
          <span
            className="font-mono text-xs tabular-nums"
            style={{
              color: hero.realizedGain >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            {pct(hero.realizedGainPct)}
          </span>
        </div>
```

Then update the remaining two `hero.totalGain`/`totalGainPct` reads further down the page (the waterfall/breakdown section):
- Replace `color: hero.totalGain >= 0 ? "var(--gain)" : "var(--loss)",` (the one at the original line ~607, in the breakdown section) with `color: hero.unrealizedGain >= 0 ? "var(--gain)" : "var(--loss)",`
- Replace `{fmtSigned(hero.totalGain)}{" "}` with `{fmtSigned(hero.unrealizedGain)}{" "}`
- Replace `<span>{pct(hero.totalGainPct)}</span>` with `<span>{pct(hero.unrealizedGainPct)}</span>`

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere (all `hero.totalGain`/`totalGainPct` reads across the codebase are now gone — re-run the earlier grep to confirm: `grep -rn "hero.totalGain\|\.totalGainPct" src` should return nothing from `HeroStats`-typed code; `types/snapshot.ts`'s unrelated `PortfolioSnapshot.totalGainSGD`/`totalGainPct` fields are untouched and fine to keep as-is, they're a different type).

- [ ] **Step 7: Browser verification**

Run: `npm run dev`, open `/overview` in a browser, confirm:
- Four hero tiles render (Total Value, Unrealized Gain, Realized Gain, FX Impact) without layout breakage at desktop, tablet (1080px), and mobile (480px/380px) widths.
- Numbers match expectations for a test account with at least one realized sale.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(dashboard\)/layout.tsx src/components/DashboardShell.tsx src/context/portfolio.tsx src/components/SummaryRail.tsx src/app/\(dashboard\)/overview/page.tsx
git commit -m "Wire realized lots through the dashboard layout; split hero gain tile"
```

---

### Task 11: Settings — cost-basis method selector

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `costBasisMethod`/`setCostBasisMethod` from `usePortfolio()` (Task 10).

- [ ] **Step 1: Accept `costBasisMethod` in the settings API**

Edit `src/app/api/settings/route.ts` — replace the whole file:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchUserSettings, upsertUserSettings } from "@/lib/supabase/data";

const CCY_RE = /^[A-Z]{3}$/;
const COST_BASIS_METHODS = ["fifo", "average", "specific"];

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const settings = await fetchUserSettings(user.id);
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : undefined;
  const baseCurrency =
    typeof body.baseCurrency === "string"
      ? body.baseCurrency.toUpperCase()
      : undefined;
  const costBasisMethod =
    typeof body.costBasisMethod === "string" ? body.costBasisMethod : undefined;

  if (displayName !== undefined && displayName.length > 80) {
    return NextResponse.json(
      { error: "displayName too long" },
      { status: 400 },
    );
  }
  if (baseCurrency !== undefined && !CCY_RE.test(baseCurrency)) {
    return NextResponse.json(
      { error: "invalid baseCurrency" },
      { status: 400 },
    );
  }
  if (
    costBasisMethod !== undefined &&
    !COST_BASIS_METHODS.includes(costBasisMethod)
  ) {
    return NextResponse.json(
      { error: "invalid costBasisMethod" },
      { status: 400 },
    );
  }

  await upsertUserSettings(user.id, {
    displayName,
    baseCurrency,
    costBasisMethod: costBasisMethod as "fifo" | "average" | "specific" | undefined,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Add the Settings UI card**

Edit `src/app/(dashboard)/settings/page.tsx`:

Replace the destructure at the top:
```tsx
  const {
    displayName,
    baseCurrency,
    baseFxRates,
    fxColors,
    role,
    costBasisMethod,
    setDisplayName,
    setBaseCurrency,
    setCostBasisMethod,
  } = usePortfolio();
```

Add state right after `const [ccyInput, setCcyInput] = useState(baseCurrency);`:
```tsx
  const [methodInput, setMethodInput] = useState(costBasisMethod);
```

Replace `const isDirty = nameInput !== displayName || ccyInput !== baseCurrency;` with:
```tsx
  const isDirty =
    nameInput !== displayName ||
    ccyInput !== baseCurrency ||
    methodInput !== costBasisMethod;
```

Replace the `handleSave` body's fetch call:
```tsx
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: nameInput,
        baseCurrency: ccyInput,
        costBasisMethod: methodInput,
      }),
    });

    if (res.ok) {
      setDisplayName(nameInput);
      setBaseCurrency(ccyInput);
      setCostBasisMethod(methodInput);
      setSaveState("saved");
```
(only the `body` JSON and the three `set*` calls on success change; the rest of `handleSave` is untouched)

Replace the discard-changes button's `onClick`:
```tsx
              onClick={() => {
                setNameInput(displayName);
                setCcyInput(baseCurrency);
                setMethodInput(costBasisMethod);
              }}
```

Insert a new card between the closing `</div>` of the "Base Currency" card and the `{/* Save */}` comment:
```tsx
        {/* Cost-Basis Method */}
        <div className="card flex flex-col gap-4 px-5 py-4.5 max-bp480:p-3.5 max-bp380:p-3">
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-[13px] font-semibold text-primary tracking-[.01em]">
              Cost-Basis Method
            </span>
            <span className="font-ui text-secondary text-[11px]">
              how realized gains are matched when you sell
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {(
              [
                { v: "fifo", label: "FIFO", hint: "oldest lots first" },
                { v: "average", label: "Average", hint: "blended cost" },
                { v: "specific", label: "Specific-lot", hint: "choose per sale" },
              ] as const
            ).map((m) => (
              <button
                key={m.v}
                type="button"
                className={
                  "bg-elevated border rounded-[11px] px-4 py-3 cursor-pointer flex flex-col gap-[3px] [transition:border-color_.15s,background_.15s,box-shadow_.15s] text-left min-w-[110px] " +
                  (methodInput === m.v
                    ? "border-gold-soft bg-wash shadow-[inset_0_0_0_1px_var(--border-gold)]"
                    : "border-subtle hover:border-muted")
                }
                onClick={() => setMethodInput(m.v)}
              >
                <span className="font-ui text-[13px] font-semibold text-primary">
                  {m.label}
                </span>
                <span className="font-ui text-[10.5px] text-secondary">
                  {m.hint}
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

Run: `npm run dev`, open `/settings`, confirm:
- Cost-Basis Method card renders with three options, current selection highlighted.
- Changing selection enables "Save preferences"; saving persists (reload the page and confirm the selection sticks); "Discard changes" resets it.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/route.ts "src/app/(dashboard)/settings/page.tsx"
git commit -m "Add cost-basis method selector to Settings"
```

---

### Task 12: Sell form — method override + specific-lot picker

**Files:**
- Create: `src/app/api/holdings/open-lots/route.ts`
- Modify: `src/lib/supabase/data.ts` (already has `resolveInstrumentIdForTicker` from Task 6 — no change needed here)
- Modify: `src/app/(dashboard)/holdings/page.tsx`

**Interfaces:**
- Consumes: `resolveInstrumentIdForTicker`, `fetchOpenBuyLots` (Task 6); `OpenBuyLot` type (Task 3); `costBasisMethod` from `usePortfolio()` (Task 10).
- Produces: `GET /api/holdings/open-lots?ticker=XXX` → `OpenBuyLot[]`. `POST /api/holdings` sell requests now include `cost_basis_method` and, when applicable, `lot_allocations`.

- [ ] **Step 1: Add the open-lots endpoint**

Create `src/app/api/holdings/open-lots/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import {
  fetchOpenBuyLots,
  resolveInstrumentIdForTicker,
} from "@/lib/supabase/data";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const ticker = new URL(req.url).searchParams.get("ticker");
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

  const instrumentId = await resolveInstrumentIdForTicker(user.id, ticker);
  if (!instrumentId) return NextResponse.json([]);

  const openLots = await fetchOpenBuyLots(user.id, instrumentId);
  return NextResponse.json(openLots);
}
```

- [ ] **Step 2: Add method override + lot-picker state to `DetailCard`**

Edit `src/app/(dashboard)/holdings/page.tsx`:

Add near the top of the file, after the existing imports (after `import { groupHoldings } from "@/lib/group-holdings";`):
```tsx
import type { OpenBuyLot } from "@/lib/realized";
import type { CostBasisMethod } from "@/types/settings";

const METHOD_LABEL: Record<CostBasisMethod, string> = {
  fifo: "FIFO",
  average: "Average",
  specific: "Specific-lot",
};
```

Replace the `DetailCard` destructure:
```tsx
  const { fmtVal, fmtSigned, costBasisMethod } = usePortfolio();
```

Add new state right after the existing `const canSell = h.ticker !== "—";` line:
```tsx
  const [methodOverride, setMethodOverride] = useState<CostBasisMethod | null>(
    null,
  );
  const effectiveMethod = methodOverride ?? costBasisMethod;
  const [openLots, setOpenLots] = useState<OpenBuyLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [lotAllocations, setLotAllocations] = useState<Record<string, string>>(
    {},
  );
  const allocatedTotal = Object.values(lotAllocations).reduce(
    (s, v) => s + (Number(v) || 0),
    0,
  );

  useEffect(() => {
    if (mode !== "sell" || effectiveMethod !== "specific" || !canSell) return;
    let alive = true;
    setLoadingLots(true);
    fetch(`/api/holdings/open-lots?ticker=${encodeURIComponent(h.ticker)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: OpenBuyLot[]) => {
        if (alive) setOpenLots(rows);
      })
      .finally(() => {
        if (alive) setLoadingLots(false);
      });
    return () => {
      alive = false;
    };
  }, [mode, effectiveMethod, canSell, h.ticker]);
```
(`useEffect` is already imported at the top of the file from `"react"` — confirm the existing import line includes it; if not, add it to the `import { useState, useRef, useEffect } from "react";` line.)

- [ ] **Step 3: Update `handleSell` to send method + allocations**

Edit `src/app/(dashboard)/holdings/page.tsx` — replace the `handleSell` function body:
```tsx
  async function handleSell() {
    setSaving(true);
    try {
      const units = Number(sf.units);
      const price = Number(sf.price);
      if (!(units > 0)) throw new Error("Units to sell must be positive");
      if (!(price > 0)) throw new Error("Sale price must be positive");

      let lot_allocations: { buyLotId: string; qty: number }[] | undefined;
      if (effectiveMethod === "specific") {
        lot_allocations = Object.entries(lotAllocations)
          .map(([buyLotId, v]) => ({ buyLotId, qty: Number(v) || 0 }))
          .filter((a) => a.qty > 0);
        const allocated = lot_allocations.reduce((s, a) => s + a.qty, 0);
        if (Math.abs(allocated - units) > 1e-6) {
          throw new Error("Chosen lot quantities must add up to the units sold");
        }
      }

      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: h.ticker,
          name: h.name,
          asset_type: h.assetType,
          broker: h.broker,
          strategy: h.strategy,
          units,
          currency: h.currency,
          flag: h.flag,
          icon: h.icon,
          buy_price: price,
          buy_date: sf.date,
          buy_fx_rate: Number(sf.fx) || d.curFx || 1,
          current_price: d.curPx,
          current_fx_rate: d.curFx,
          spark_data: h.sparkData,
          transaction_type: "sell",
          source: h.source,
          cost_basis_method: effectiveMethod,
          ...(lot_allocations ? { lot_allocations } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Sale failed");
      }
      toast.success(`Sold ${units} ${h.name}`);
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sale failed");
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 4: Add the method selector + lot-picker to the sell-mode render**

Edit `src/app/(dashboard)/holdings/page.tsx` — in the `mode === "sell"` render block, insert this immediately before the "Confirm Sale" button (i.e. right after the closing `</div>` of the FX-rate/units/price/date `grid grid-cols-2` block, before `<button ... onClick={handleSell}`):
```tsx
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">
            Cost-basis method
          </span>
          <Select
            value={METHOD_LABEL[effectiveMethod]}
            options={Object.values(METHOD_LABEL)}
            onChange={(v) => {
              const next = (Object.entries(METHOD_LABEL).find(
                ([, l]) => l === v,
              )?.[0] ?? "fifo") as CostBasisMethod;
              setMethodOverride(next);
            }}
          />
        </div>
        {effectiveMethod === "specific" && (
          <div className="flex flex-col gap-1.5 rounded-[8px] border border-subtle bg-surface p-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted">
              Choose lots to close
            </span>
            {loadingLots ? (
              <span className="font-ui text-[11.5px] text-secondary">
                Loading open lots…
              </span>
            ) : openLots.length === 0 ? (
              <span className="font-ui text-[11.5px] text-secondary">
                No open lots found.
              </span>
            ) : (
              openLots.map((lot) => (
                <div key={lot.id} className="flex items-center justify-between gap-2">
                  <span className="font-ui text-[11.5px] text-secondary">
                    {lot.tradeDate} · {NF(lot.openQuantity, 4)} open @ {NF(lot.price, 4)}
                  </span>
                  <input
                    className="w-20 rounded-[6px] border border-subtle bg-elevated px-2 py-1 font-mono text-[11.5px] text-primary outline-none focus:border-gold-soft"
                    type="number"
                    min="0"
                    max={lot.openQuantity}
                    step="any"
                    placeholder="0"
                    value={lotAllocations[lot.id] ?? ""}
                    onChange={(e) =>
                      setLotAllocations((prev) => ({
                        ...prev,
                        [lot.id]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))
            )}
            <span className="font-ui text-[11px] text-muted">
              Allocated: {NF(allocatedTotal, 4)} / {sf.units || "0"}
            </span>
          </div>
        )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Browser verification**

Run: `npm run dev`. On the Holdings page:
1. Open a holding with multiple buy lots, click "Sell", confirm the "Cost-basis method" dropdown defaults to the Settings-page default and shows FIFO/Average/Specific-lot options.
2. Switch to "Specific-lot" — confirm the open-lots list loads (dates, remaining qty, price) and the "Allocated: X / Y" counter updates as you type into the per-lot inputs.
3. Try to confirm the sale with allocations that don't sum to the units field — confirm a toast error, no request sent to a broken state.
4. Complete a valid specific-lot sale — confirm success toast and the page refreshes.

Expected: all four behave as described.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/holdings/open-lots/route.ts "src/app/(dashboard)/holdings/page.tsx"
git commit -m "Add cost-basis method override and specific-lot picker to the sell form"
```

---

### Task 13: Holdings page — Open/Closed sub-tabs

**Files:**
- Modify: `src/app/(dashboard)/holdings/page.tsx`

**Interfaces:**
- Consumes: `closedPositions` from `usePortfolio()` (Task 10).

- [ ] **Step 1: Add tab state and the tab-switcher UI**

Edit `src/app/(dashboard)/holdings/page.tsx`:

Replace the `HoldingsPage` destructure:
```tsx
  const { holdings, fmtVal, fmtSigned, closedPositions } = usePortfolio();
```

Add new state right after `const [groupView, setGroupView] = useState(true);`:
```tsx
  const [tab, setTab] = useState<"open" | "closed">("open");
```

Insert the tab-switcher UI immediately after the component's opening `<div className="flex w-full min-w-0 flex-col gap-[18px]">` and before the `{/* filter bar */}` comment:
```tsx
      <div className="flex gap-1.5 animate-reveal">
        <button
          className={
            "cursor-pointer rounded-lg border px-[15px] py-[7px] font-ui text-[12.5px] transition-all duration-150 " +
            (tab === "open"
              ? "border-gold-soft bg-wash text-gold"
              : "border-subtle bg-surface text-secondary hover:border-muted hover:text-primary")
          }
          onClick={() => setTab("open")}
        >
          Open
        </button>
        <button
          className={
            "cursor-pointer rounded-lg border px-[15px] py-[7px] font-ui text-[12.5px] transition-all duration-150 " +
            (tab === "closed"
              ? "border-gold-soft bg-wash text-gold"
              : "border-subtle bg-surface text-secondary hover:border-muted hover:text-primary")
          }
          onClick={() => setTab("closed")}
        >
          Closed{closedPositions.length > 0 ? ` (${closedPositions.length})` : ""}
        </button>
      </div>

```

- [ ] **Step 2: Wrap the existing Open-tab content**

Edit `src/app/(dashboard)/holdings/page.tsx`:

Immediately after the tab-switcher block added in Step 1 (and still before `{/* filter bar */}`), open a conditional:
```tsx
      {tab === "open" && (
        <>
```

Immediately before the final closing of the component's outer wrapper — i.e., right after the `{/* compare / inspector tray */}` section's closing `</div>` (the one that closes `Inspector`) and before the component's own final `</div>`), close the conditional:
```tsx
        </>
      )}
```

This wraps everything from the filter bar through the Inspector tray (unchanged internally) in `{tab === "open" && (<>...</>)}`.

- [ ] **Step 3: Add the Closed-tab content**

Edit `src/app/(dashboard)/holdings/page.tsx` — immediately after the `{tab === "open" && (...)}` block's closing `)}` (Step 2), and still inside the outer wrapper `<div>`, add:
```tsx

      {tab === "closed" && (
        <div className="card p-0 overflow-x-auto overflow-y-hidden max-bp768:overflow-y-visible animate-reveal">
          <table className="w-full border-collapse max-bp768:min-w-[620px] [&_tbody_tr:last-child>td]:border-b-0">
            <thead>
              <tr>
                <Th>Name / Ticker</Th>
                <Th>Type</Th>
                <Th right>Units Sold</Th>
                <Th right>Asset Gain</Th>
                <Th right>FX Gain</Th>
                <Th right>Realized Gain</Th>
                <Th>Last Sale</Th>
              </tr>
            </thead>
            <tbody>
              {closedPositions.map((p) => (
                <tr key={p.ticker}>
                  <td className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <Icon
                        name={p.icon as never}
                        size={15}
                        style={{ color: "var(--gold)" }}
                      />
                      <div className="flex flex-col">
                        <span className="font-ui text-[13px] text-primary">
                          {p.name}
                        </span>
                        <span className="font-mono text-[11px] text-secondary">
                          {p.ticker}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 font-ui text-[12.5px] text-secondary">
                    {p.assetType}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-[12.5px] tabular-nums">
                    {NF(p.totalQuantitySold, 4)}
                  </td>
                  <td
                    className="px-3.5 py-2.5 text-right font-mono text-[12.5px] tabular-nums"
                    style={{
                      color: p.assetGainSgd >= 0 ? "var(--gain)" : "var(--loss)",
                    }}
                  >
                    {fmtSigned(p.assetGainSgd)}
                  </td>
                  <td
                    className="px-3.5 py-2.5 text-right font-mono text-[12.5px] tabular-nums"
                    style={{
                      color:
                        p.fxGainSgd >= 0
                          ? "var(--fx-positive)"
                          : "var(--fx-negative)",
                    }}
                  >
                    {fmtSigned(p.fxGainSgd)}
                  </td>
                  <td
                    className="px-3.5 py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums"
                    style={{
                      color: p.realizedGainSgd >= 0 ? "var(--gain)" : "var(--loss)",
                    }}
                  >
                    {fmtSigned(p.realizedGainSgd)}
                  </td>
                  <td className="px-3.5 py-2.5 font-ui text-[12.5px] text-secondary">
                    {p.lastSaleDate}
                  </td>
                </tr>
              ))}
              {closedPositions.length === 0 && (
                <tr>
                  <td
                    className="text-[13px]"
                    colSpan={7}
                    style={{ textAlign: "center", padding: "32px 0" }}
                  >
                    <span className="font-ui text-secondary">
                      No closed positions yet.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Browser verification**

Run: `npm run dev`, open `/holdings`:
1. Confirm "Open"/"Closed" tabs render above the filter bar; "Open" is selected by default and behaves exactly as before (Flat/Grouped toggle, search, filters, CSV export, refresh, delete-all, Inspector tray all still work).
2. Fully sell out of a test position (sell all units), switch to "Closed" — confirm it now appears with correct realized-gain figures, and it has disappeared from the "Open" tab's table and totals.
3. Confirm a position that's only *partially* sold does NOT appear on the Closed tab (it should still show under Open with reduced units).

Expected: all three behave as described.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/holdings/page.tsx"
git commit -m "Add Open/Closed sub-tabs to the Holdings page"
```

---

## Post-implementation checklist (self-review already applied above, restated for the executor)

- [ ] Every task's `npx tsc --noEmit` is clean with zero errors repo-wide after Task 13.
- [ ] `npm test` (Vitest) is green for `fx.test.ts`, `group-holdings.test.ts`, `realized.test.ts`.
- [ ] The migration (Task 4) has been applied to the actual Supabase project by a human operator before Tasks 8-13 are exercised against real data.
- [ ] `npm run lint` is clean.
- [ ] Full manual walkthrough: add → sell (FIFO default) → sell (Average override) → sell (Specific-lot with picker) → attempt an invalid edit/delete on matched lots → view Closed tab → view Overview hero split → change Settings default method and confirm it takes effect on the next sell without an override.
