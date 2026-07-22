# T10 — History Correctness + Scheduled Snapshotting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portfolio value-over-time series correct (net-of-sells, single raw price basis) in both the historical rebuild and the live snapshot, and make snapshots accrue automatically via a portable, secret-guarded daily cron that backfills any missing days.

**Architecture:** A new pure module `src/lib/history.ts` computes a net-position snapshot as of any date (`netUnitsAsOf`, `computeSnapshotAsOf`) — the time-sliced, re-priced analogue of `netAggregate` in `group-holdings.ts`. A shared core `src/lib/snapshots/build.ts` (fill-forward + row assembly) and `src/lib/snapshots/fetch.ts` (provider price/FX fetch over a date window) are extracted from the existing backfill route so both the on-demand backfill and the new cron use one implementation. `recordSnapshot` is fixed to aggregate over `toNetPositions`. A new `POST /api/internal/snapshot-all` route, guarded by `CRON_SECRET`, snapshots every active user and backfills their missing days. All snapshot dating moves to SGT via a shared `src/lib/dates.ts` helper.

**Tech Stack:** TypeScript strict, Vitest 3 (`npm test`), Next.js 16 App Router route handlers, Supabase (service-role admin client for the cron).

## Global Constraints

- TypeScript strict mode — `npx tsc --noEmit` clean repo-wide after each task.
- Tests run with `npm test` (Vitest `run` mode). A single file: `npx vitest run src/lib/<file>.test.ts`.
- No comments except where a hidden constraint or non-obvious invariant would otherwise be lost (matches repo style).
- **Snapshots are holdings-only.** Cash is overlaid at read time by T8 (`computeTotalValueSeries`) — never add cash to a snapshot row.
- **No `portfolio_snapshots` schema change.** Row shape stays `{ user_id, recorded_date, value_sgd, cost_sgd, fx_impact_sgd, fx_by_currency }`; on-conflict key `(user_id, recorded_date)`.
- **Grouping key convention (load-bearing):** named tickers merge by `ticker`; untickered physical assets use `NON_GROUPABLE = new Set(["—","-",""])` (`src/lib/positions.ts`) and are keyed by lot `id`. `computeSnapshotAsOf` MUST use this same key or it will merge distinct gold/RE holdings.
- **Average cost uses BUY lots only** — a sell removes units at the running average, it never changes average cost (mirrors `netAggregate`).
- **Raw (unadjusted) price basis everywhere** — historical value, live value, and cost must all be on the raw scale. Do not use EODHD `adjusted_close`.
- **Snapshot dating is SGT** — all `recorded_date` values come from `sgtDate()` (Asia/Singapore), not UTC.
- New env var: `CRON_SECRET` (server-only). New file: `vercel.json` (example trigger).

---

### Task 1: SGT date helper (`src/lib/dates.ts`, TDD)

**Files:**
- Create: `src/lib/dates.ts`
- Create: `src/lib/dates.test.ts`

**Interfaces:**
- Produces:
  - `sgtDate(d?: Date): string` — the `Asia/Singapore` calendar date as `YYYY-MM-DD`.
  - `isSnapshotStaleForDay(latestRecordedDate: string | undefined, now?: Date): boolean` — true when the latest snapshot's date isn't today (SGT), or there are none.
- Consumed by: Task 3 (`recordSnapshot`), Task 6 (backfill `today`), Task 8 (cron `today`), and the companion daily-auto-refresh plan.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sgtDate, isSnapshotStaleForDay } from "./dates";

describe("sgtDate", () => {
  it("returns the Asia/Singapore calendar date as YYYY-MM-DD", () => {
    // 2026-07-21T20:00:00Z == 2026-07-22 04:00 SGT
    expect(sgtDate(new Date("2026-07-21T20:00:00Z"))).toBe("2026-07-22");
  });

  it("has already rolled to the next SGT day at UTC 16:00", () => {
    // 2026-07-21T16:00:00Z == 2026-07-22 00:00 SGT
    expect(sgtDate(new Date("2026-07-21T16:00:00Z"))).toBe("2026-07-22");
  });

  it("stays on the SGT day for a same-day UTC morning time", () => {
    // 2026-07-22T02:00:00Z == 2026-07-22 10:00 SGT
    expect(sgtDate(new Date("2026-07-22T02:00:00Z"))).toBe("2026-07-22");
  });
});

describe("isSnapshotStaleForDay", () => {
  const now = new Date("2026-07-22T02:00:00Z"); // 2026-07-22 SGT

  it("is not stale when the latest snapshot is today (SGT)", () => {
    expect(isSnapshotStaleForDay("2026-07-22", now)).toBe(false);
  });

  it("is stale when the latest snapshot is a prior day", () => {
    expect(isSnapshotStaleForDay("2026-07-21", now)).toBe(true);
  });

  it("is stale when there are no snapshots", () => {
    expect(isSnapshotStaleForDay(undefined, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — `Failed to resolve import "./dates"` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dates.ts`:
```ts
// Asia/Singapore has no DST, so the offset is a fixed +08:00 year-round.
// en-CA formats a Date as YYYY-MM-DD, which is exactly our snapshot key.
export function sgtDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

// The once-per-day signal: a snapshot already exists for the current SGT day.
export function isSnapshotStaleForDay(
  latestRecordedDate: string | undefined,
  now: Date = new Date(),
): boolean {
  return latestRecordedDate !== sgtDate(now);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat(dates): add SGT calendar-date helper and daily staleness check"
```

---

### Task 2: Net-position snapshot math (`src/lib/history.ts`, TDD)

**Files:**
- Create: `src/lib/history.ts`
- Create: `src/lib/history.test.ts`

**Interfaces:**
- Consumes: `NON_GROUPABLE` (`@/lib/positions`, existing). `HoldingRow` (`@/types/holding`) satisfies `LotLite` structurally.
- Produces:
  - `interface LotLite { id: string; ticker: string; transactionType: "buy" | "sell"; units: number; buyDate: string; buyPrice: number; buyFxRate: number; fees: number; currency: string; }`
  - `interface SnapshotAgg { valueSgd: number; costSgd: number; fxImpactSgd: number; fxByCurrency: Record<string, number>; }`
  - `netUnitsAsOf(lots: LotLite[], date: string): number`
  - `computeSnapshotAsOf(lots: LotLite[], date: string, priceOf: (ticker: string, date: string) => number, fxOf: (ccy: string, date: string) => number): SnapshotAgg`
- Consumed by: Task 4 (`build.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/history.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { netUnitsAsOf, computeSnapshotAsOf, type LotLite } from "./history";

function lot(o: Partial<LotLite> = {}): LotLite {
  return {
    id: "l1",
    ticker: "AAA",
    transactionType: "buy",
    units: 10,
    buyDate: "2026-01-01",
    buyPrice: 100,
    buyFxRate: 1,
    fees: 0,
    currency: "SGD",
    ...o,
  };
}

// Flat maps for deterministic pricing.
const priceOf = (ticker: string) => (ticker === "AAA" ? 200 : 0);
const fxSgd = () => 1;

describe("netUnitsAsOf", () => {
  it("sums buys up to and including the date", () => {
    const lots = [lot({ id: "a", units: 10, buyDate: "2026-01-01" })];
    expect(netUnitsAsOf(lots, "2026-01-01")).toBe(10);
  });

  it("excludes lots acquired after the date", () => {
    const lots = [lot({ id: "a", units: 10, buyDate: "2026-02-01" })];
    expect(netUnitsAsOf(lots, "2026-01-15")).toBe(0);
  });

  it("subtracts sells and floors at zero", () => {
    const lots = [
      lot({ id: "a", units: 10, buyDate: "2026-01-01" }),
      lot({ id: "b", transactionType: "sell", units: 4, buyDate: "2026-01-10" }),
    ];
    expect(netUnitsAsOf(lots, "2026-01-05")).toBe(10); // before sale
    expect(netUnitsAsOf(lots, "2026-01-10")).toBe(6); // on/after sale
  });
});

describe("computeSnapshotAsOf", () => {
  it("values a simple SGD position at net units x price", () => {
    const lots = [lot()]; // 10 units, buy 100, price 200
    const s = computeSnapshotAsOf(lots, "2026-06-01", priceOf, fxSgd);
    expect(s.valueSgd).toBe(2000);
    expect(s.costSgd).toBe(1000);
    expect(s.fxImpactSgd).toBe(0);
  });

  it("reflects a partial sell at unchanged average cost", () => {
    const lots = [
      lot({ id: "a", units: 10, buyPrice: 100, buyDate: "2026-01-01" }),
      lot({ id: "b", transactionType: "sell", units: 4, buyDate: "2026-03-01" }),
    ];
    const before = computeSnapshotAsOf(lots, "2026-02-01", priceOf, fxSgd);
    expect(before.valueSgd).toBe(2000); // 10 x 200
    expect(before.costSgd).toBe(1000); // 10 x 100
    const after = computeSnapshotAsOf(lots, "2026-03-01", priceOf, fxSgd);
    expect(after.valueSgd).toBe(1200); // 6 x 200
    expect(after.costSgd).toBe(600); // 6 x 100, avg cost unchanged
  });

  it("drops a fully-closed position", () => {
    const lots = [
      lot({ id: "a", units: 10, buyDate: "2026-01-01" }),
      lot({ id: "b", transactionType: "sell", units: 10, buyDate: "2026-04-01" }),
    ];
    const s = computeSnapshotAsOf(lots, "2026-05-01", priceOf, fxSgd);
    expect(s.valueSgd).toBe(0);
    expect(s.costSgd).toBe(0);
  });

  it("accrues FX impact for a non-SGD holding on that date's rate", () => {
    // 10 units USD, buy px 100 @ buyFx 1.30; today's FX 1.40; price flat at 100.
    const lots = [
      lot({ ticker: "USX", units: 10, buyPrice: 100, buyFxRate: 1.3, currency: "USD" }),
    ];
    const flatUsPrice = () => 100;
    const usdFx = () => 1.4;
    const s = computeSnapshotAsOf(lots, "2026-06-01", flatUsPrice, usdFx);
    expect(s.valueSgd).toBeCloseTo(10 * 100 * 1.4, 6); // 1400
    expect(s.costSgd).toBeCloseTo(10 * 100 * 1.3, 6); // 1300
    expect(s.fxImpactSgd).toBeCloseTo(10 * 100 * (1.4 - 1.3), 6); // 100
    expect(s.fxByCurrency.usd).toBeCloseTo(100, 6);
  });

  it("keeps two untickered physical assets separate and prices them at cost", () => {
    // Both ticker "—" but different ids → must not merge; no market feed.
    const lots = [
      lot({ id: "g1", ticker: "—", units: 1, buyPrice: 3000 }),
      lot({ id: "g2", ticker: "—", units: 2, buyPrice: 3000 }),
    ];
    const s = computeSnapshotAsOf(lots, "2026-06-01", () => 99999, fxSgd);
    // Priced at own cost, not the (ignored) priceOf feed: (1+2) x 3000
    expect(s.valueSgd).toBe(9000);
    expect(s.costSgd).toBe(9000);
  });

  it("uses each buy lot's weighted-average cost", () => {
    const lots = [
      lot({ id: "a", units: 10, buyPrice: 100, buyDate: "2026-01-01" }),
      lot({ id: "b", units: 10, buyPrice: 200, buyDate: "2026-02-01" }),
    ];
    const s = computeSnapshotAsOf(lots, "2026-03-01", priceOf, fxSgd);
    expect(s.valueSgd).toBe(4000); // 20 x 200
    expect(s.costSgd).toBe(3000); // 20 x avg(150)
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/history.test.ts`
Expected: FAIL — `Failed to resolve import "./history"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/history.ts`:
```ts
import { NON_GROUPABLE } from "@/lib/positions";

export interface LotLite {
  id: string;
  ticker: string;
  transactionType: "buy" | "sell";
  units: number;
  buyDate: string;
  buyPrice: number;
  buyFxRate: number;
  fees: number;
  currency: string;
}

export interface SnapshotAgg {
  valueSgd: number;
  costSgd: number;
  fxImpactSgd: number;
  fxByCurrency: Record<string, number>;
}

// Net held quantity of a single position as of `date`: buys minus sells whose
// trade date is on or before `date`, floored at zero.
export function netUnitsAsOf(lots: LotLite[], date: string): number {
  let n = 0;
  for (const l of lots) {
    if (l.buyDate > date) continue;
    n += l.transactionType === "sell" ? -l.units : l.units;
  }
  return Math.max(n, 0);
}

// The time-sliced, re-priced analogue of netAggregate (group-holdings.ts):
// one net position per instrument as of `date`, valued at the raw price/FX for
// that date, cost at the weighted-average of the BUY lots only.
export function computeSnapshotAsOf(
  lots: LotLite[],
  date: string,
  priceOf: (ticker: string, date: string) => number,
  fxOf: (ccy: string, date: string) => number,
): SnapshotAgg {
  // Same grouping key as bucketByPosition: named tickers merge; untickered
  // physical assets (Gold/RE) stay separate by lot id.
  const groups = new Map<string, LotLite[]>();
  for (const l of lots) {
    if (l.buyDate > date) continue;
    const k = NON_GROUPABLE.has(l.ticker) ? l.id : l.ticker;
    const arr = groups.get(k);
    if (arr) arr.push(l);
    else groups.set(k, [l]);
  }

  let valueSgd = 0;
  let costSgd = 0;
  let fxImpactSgd = 0;
  const fxByCurrency: Record<string, number> = {};

  for (const g of groups.values()) {
    const netUnits = netUnitsAsOf(g, date);
    if (netUnits <= 0) continue;

    let buyUnits = 0;
    let pxWeighted = 0;
    let fxWeighted = 0;
    let feesTotal = 0;
    for (const l of g) {
      if (l.transactionType === "sell") continue;
      buyUnits += l.units;
      pxWeighted += l.units * l.buyPrice;
      fxWeighted += l.units * l.buyFxRate;
      feesTotal += l.fees;
    }
    if (buyUnits === 0) continue;

    const avgBuyPx = pxWeighted / buyUnits;
    const avgBuyFx = fxWeighted / buyUnits;
    const avgFeePerUnit = feesTotal / buyUnits;

    const first = g[0];
    const isSgd = first.currency === "SGD";
    // Untickered physical assets have no market feed → valued at their own cost.
    const px = NON_GROUPABLE.has(first.ticker)
      ? avgBuyPx
      : priceOf(first.ticker, date);
    const fx = isSgd ? 1 : fxOf(first.currency, date);

    valueSgd += netUnits * px * fx;
    costSgd += netUnits * (avgBuyPx + avgFeePerUnit) * avgBuyFx;

    if (!isSgd) {
      const impact = netUnits * avgBuyPx * (fx - avgBuyFx);
      fxImpactSgd += impact;
      const key = first.currency.toLowerCase();
      fxByCurrency[key] = (fxByCurrency[key] ?? 0) + impact;
    }
  }

  return { valueSgd, costSgd, fxImpactSgd, fxByCurrency };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/history.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/history.ts src/lib/history.test.ts
git commit -m "feat(history): add net-position snapshot math for any date"
```

---

### Task 3: Fix the live snapshot path (`recordSnapshot`)

**Files:**
- Modify: `src/lib/supabase/data.ts:800-826` (the `recordSnapshot` function)

**Interfaces:**
- Consumes: `toNetPositions` (`@/lib/group-holdings`, existing), `sgtDate` (Task 1). Signature `recordSnapshot(userId: string, holdings: HoldingRow[]): Promise<void>` is unchanged, so the two call sites in `refresh/route.ts` need no edits.

- [ ] **Step 1: Add the imports**

At the top of `src/lib/supabase/data.ts`, add to the existing imports:
```ts
import { toNetPositions } from "@/lib/group-holdings";
import { sgtDate } from "@/lib/dates";
```
(Place near the other `@/lib` imports; confirm `toNetPositions` isn't already imported.)

- [ ] **Step 2: Rewrite the aggregation to use net positions and SGT date**

Replace the body of `recordSnapshot` (currently `src/lib/supabase/data.ts:800-826`) with:
```ts
export async function recordSnapshot(
  userId: string,
  holdings: HoldingRow[],
): Promise<void> {
  // Aggregate over NET positions (buys − sells) so a recorded sale reduces the
  // snapshot instead of inflating it, matching every other portfolio aggregate.
  const net = toNetPositions(holdings);
  const valueSgd = net.reduce((s, h) => s + h.valueSGD, 0);
  const costSgd = net.reduce((s, h) => s + h.costSGD, 0);
  const fxImpactSgd = net.reduce((s, h) => s + h.fxGain, 0);
  const fxByCurrency: Record<string, number> = {};
  for (const h of net) {
    if (h.currency !== "SGD") {
      const k = h.currency.toLowerCase();
      fxByCurrency[k] = (fxByCurrency[k] ?? 0) + h.fxGain;
    }
  }
  const supabase = await makeServerClient();
  await supabase.from("portfolio_snapshots").upsert(
    {
      user_id: userId,
      recorded_date: sgtDate(),
      value_sgd: Math.round(valueSgd),
      cost_sgd: Math.round(costSgd),
      fx_impact_sgd: Math.round(fxImpactSgd),
      fx_by_currency: fxByCurrency,
    },
    { onConflict: "user_id,recorded_date" },
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Watch for an import cycle warning — `group-holdings` imports only from `@/types` and `@/lib/positions`, so importing it into `data.ts` is safe.)

- [ ] **Step 4: Verify no existing test regressed**

Run: `npm test`
Expected: PASS. `recordSnapshot` has no direct unit test; the net-aggregation it now relies on is covered by `src/lib/group-holdings.test.ts`, which must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/data.ts
git commit -m "fix(snapshots): record live snapshot over net positions, dated in SGT"
```

---

### Task 4: Shared snapshot-build core (`src/lib/snapshots/build.ts`, TDD)

**Files:**
- Create: `src/lib/snapshots/build.ts`
- Create: `src/lib/snapshots/build.test.ts`

**Interfaces:**
- Consumes: `computeSnapshotAsOf`, `LotLite` (Task 2); `NON_GROUPABLE` (`@/lib/positions`).
- Produces:
  - `interface SnapshotRowOut { user_id: string; recorded_date: string; value_sgd: number; cost_sgd: number; fx_impact_sgd: number; fx_by_currency: Record<string, number>; }`
  - `dateRange(from: string, to: string): string[]`
  - `fillForward(dates: string[], sparse: Record<string, number>, seed: number): Record<string, number>`
  - `buildSnapshotRows(params: { userId: string; lots: LotLite[]; dates: string[]; rawPrices: Record<string, Record<string, number>>; rawFx: Record<string, Record<string, number>>; priceFallback: (ticker: string) => number; fxFallback: (ccy: string) => number; }): SnapshotRowOut[]`
- Consumed by: Task 6 (backfill route), Task 8 (cron route).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/snapshots/build.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { dateRange, fillForward, buildSnapshotRows } from "./build";
import type { LotLite } from "@/lib/history";

function lot(o: Partial<LotLite> = {}): LotLite {
  return {
    id: "l1",
    ticker: "AAA",
    transactionType: "buy",
    units: 10,
    buyDate: "2026-01-01",
    buyPrice: 100,
    buyFxRate: 1,
    fees: 0,
    currency: "SGD",
    ...o,
  };
}

describe("dateRange", () => {
  it("is inclusive of both ends", () => {
    expect(dateRange("2026-01-01", "2026-01-03")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });
});

describe("fillForward", () => {
  it("carries the last known value across gaps and seeds the front", () => {
    const out = fillForward(
      ["2026-01-01", "2026-01-02", "2026-01-03"],
      { "2026-01-02": 200 },
      100,
    );
    expect(out).toEqual({
      "2026-01-01": 100, // seed until first known
      "2026-01-02": 200,
      "2026-01-03": 200, // carried forward
    });
  });
});

describe("buildSnapshotRows", () => {
  it("builds one rounded row per date, fill-forwarding sparse prices", () => {
    const lots = [lot()]; // 10 units SGD, cost 100
    const rows = buildSnapshotRows({
      userId: "u1",
      lots,
      dates: dateRange("2026-01-01", "2026-01-03"),
      rawPrices: { AAA: { "2026-01-01": 100, "2026-01-03": 120 } },
      rawFx: {},
      priceFallback: () => 100,
      fxFallback: () => 1,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      user_id: "u1",
      recorded_date: "2026-01-01",
      value_sgd: 1000, // 10 x 100
      cost_sgd: 1000,
      fx_impact_sgd: 0,
      fx_by_currency: {},
    });
    // 2026-01-02 fills forward the 01-01 price (100); 01-03 uses 120.
    expect(rows[1].value_sgd).toBe(1000);
    expect(rows[2].value_sgd).toBe(1200);
  });

  it("nets a sell out of later dates", () => {
    const lots = [
      lot({ id: "a", units: 10, buyDate: "2026-01-01" }),
      lot({ id: "b", transactionType: "sell", units: 10, buyDate: "2026-01-03" }),
    ];
    const rows = buildSnapshotRows({
      userId: "u1",
      lots,
      dates: dateRange("2026-01-01", "2026-01-03"),
      rawPrices: { AAA: { "2026-01-01": 100 } },
      rawFx: {},
      priceFallback: () => 100,
      fxFallback: () => 1,
    });
    expect(rows[0].value_sgd).toBe(1000); // held
    expect(rows[2].value_sgd).toBe(0); // fully sold
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/snapshots/build.test.ts`
Expected: FAIL — `Failed to resolve import "./build"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/snapshots/build.ts`:
```ts
import { NON_GROUPABLE } from "@/lib/positions";
import { computeSnapshotAsOf, type LotLite } from "@/lib/history";

export interface SnapshotRowOut {
  user_id: string;
  recorded_date: string;
  value_sgd: number;
  cost_sgd: number;
  fx_impact_sgd: number;
  fx_by_currency: Record<string, number>;
}

// Inclusive UTC-stepped calendar range (the strings are timezone-agnostic keys).
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// Carry last known value across gaps (weekends, holidays); seed the front.
export function fillForward(
  dates: string[],
  sparse: Record<string, number>,
  seed: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let last = seed;
  for (const d of dates) {
    if (sparse[d] !== undefined) last = sparse[d];
    out[d] = last;
  }
  return out;
}

// Assemble one snapshot row per date from a user's lots and sparse price/FX
// maps. Fill-forward is applied here so callers pass raw provider output.
export function buildSnapshotRows(params: {
  userId: string;
  lots: LotLite[];
  dates: string[];
  rawPrices: Record<string, Record<string, number>>;
  rawFx: Record<string, Record<string, number>>;
  priceFallback: (ticker: string) => number;
  fxFallback: (ccy: string) => number;
}): SnapshotRowOut[] {
  const { userId, lots, dates, rawPrices, rawFx, priceFallback, fxFallback } =
    params;

  const tickers = [
    ...new Set(lots.map((l) => l.ticker).filter((t) => !NON_GROUPABLE.has(t))),
  ];
  const currencies = [
    ...new Set(lots.map((l) => l.currency).filter((c) => c !== "SGD")),
  ];

  const prices: Record<string, Record<string, number>> = {};
  for (const t of tickers) {
    prices[t] = fillForward(dates, rawPrices[t] ?? {}, priceFallback(t));
  }
  const fx: Record<string, Record<string, number>> = {};
  for (const c of currencies) {
    fx[c] = fillForward(dates, rawFx[c] ?? {}, fxFallback(c));
  }

  const priceOf = (ticker: string, date: string) =>
    prices[ticker]?.[date] ?? priceFallback(ticker);
  const fxOf = (ccy: string, date: string) => fx[ccy]?.[date] ?? fxFallback(ccy);

  const rows: SnapshotRowOut[] = [];
  for (const date of dates) {
    const agg = computeSnapshotAsOf(lots, date, priceOf, fxOf);
    rows.push({
      user_id: userId,
      recorded_date: date,
      value_sgd: Math.round(agg.valueSgd),
      cost_sgd: Math.round(agg.costSgd),
      fx_impact_sgd: Math.round(agg.fxImpactSgd),
      fx_by_currency: agg.fxByCurrency,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/snapshots/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/snapshots/build.ts src/lib/snapshots/build.test.ts
git commit -m "feat(snapshots): add shared fill-forward + row-assembly core"
```

---

### Task 5: Extract provider fetch over a window (`src/lib/snapshots/fetch.ts`)

**Files:**
- Create: `src/lib/snapshots/fetch.ts`
- Modify: `src/app/api/holdings/backfill/route.ts` (imports only in this task — the route body is refactored in Task 6)

**Interfaces:**
- Consumes: `getProviderFlags` (`@/lib/supabase/app-config`), `fetchDailyCloses` (`@/lib/providers/history`), `fetchFxRateHistory`, `upsertFxHistory` (`@/lib/supabase/data`).
- Produces:
  - `type ProviderFlags = Awaited<ReturnType<typeof getProviderFlags>>`
  - `fetchWindowPrices(params: { tickers: string[]; tickerCurrency: Record<string, string>; from: string; to: string; providers: ProviderFlags; }): Promise<Record<string, Record<string, number>>>` — ticker → date → **raw** close (sparse).
  - `fetchWindowFx(params: { currencies: string[]; from: string; to: string; providers: ProviderFlags; }): Promise<Record<string, Record<string, number>>>` — ccy → date → SGD-per-ccy (sparse); tops up and persists the `fx_history` cache.
- Consumed by: Task 6 (backfill), Task 8 (cron).

> This task is a **behaviour-preserving extraction** of logic currently inline in `backfill/route.ts:16-227`, with **one intentional change**: `fetchEohdHistory` reads `close`, not `adjusted_close` (Global Constraint: raw basis). It is not unit-tested (all paths hit the network / DB); verification is `tsc` + the Task 6 route smoke test.

- [ ] **Step 1: Create `src/lib/snapshots/fetch.ts`**

```ts
import { getProviderFlags } from "@/lib/supabase/app-config";
import { fetchDailyCloses } from "@/lib/providers/history";
import { fetchFxRateHistory, upsertFxHistory } from "@/lib/supabase/data";

export type ProviderFlags = Awaited<ReturnType<typeof getProviderFlags>>;

const EODHD_KEY = process.env.EODHD_API_KEY ?? "";

const EODHD_CODE_REMAP: Record<string, string> = {
  SG: "SI",
  HKEX: "HK",
  ASX: "AU",
  MI: "MI",
};

function normalizeEohdTicker(ticker: string): string {
  if (!ticker.includes(".")) return ticker;
  const [sym, exc] = ticker.split(".");
  return `${sym}.${EODHD_CODE_REMAP[exc] ?? exc}`;
}

// RAW close (not adjusted_close) so history, live value, and cost share one scale.
async function fetchEohdHistory(
  symbol: string,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  if (!EODHD_KEY || EODHD_KEY.startsWith("YOUR_") || EODHD_KEY === "demo")
    return {};
  const url = `https://eodhd.com/api/eod/${symbol}?from=${from}&to=${to}&fmt=json&api_token=${EODHD_KEY}`;
  try {
    const r = await fetch(url, { next: { revalidate: 0 } });
    if (!r.ok) return {};
    const data: { date: string; close: number }[] = await r.json();
    return Object.fromEntries(data.map((d) => [d.date, d.close]));
  } catch {
    return {};
  }
}

async function fetchFxHistory(
  currencies: string[],
  from: string,
  to: string,
): Promise<Record<string, Record<string, number>>> {
  const foreign = currencies.filter((c) => c !== "SGD");
  if (foreign.length === 0) return {};
  try {
    const r = await fetch(
      `https://api.frankfurter.app/${from}..${to}?from=SGD&to=${foreign.join(",")}`,
      { next: { revalidate: 0 } },
    );
    if (!r.ok) return {};
    const data = await r.json();
    const result: Record<string, Record<string, number>> = {};
    for (const [date, rates] of Object.entries(
      data.rates as Record<string, Record<string, number>>,
    )) {
      result[date] = {};
      for (const [ccy, rate] of Object.entries(rates)) {
        result[date][ccy] = 1 / (rate as number);
      }
    }
    return result;
  } catch {
    return {};
  }
}

// EODHD first, Yahoo fallback for tickers EODHD missed (or when EODHD is off).
export async function fetchWindowPrices(params: {
  tickers: string[];
  tickerCurrency: Record<string, string>;
  from: string;
  to: string;
  providers: ProviderFlags;
}): Promise<Record<string, Record<string, number>>> {
  const { tickers, tickerCurrency, from, to, providers } = params;

  const eodhdPrices = providers.eodhd
    ? Object.fromEntries(
        await Promise.all(
          tickers.map(
            async (t) =>
              [t, await fetchEohdHistory(normalizeEohdTicker(t), from, to)] as const,
          ),
        ),
      )
    : Object.fromEntries(tickers.map((t) => [t, {}]));

  const rawPrices: Record<string, Record<string, number>> = { ...eodhdPrices };

  if (providers.yahoo ?? true) {
    const needYahoo = tickers.filter(
      (t) => Object.keys(rawPrices[t] ?? {}).length === 0,
    );
    if (needYahoo.length > 0) {
      const yahooResults = await Promise.all(
        needYahoo.map(
          async (t) =>
            [
              t,
              await fetchDailyCloses(t, tickerCurrency[t] ?? "USD", from, to),
            ] as const,
        ),
      );
      for (const [t, m] of yahooResults) rawPrices[t] = m;
    }
  }

  return rawPrices;
}

// FX from the fx_history cache, fetching only the window not already cached,
// then persisting the merged history. Returns ccy → date → SGD-per-ccy.
export async function fetchWindowFx(params: {
  currencies: string[];
  from: string;
  to: string;
  providers: ProviderFlags;
}): Promise<Record<string, Record<string, number>>> {
  const { currencies, from, to, providers } = params;
  const foreign = currencies.filter((c) => c !== "SGD");
  const fxByCcy: Record<string, Record<string, number>> = {};
  if (foreign.length === 0 || !providers.frankfurter) return fxByCcy;

  const fxCache = await fetchFxRateHistory();
  for (const ccy of foreign) fxByCcy[ccy] = { ...(fxCache[ccy] ?? {}) };

  let fetchFrom = to; // always refresh `to` (its rate is still "live")
  let fullRefetch = false;
  for (const ccy of foreign) {
    const dates = Object.keys(fxByCcy[ccy]);
    if (dates.length === 0) {
      fullRefetch = true;
      break;
    }
    let cmin = dates[0];
    let cmax = dates[0];
    for (const d of dates) {
      if (d < cmin) cmin = d;
      if (d > cmax) cmax = d;
    }
    if (cmin > from) {
      fullRefetch = true;
      break;
    }
    if (cmax < fetchFrom) fetchFrom = cmax;
  }
  if (fullRefetch) fetchFrom = from;

  const fetched = await fetchFxHistory(foreign, fetchFrom, to);
  const touched = new Set<string>();
  for (const [date, rates] of Object.entries(fetched)) {
    for (const ccy of foreign) {
      if (rates[ccy] !== undefined) {
        fxByCcy[ccy][date] = rates[ccy];
        touched.add(ccy);
      }
    }
  }
  await Promise.all([...touched].map((ccy) => upsertFxHistory(ccy, fxByCcy[ccy])));

  return fxByCcy;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`fetch.ts` is not yet imported anywhere; this confirms it compiles standalone.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/snapshots/fetch.ts
git commit -m "refactor(snapshots): extract windowed price/FX fetch, raw close basis"
```

---

### Task 6: Refactor the backfill route onto the shared core

**Files:**
- Modify: `src/app/api/holdings/backfill/route.ts` (replace ~lines 1-304 body; keep auth + rate-limit + response shape)

**Interfaces:**
- Consumes: `dateRange`, `buildSnapshotRows` (Task 4); `fetchWindowPrices`, `fetchWindowFx`, `type ProviderFlags` (Task 5); `sgtDate` (Task 1); `NON_GROUPABLE` (`@/lib/positions`).
- Produces: unchanged route contract — `POST` returning `{ inserted, skipped }`.

> The old inline helpers (`fetchEohdHistory`, `fetchFxHistory`, `dateRange`, `fillForward`, the EODHD remap, and the whole value-assembly loop) are now deleted from this file — they live in `build.ts`/`fetch.ts`. Behaviour changes: net-of-sells values and raw basis (both by construction of the shared core).

- [ ] **Step 1: Replace the file contents**

Overwrite `src/app/api/holdings/backfill/route.ts` with:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { fetchHoldings, fetchSnapshots } from "@/lib/supabase/data";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { NON_GROUPABLE } from "@/lib/positions";
import { sgtDate } from "@/lib/dates";
import { dateRange, buildSnapshotRows } from "@/lib/snapshots/build";
import { fetchWindowPrices, fetchWindowFx } from "@/lib/snapshots/fetch";

export const maxDuration = 60;

export async function POST() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const limited = await enforceRateLimit("backfill", 2, 60, { failClosed: true });
  if (limited) return limited;

  const holdings = await fetchHoldings(user.id);
  if (holdings.length === 0)
    return NextResponse.json({ inserted: 0, skipped: 0 });

  const today = sgtDate();
  const from = holdings.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    holdings[0].buyDate,
  );
  const dates = dateRange(from, today);

  const existingSnapshots = await fetchSnapshots(user.id);
  const existingDates = new Set(existingSnapshots.map((s) => s.recordedDate));

  const tickers = [
    ...new Set(holdings.filter((h) => !NON_GROUPABLE.has(h.ticker)).map((h) => h.ticker)),
  ];
  const tickerCurrency = Object.fromEntries(
    holdings
      .filter((h) => !NON_GROUPABLE.has(h.ticker))
      .map((h) => [h.ticker, h.currency]),
  );
  const currencies = [
    ...new Set(holdings.map((h) => h.currency).filter((c) => c !== "SGD")),
  ];

  const providers = await getProviderFlags();
  const [rawPrices, rawFx] = await Promise.all([
    fetchWindowPrices({ tickers, tickerCurrency, from, to: today, providers }),
    fetchWindowFx({ currencies, from, to: today, providers }),
  ]);

  const priceFallback = (ticker: string) =>
    holdings.find((h) => h.ticker === ticker)?.buyPrice ?? 0;
  const fxFallback = (ccy: string) =>
    holdings.find((h) => h.currency === ccy)?.buyFxRate ?? 1;

  const rows = buildSnapshotRows({
    userId: user.id,
    lots: holdings,
    dates,
    rawPrices,
    rawFx,
    priceFallback,
    fxFallback,
  });

  if (rows.length === 0)
    return NextResponse.json({ inserted: 0, skipped: existingDates.size });

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_snapshots")
    .upsert(rows, { onConflict: "user_id,recorded_date" });
  if (error) {
    console.error("[backfill]", error.message);
    return NextResponse.json({ error: "Failed to write snapshots" }, { status: 500 });
  }

  return NextResponse.json({
    inserted: rows.length,
    skipped: existingDates.size,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build (route compiles under Next.js)**

Run: `npm run build`
Expected: build succeeds; `/api/holdings/backfill` listed among routes with no errors.

- [ ] **Step 4: Smoke-test the route**

Start `npm run dev`, log in, then trigger the backfill (the existing UI button, or `curl -X POST http://localhost:3000/api/holdings/backfill` with an authed session cookie). Expected JSON `{ inserted: <n>, skipped: <m> }`. Spot-check `portfolio_snapshots` for a date after a recorded **sell**: `value_sgd` should reflect the reduced quantity, not the pre-sale total.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/holdings/backfill/route.ts
git commit -m "refactor(backfill): rebuild on shared net-position core, net of sells"
```

---

### Task 7: Query active user ids (`fetchActiveUserIds`)

**Files:**
- Modify: `src/lib/supabase/data.ts` (add a new exported function; place near the other admin-client queries)

**Interfaces:**
- Consumes: the service-role admin client (`createAdminClient` — confirm the exact export name in `src/lib/supabase/admin.ts` and match it).
- Produces: `fetchActiveUserIds(): Promise<string[]>` — distinct `user_id` across all `lots`.
- Consumed by: Task 8 (cron route).

- [ ] **Step 1: Confirm the admin client export**

Read `src/lib/supabase/admin.ts` and note the exported factory name (e.g. `createAdminClient`). Use that exact name below.

- [ ] **Step 2: Add the function**

Append to `src/lib/supabase/data.ts` (adjust the admin-client import/call to the real name):
```ts
// Distinct user ids that hold at least one lot — the cron's work-list. Uses the
// admin client so RLS doesn't hide other users' lots. Paged past the 1000-row cap.
export async function fetchActiveUserIds(): Promise<string[]> {
  const admin = createAdminClient();
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let fromRow = 0; ; fromRow += PAGE) {
    const { data, error } = await admin
      .from("lots")
      .select("user_id")
      .order("user_id", { ascending: true })
      .range(fromRow, fromRow + PAGE - 1);
    if (error) {
      console.error("[fetchActiveUserIds]", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.user_id as string);
    if (data.length < PAGE) break;
  }
  return [...ids];
}
```
If `src/lib/supabase/data.ts` doesn't already import the admin factory, add the import at the top (matching the name from Step 1).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/data.ts
git commit -m "feat(data): add fetchActiveUserIds for scheduled snapshotting"
```

---

### Task 8: Scheduled snapshot route (`/api/internal/snapshot-all`)

**Files:**
- Create: `src/app/api/internal/snapshot-all/route.ts`
- Create: `src/lib/snapshots/cron-auth.ts`
- Create: `src/lib/snapshots/cron-auth.test.ts`
- Create: `vercel.json`
- Modify: `.env.example` (add `CRON_SECRET`) — create it if absent

**Interfaces:**
- Consumes: `fetchActiveUserIds` (Task 7); `fetchHoldings`, `fetchSnapshots` (existing, per-user); `getProviderFlags`; `fetchWindowPrices`, `fetchWindowFx` (Task 5); `dateRange`, `buildSnapshotRows` (Task 4); `sgtDate` (Task 1); the admin client (Task 7's factory).
- Produces: `authorizeCron(req: Request, secret: string | undefined): boolean`; `POST` handler returning `{ users: number; rows: number }`.

- [ ] **Step 1: Write the failing auth test**

Create `src/lib/snapshots/cron-auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { authorizeCron } from "./cron-auth";

function req(headers: Record<string, string>): Request {
  return new Request("http://x/api/internal/snapshot-all", { headers });
}

describe("authorizeCron", () => {
  const secret = "s3cret";

  it("rejects when no secret is configured", () => {
    expect(authorizeCron(req({ "x-cron-secret": "s3cret" }), undefined)).toBe(false);
    expect(authorizeCron(req({ "x-cron-secret": "s3cret" }), "")).toBe(false);
  });

  it("accepts the x-cron-secret header", () => {
    expect(authorizeCron(req({ "x-cron-secret": secret }), secret)).toBe(true);
  });

  it("accepts the Vercel Authorization: Bearer form", () => {
    expect(authorizeCron(req({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
  });

  it("rejects a wrong or missing secret", () => {
    expect(authorizeCron(req({ "x-cron-secret": "nope" }), secret)).toBe(false);
    expect(authorizeCron(req({}), secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/snapshots/cron-auth.test.ts`
Expected: FAIL — `Failed to resolve import "./cron-auth"`.

- [ ] **Step 3: Write the auth helper**

Create `src/lib/snapshots/cron-auth.ts`:
```ts
// Constant-time compare to avoid leaking secret length/content via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Accepts the secret as `x-cron-secret` (arbitrary callers) or as
// `Authorization: Bearer <secret>` (the form Vercel Cron injects).
export function authorizeCron(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get("x-cron-secret");
  if (header && safeEqual(header, secret)) return true;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer !== "" && safeEqual(bearer, secret);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/snapshots/cron-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the route**

Create `src/app/api/internal/snapshot-all/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin"; // match Task 7's name
import {
  fetchActiveUserIds,
  fetchHoldings,
  fetchSnapshots,
} from "@/lib/supabase/data";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { NON_GROUPABLE } from "@/lib/positions";
import { sgtDate } from "@/lib/dates";
import { dateRange, buildSnapshotRows } from "@/lib/snapshots/build";
import { fetchWindowPrices, fetchWindowFx } from "@/lib/snapshots/fetch";
import { authorizeCron } from "@/lib/snapshots/cron-auth";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = sgtDate();
  const userIds = await fetchActiveUserIds();
  if (userIds.length === 0) return NextResponse.json({ users: 0, rows: 0 });

  // Per user: holdings + their missing-day window start.
  const perUser = await Promise.all(
    userIds.map(async (id) => {
      const holdings = await fetchHoldings(id);
      if (holdings.length === 0) return null;
      const snaps = await fetchSnapshots(id);
      const earliest = holdings.reduce(
        (min, h) => (h.buyDate < min ? h.buyDate : min),
        holdings[0].buyDate,
      );
      const lastSnap = snaps.length ? snaps[snaps.length - 1].recordedDate : null;
      const start = lastSnap ? nextDay(lastSnap) : earliest;
      return { id, holdings, start: start > today ? null : start };
    }),
  );
  const active = perUser.filter(
    (u): u is NonNullable<typeof u> => u !== null && u.start !== null,
  );
  if (active.length === 0) return NextResponse.json({ users: 0, rows: 0 });

  // Global window = earliest per-user start … today; fetch each instrument once.
  const globalFrom = active.reduce(
    (min, u) => (u.start! < min ? u.start! : min),
    today,
  );
  const allHoldings = active.flatMap((u) => u.holdings);
  const tickers = [
    ...new Set(
      allHoldings.filter((h) => !NON_GROUPABLE.has(h.ticker)).map((h) => h.ticker),
    ),
  ];
  const tickerCurrency = Object.fromEntries(
    allHoldings
      .filter((h) => !NON_GROUPABLE.has(h.ticker))
      .map((h) => [h.ticker, h.currency]),
  );
  const currencies = [
    ...new Set(allHoldings.map((h) => h.currency).filter((c) => c !== "SGD")),
  ];

  const providers = await getProviderFlags();
  const [rawPrices, rawFx] = await Promise.all([
    fetchWindowPrices({ tickers, tickerCurrency, from: globalFrom, to: today, providers }),
    fetchWindowFx({ currencies, from: globalFrom, to: today, providers }),
  ]);

  const admin = createAdminClient();
  let totalRows = 0;
  for (const u of active) {
    const dates = dateRange(u.start!, today);
    const priceFallback = (ticker: string) =>
      u.holdings.find((h) => h.ticker === ticker)?.buyPrice ?? 0;
    const fxFallback = (ccy: string) =>
      u.holdings.find((h) => h.currency === ccy)?.buyFxRate ?? 1;
    const rows = buildSnapshotRows({
      userId: u.id,
      lots: u.holdings,
      dates,
      rawPrices,
      rawFx,
      priceFallback,
      fxFallback,
    });
    if (rows.length === 0) continue;
    const { error } = await admin
      .from("portfolio_snapshots")
      .upsert(rows, { onConflict: "user_id,recorded_date" });
    if (error) {
      console.error("[snapshot-all]", u.id, error.message);
      continue;
    }
    totalRows += rows.length;
  }

  return NextResponse.json({ users: active.length, rows: totalRows });
}

// Next calendar day for a YYYY-MM-DD string.
function nextDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 6: Add the example Vercel trigger**

Create `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/internal/snapshot-all",
      "schedule": "0 21 * * *"
    }
  ]
}
```

- [ ] **Step 7: Document the env var**

Add to `.env.example` (create the file if it doesn't exist):
```
# Shared secret for the scheduled snapshot route (/api/internal/snapshot-all).
# Vercel Cron injects it as `Authorization: Bearer $CRON_SECRET`; other
# schedulers send it as the `x-cron-secret` header.
CRON_SECRET=
```

- [ ] **Step 8: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `/api/internal/snapshot-all` appears in the route list.

- [ ] **Step 9: Smoke-test auth + a run**

With `CRON_SECRET=testsecret` in `.env.local` and `npm run dev`:
- Unauthorized: `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/internal/snapshot-all` → `401`.
- Authorized: `curl -X POST -H "x-cron-secret: testsecret" http://localhost:3000/api/internal/snapshot-all` → `{"users":<n>,"rows":<m>}`. Confirm `portfolio_snapshots` gained today's row for a test user, and that a deliberately deleted mid-history day is refilled on a second run.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/internal/snapshot-all/route.ts src/lib/snapshots/cron-auth.ts src/lib/snapshots/cron-auth.test.ts vercel.json .env.example
git commit -m "feat(cron): add secret-guarded daily snapshot route with missing-day backfill"
```

---

## Self-Review

**Spec coverage:**
- §Problem 1 (sold positions in rebuild) → Task 2 + Task 6. ✅
- §Problem 2 (live snapshot double-count) → Task 3. ✅
- §Problem 3 (inconsistent basis) → Task 5 (raw `close`) + Global Constraint. ✅
- §Problem 4 (no auto accrual) → Task 8 (cron). ✅
- §`history.ts` module → Task 2. ✅
- §Shared build core → Task 4; §fetch relocation → Task 5. ✅
- §Backfill refactor → Task 6. ✅
- §Live snapshot fix → Task 3. ✅
- §Snapshot dating SGT → Task 1 + used in Tasks 3, 6, 8. ✅
- §Scheduled route (auth: x-cron-secret OR Bearer; admin client; missing-days; global window; cold-start bound via maxDuration) → Task 8. ✅
- §`fetchActiveUserIds` → Task 7. ✅
- §Testing (buy/partial-sell, fully-closed, back-dated via netUnitsAsOf, multi-ccy FX, untickered) → Task 2 tests; fill-forward → Task 4 tests. ✅
- §env `CRON_SECRET` + `vercel.json` → Task 8. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Two route tasks (6, 8) use build/smoke verification instead of unit tests because their logic is network/DB I/O — the testable cores (history, build, cron-auth) are unit-tested.

**Type consistency:** `LotLite`/`SnapshotAgg` (Task 2) consumed unchanged by Task 4; `SnapshotRowOut` (Task 4) matches the DB column names used in the upserts (Tasks 6, 8); `ProviderFlags`/`fetchWindowPrices`/`fetchWindowFx` (Task 5) signatures match their call sites (Tasks 6, 8); `sgtDate`/`isSnapshotStaleForDay` (Task 1) match Task 3 and the companion plan; `fetchActiveUserIds` (Task 7) returns `string[]` consumed by Task 8. `createAdminClient` name must be confirmed against `admin.ts` in Task 7 Step 1 and reused verbatim in Task 8.

**Open confirmation (not a blocker):** the admin-client factory export name in `src/lib/supabase/admin.ts` is confirmed in Task 7 Step 1 before use.
