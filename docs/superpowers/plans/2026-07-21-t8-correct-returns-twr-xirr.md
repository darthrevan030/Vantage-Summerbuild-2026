# T8 — Correct Returns: TWR + MWR/XIRR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cash-flow-naive return analytics (`computePortfolioAnalytics`) with flow-adjusted TWR, portfolio/per-broker/per-source XIRR, and correctly-adjusted Sharpe/volatility/drawdown/best-worst-day — using T7's `cash_transactions` ledger as the source of dated external flows.

**Architecture:** A new pure module `src/lib/returns.ts` provides the algorithmic core (flow-adjusted daily returns, TWR linking, annualisation, XIRR via Newton-Raphson/bisection, and dated-flow construction per scope). `computePortfolioAnalytics` is extended (not replaced) to accept `cashTransactions`/`holdings` alongside `snapshots`, overlay a running cash balance onto the holdings-only snapshot series (redefining "portfolio value" as total net worth), and derive every metric from one shared flow-adjusted returns array. The `/api/portfolio/analytics` route fetches the two new inputs; the Charts page relabels its CAGR card to TWR and adds an XIRR card.

**Tech Stack:** TypeScript strict, Vitest (already set up).

## Global Constraints

- TypeScript strict mode — `npx tsc --noEmit` clean repo-wide after each task.
- No comments except where a hidden constraint or non-obvious invariant would otherwise be lost.
- **Zero-flow equivalence is load-bearing and must hold exactly:** every existing test in `describe("computePortfolioAnalytics", ...)` (`src/lib/portfolio.test.ts`) calls `computePortfolioAnalytics(snapshots)` with no 2nd/3rd argument. With `cashTransactions`/`holdings` defaulting to `[]`, the new flow-adjusted math must degenerate to bit-identical results to today's naive calculation — **none of those existing test assertions should need to change.** This is not a coincidence to verify after the fact; it is a designed mathematical property (empty flows ⇒ the flow-adjusted return per sub-period reduces algebraically to the naive `value[i]/value[i-1]-1`, and TWR/drawdown/best-worst-day are all scale-invariant/ratio-based, so building them from a flow-adjusted series that happens to equal the raw series in the zero-flow case reproduces the exact same numbers). If a task's changes break any pre-existing assertion, that is a bug in the new code, not a spec drift to "fix" by changing the test.
- **Sign conventions (load-bearing, do not conflate):**
  - `cash_transactions.amount` (T7's own convention): positive = cash into the account, negative = cash out.
  - XIRR flow convention (standard, and what `computeXIRR` expects as input): a deposit is a *negative* flow (money leaving the investor's pocket), a withdrawal/transfer-in is *positive* (money returned to the investor), and the final ending value is a *positive* flow. Building XIRR flows from `cash_transactions` therefore requires **flipping the sign** relative to T7's own convention — `buildXirrFlows` is the one place this flip happens; nowhere else should re-flip or double-flip it.
- All monetary values converted to SGD via `amount * fxRate` (the transaction's own historical rate), matching the exact convention already established by T7's `computeNetContributions`.

---

### Task 1: Pure return/XIRR math (`src/lib/returns.ts`, TDD)

**Files:**
- Create: `src/lib/returns.ts`
- Create: `src/lib/returns.test.ts`

**Interfaces:**
- Consumes: `CashTransaction` (`@/types/cash`, from T7); `SnapshotRow` (`@/lib/supabase/data`, existing).
- Produces:
  - `computeTotalValueSeries(snapshots: SnapshotRow[], cashTransactions: CashTransaction[]): { date: string; value: number; cost: number }[]`
  - `computeFlowAdjustedReturns(series: { date: string; value: number }[], flows: { date: string; amountSgd: number }[]): { date: string; r: number }[]`
  - `computeTWR(returns: number[]): number`
  - `annualise(cumulativeReturn: number, years: number): number`
  - `computeXIRR(flows: { date: string; amountSgd: number }[]): number`
  - `buildXirrFlows(cashTransactions: CashTransaction[], endingValueSgd: number, endingDate: string, scope?: { broker?: string; source?: string }): { date: string; amountSgd: number }[]`
- Consumed by: Task 2 (`portfolio.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/returns.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  computeTotalValueSeries,
  computeFlowAdjustedReturns,
  computeTWR,
  annualise,
  computeXIRR,
  buildXirrFlows,
} from "./returns";
import type { CashTransaction } from "@/types/cash";
import type { SnapshotRow } from "@/lib/supabase/data";

function makeSnapshot(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    recordedDate: "2026-01-01",
    valueSgd: 1000,
    costSgd: 900,
    fxImpactSgd: 0,
    fxByCurrency: {},
    ...overrides,
  };
}

function makeTx(overrides: Partial<CashTransaction> = {}): CashTransaction {
  return {
    id: "t1",
    lotId: null,
    transferGroupId: null,
    date: "2026-01-01",
    type: "deposit",
    currency: "SGD",
    amount: 1000,
    fxRate: 1,
    broker: "",
    source: "",
    note: null,
    ...overrides,
  };
}

describe("computeTotalValueSeries", () => {
  it("overlays a running cash balance onto the holdings-only snapshot series", () => {
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 1000, costSgd: 900 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 1100, costSgd: 900 }),
    ];
    const cashTransactions = [
      makeTx({ date: "2026-01-01", type: "deposit", amount: 200, fxRate: 1 }),
    ];
    const series = computeTotalValueSeries(snapshots, cashTransactions);
    expect(series).toEqual([
      { date: "2026-01-01", value: 1200, cost: 900 },
      { date: "2026-01-02", value: 1300, cost: 900 },
    ]);
  });

  it("returns the holdings-only values unchanged when there are no cash transactions", () => {
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 1000, costSgd: 900 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 1100, costSgd: 900 }),
    ];
    expect(computeTotalValueSeries(snapshots, [])).toEqual([
      { date: "2026-01-01", value: 1000, cost: 900 },
      { date: "2026-01-02", value: 1100, cost: 900 },
    ]);
  });

  it("dedupes multiple snapshots on the same date, keeping the last one", () => {
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 100 }),
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 999 }),
    ];
    const series = computeTotalValueSeries(snapshots, []);
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(999);
  });
});

describe("computeFlowAdjustedReturns", () => {
  it("matches the naive value[i]/value[i-1]-1 return when there are no flows", () => {
    const series = [
      { date: "2026-01-01", value: 1000 },
      { date: "2026-01-02", value: 1100 },
      { date: "2026-01-03", value: 990 },
    ];
    const returns = computeFlowAdjustedReturns(series, []);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toEqual({ date: "2026-01-02", r: 0.1 });
    expect(returns[1]).toEqual({ date: "2026-01-03", r: -0.1 });
  });

  it("backs out a same-day deposit before computing the return", () => {
    // 1000 -> 1600, of which 500 is a deposit; the "real" return is 10%,
    // not the naive 60%.
    const series = [
      { date: "2026-01-01", value: 1000 },
      { date: "2026-01-02", value: 1600 },
    ];
    const flows = [{ date: "2026-01-02", amountSgd: 500 }];
    const returns = computeFlowAdjustedReturns(series, flows);
    expect(returns[0].r).toBeCloseTo(0.1, 9);
  });
});

describe("computeTWR", () => {
  it("geometrically links a returns array", () => {
    expect(computeTWR([0.1, -0.1])).toBeCloseTo(-0.01, 9);
  });

  it("returns 0 for an empty returns array", () => {
    expect(computeTWR([])).toBe(0);
  });
});

describe("annualise", () => {
  it("annualises a cumulative return over a span of years", () => {
    expect(annualise(0.21, 2)).toBeCloseTo(10, 9);
  });

  it("returns 0 for a non-positive years span", () => {
    expect(annualise(0.21, 0)).toBe(0);
  });
});

describe("computeXIRR", () => {
  it("solves a simple single-period case exactly", () => {
    // Invest 1000, get back 1100 exactly one year later -> 10% XIRR.
    const flows = [
      { date: "2026-01-01", amountSgd: -1000 },
      { date: "2027-01-01", amountSgd: 1100 },
    ];
    expect(computeXIRR(flows)).toBeCloseTo(0.1, 4);
  });

  it("converges to a rate whose NPV is ~0 for a multi-flow case", () => {
    const flows = [
      { date: "2026-01-01", amountSgd: -1000 },
      { date: "2026-07-01", amountSgd: -500 },
      { date: "2027-01-01", amountSgd: 1700 },
    ];
    const r = computeXIRR(flows);
    const npv = flows.reduce((sum, f) => {
      const years =
        (new Date(f.date).getTime() - new Date(flows[0].date).getTime()) /
        (365 * 24 * 3600 * 1000);
      return sum + f.amountSgd / (1 + r) ** years;
    }, 0);
    expect(npv).toBeCloseTo(0, 2);
  });

  it("returns 0 for fewer than 2 flows", () => {
    expect(computeXIRR([{ date: "2026-01-01", amountSgd: 1000 }])).toBe(0);
    expect(computeXIRR([])).toBe(0);
  });
});

describe("buildXirrFlows", () => {
  const deposit = makeTx({ id: "d1", type: "deposit", date: "2026-01-01", amount: 1000, fxRate: 1 });
  const withdrawal = makeTx({ id: "w1", type: "withdrawal", date: "2026-02-01", amount: -200, fxRate: 1 });
  const buy = makeTx({ id: "b1", type: "buy", date: "2026-01-15", amount: -500, fxRate: 1 });
  const transferOut = makeTx({
    id: "tr1", type: "transfer", date: "2026-01-20", amount: -300, fxRate: 1, broker: "IBKR",
  });
  const transferIn = makeTx({
    id: "tr2", type: "transfer", date: "2026-01-20", amount: 300, fxRate: 1, broker: "Tiger",
  });

  it("portfolio-wide: sign-flips deposit/withdrawal, excludes buy/sell/transfer", () => {
    const flows = buildXirrFlows(
      [deposit, withdrawal, buy, transferOut, transferIn],
      2000,
      "2026-03-01",
    );
    expect(flows).toEqual([
      { date: "2026-01-01", amountSgd: -1000 },
      { date: "2026-02-01", amountSgd: 200 },
      { date: "2026-03-01", amountSgd: 2000 },
    ]);
  });

  it("per-broker: includes transfer legs for that broker, sign-flipped", () => {
    const flows = buildXirrFlows(
      [deposit, withdrawal, buy, transferOut, transferIn],
      500,
      "2026-03-01",
      { broker: "IBKR" },
    );
    // deposit/withdrawal have no broker set on these fixtures (default ""),
    // so only the IBKR transfer leg matches.
    expect(flows).toEqual([
      { date: "2026-01-20", amountSgd: 300 },
      { date: "2026-03-01", amountSgd: 500 },
    ]);
  });

  it("per-source: filters deposit/withdrawal by source, transfers never match (no source tag)", () => {
    const cpfDeposit = makeTx({ id: "d2", type: "deposit", date: "2026-01-05", amount: 400, fxRate: 1, source: "CPF" });
    const flows = buildXirrFlows(
      [deposit, cpfDeposit, transferOut, transferIn],
      1000,
      "2026-03-01",
      { source: "CPF" },
    );
    expect(flows).toEqual([
      { date: "2026-01-05", amountSgd: -400 },
      { date: "2026-03-01", amountSgd: 1000 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/returns.test.ts`
Expected: FAIL — `Cannot find module './returns'`.

- [ ] **Step 3: Implement**

Create `src/lib/returns.ts`:
```ts
import type { SnapshotRow } from "@/lib/supabase/data";
import type { CashTransaction } from "@/types/cash";

const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

export function computeTotalValueSeries(
  snapshots: SnapshotRow[],
  cashTransactions: CashTransaction[],
): { date: string; value: number; cost: number }[] {
  const byDate = new Map<string, SnapshotRow>();
  for (const s of snapshots) byDate.set(s.recordedDate, s);

  const sortedTx = [...cashTransactions].sort((a, b) => a.date.localeCompare(b.date));

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => {
      const cashBalance = sortedTx
        .filter((t) => t.date <= date)
        .reduce((sum, t) => sum + t.amount * t.fxRate, 0);
      return {
        date,
        value: Math.round(s.valueSgd + cashBalance),
        cost: Math.round(s.costSgd),
      };
    });
}

// Splits the value series into consecutive-day sub-periods, backing out any
// net external flow on the LATER day of each sub-period before computing the
// return — a deposit/withdrawal on that day is capital moving, not gain/loss.
// With no flows, r reduces exactly to the naive value[i]/value[i-1]-1.
export function computeFlowAdjustedReturns(
  series: { date: string; value: number }[],
  flows: { date: string; amountSgd: number }[],
): { date: string; r: number }[] {
  const flowsByDate = new Map<string, number>();
  for (const f of flows) {
    flowsByDate.set(f.date, (flowsByDate.get(f.date) ?? 0) + f.amountSgd);
  }
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    if (prev <= 0) continue;
    const flow = flowsByDate.get(series[i].date) ?? 0;
    out.push({ date: series[i].date, r: (series[i].value - flow) / prev - 1 });
  }
  return out;
}

// Geometric link of a sub-period returns array. Telescopes to the naive
// (last/first - 1) ratio when every r_i is itself the naive per-period return.
export function computeTWR(returns: number[]): number {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

export function annualise(cumulativeReturn: number, years: number): number {
  if (years <= 0) return 0;
  return ((1 + cumulativeReturn) ** (1 / years) - 1) * 100;
}

const XIRR_TOLERANCE = 1e-7;
const XIRR_MAX_ITER = 100;

function xirrNpv(rate: number, flows: { date: string; amountSgd: number }[], t0: number): number {
  return flows.reduce((sum, f) => {
    const years = (new Date(f.date).getTime() - t0) / MS_PER_YEAR;
    return sum + f.amountSgd / (1 + rate) ** years;
  }, 0);
}

function xirrDerivative(rate: number, flows: { date: string; amountSgd: number }[], t0: number): number {
  return flows.reduce((sum, f) => {
    const years = (new Date(f.date).getTime() - t0) / MS_PER_YEAR;
    if (years === 0) return sum;
    return sum - (years * f.amountSgd) / (1 + rate) ** (years + 1);
  }, 0);
}

function xirrBisection(flows: { date: string; amountSgd: number }[], t0: number): number {
  let lo = -0.9999;
  let hi = 10;
  let npvLo = xirrNpv(lo, flows, t0);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = xirrNpv(mid, flows, t0);
    if (Math.abs(npvMid) < XIRR_TOLERANCE) return mid;
    if ((npvMid > 0) === (npvLo > 0)) {
      lo = mid;
      npvLo = npvMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// Newton-Raphson with a bisection fallback over dated cash flows (must already
// be in the caller's XIRR sign convention: outflows negative, inflows
// positive — see buildXirrFlows). Returns 0 for fewer than 2 flows.
export function computeXIRR(flows: { date: string; amountSgd: number }[]): number {
  if (flows.length < 2) return 0;
  const t0 = new Date(flows[0].date).getTime();

  let rate = 0.1;
  for (let i = 0; i < XIRR_MAX_ITER; i++) {
    const npv = xirrNpv(rate, flows, t0);
    if (Math.abs(npv) < XIRR_TOLERANCE) return rate;
    const deriv = xirrDerivative(rate, flows, t0);
    if (Math.abs(deriv) < 1e-12) break;
    const next = rate - npv / deriv;
    if (!Number.isFinite(next) || next <= -1) break;
    rate = next;
  }
  return xirrBisection(flows, t0);
}

// Converts T7's cash_transactions (stored "positive = cash into the account")
// into standard XIRR sign convention (deposit = negative outflow from the
// investor, withdrawal/transfer-in = positive inflow), scoped by broker or
// fund source, and appends the final ending-value flow.
export function buildXirrFlows(
  cashTransactions: CashTransaction[],
  endingValueSgd: number,
  endingDate: string,
  scope?: { broker?: string; source?: string },
): { date: string; amountSgd: number }[] {
  let relevant: CashTransaction[];
  if (scope?.broker !== undefined) {
    relevant = cashTransactions.filter(
      (t) => t.broker === scope.broker && (t.type === "deposit" || t.type === "withdrawal" || t.type === "transfer"),
    );
  } else if (scope?.source !== undefined) {
    relevant = cashTransactions.filter(
      (t) => t.source === scope.source && (t.type === "deposit" || t.type === "withdrawal"),
    );
  } else {
    relevant = cashTransactions.filter((t) => t.type === "deposit" || t.type === "withdrawal");
  }

  const flows = relevant
    .map((t) => ({ date: t.date, amountSgd: -(t.amount * t.fxRate) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  flows.push({ date: endingDate, amountSgd: endingValueSgd });
  return flows;
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run src/lib/returns.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `returns.ts`/`returns.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/returns.ts src/lib/returns.test.ts
git commit -m "feat(returns): add flow-adjusted TWR and XIRR pure math"
```

---

### Task 2: `portfolio.ts` integration — flow-adjusted analytics + per-scope XIRR

**Files:**
- Modify: `src/lib/portfolio.ts`
- Modify: `src/types/portfolio.ts`
- Modify: `src/lib/portfolio.test.ts`

**Interfaces:**
- Consumes: everything from Task 1 (`computeTotalValueSeries`, `computeFlowAdjustedReturns`, `computeTWR`, `annualise`, `computeXIRR`, `buildXirrFlows`).
- Produces: `computePortfolioAnalytics(snapshots, cashTransactions?, holdings?): PortfolioAnalytics` (2 new optional params, default `[]`); `PortfolioAnalytics` gains `xirr`, `xirrByBroker`, `xirrBySource`; `cagr` field repurposed to hold annualised TWR (same field name, no signature/shape break for existing consumers).
- Consumed by: Task 3 (API route).

- [ ] **Step 1: Extend `PortfolioAnalytics`**

Edit `src/types/portfolio.ts` — replace the `PortfolioAnalytics` interface:
```ts
export interface PortfolioAnalytics {
  cagr: number;
  actualSharpe: number;
  annualisedVol: number;
  maxDrawdown: number;
  maxDrawdownDate: string;
  bestDayReturn: number;
  bestDayDate: string;
  worstDayReturn: number;
  worstDayDate: string;
  days: number;
  series: { date: string; value: number; cost: number }[];
  xirr: number;
  xirrByBroker: { broker: string; xirr: number }[];
  xirrBySource: { source: string; xirr: number }[];
}
```

- [ ] **Step 2: Update imports in `portfolio.ts`**

Edit `src/lib/portfolio.ts` — add to the existing import block:
```ts
import type { CashTransaction } from "@/types/cash";
import {
  computeTotalValueSeries,
  computeFlowAdjustedReturns,
  computeTWR,
  annualise,
  computeXIRR,
  buildXirrFlows,
} from "./returns";
```

- [ ] **Step 3: Update `EMPTY_ANALYTICS`**

Edit `src/lib/portfolio.ts` — replace `EMPTY_ANALYTICS`:
```ts
const EMPTY_ANALYTICS: PortfolioAnalytics = {
  cagr: 0,
  actualSharpe: 0,
  annualisedVol: 0,
  maxDrawdown: 0,
  maxDrawdownDate: "",
  bestDayReturn: 0,
  bestDayDate: "",
  worstDayReturn: 0,
  worstDayDate: "",
  days: 0,
  series: [],
  xirr: 0,
  xirrByBroker: [],
  xirrBySource: [],
};
```

- [ ] **Step 4: Replace `computePortfolioAnalytics`**

Edit `src/lib/portfolio.ts` — replace the whole function (keep `computeSharpeRatio`/`computeCAGR`/`stddev`/`TRADING_DAYS` untouched above it — `computeCAGR` stays exported as-is for any other caller, it's simply no longer called from inside this function):
```ts
/** Derives TWR-based CAGR, Sharpe, annualised volatility, max drawdown,
 *  best/worst single-day returns, and XIRR (portfolio-wide, per-broker,
 *  per-source) from the portfolio value snapshots plus the cash-transactions
 *  ledger. All percentages are returned in percentage points (e.g. 12.3 for
 *  12.3%). With no cash transactions and no holdings supplied, this reduces
 *  exactly to the pre-T8 naive calculation. */
export function computePortfolioAnalytics(
  snapshots: SnapshotRow[],
  cashTransactions: CashTransaction[] = [],
  holdings: HoldingRow[] = [],
): PortfolioAnalytics {
  const rawSeries = computeTotalValueSeries(snapshots, cashTransactions).filter(
    (p) => p.value > 0,
  );

  if (rawSeries.length < 2) return { ...EMPTY_ANALYTICS, series: rawSeries };

  const depositWithdrawalFlows = cashTransactions
    .filter((t) => t.type === "deposit" || t.type === "withdrawal")
    .map((t) => ({ date: t.date, amountSgd: t.amount * t.fxRate }));

  const adjusted = computeFlowAdjustedReturns(rawSeries, depositWithdrawalFlows);
  const returns = adjusted.map((d) => d.r);

  const actualSharpe = computeSharpeRatio(returns);
  const annualisedVol = stddev(returns) * Math.sqrt(TRADING_DAYS) * 100;

  const first = rawSeries[0];
  const last = rawSeries[rawSeries.length - 1];
  const msPerYear = 365.25 * 24 * 3600 * 1000;
  const years =
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / msPerYear;
  const twr = computeTWR(returns);
  const cagr = years > 0 ? annualise(twr, years) : 0;

  // Synthetic "growth of $1" index built from the same flow-adjusted returns,
  // so a deposit/withdrawal day can't masquerade as an investment gain/loss in
  // drawdown or best/worst-day. Scale-invariant, so with no flows this yields
  // exactly the same drawdown/best/worst numbers as the raw value series did.
  const index: { date: string; value: number }[] = [{ date: first.date, value: 1 }];
  for (const d of adjusted) {
    index.push({ date: d.date, value: index[index.length - 1].value * (1 + d.r) });
  }

  let peak = index[0].value;
  let maxDrawdown = 0;
  let maxDrawdownDate = "";
  for (const p of index) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? (p.value - peak) / peak : 0;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownDate = p.date;
    }
  }

  let best = adjusted[0];
  let worst = adjusted[0];
  for (const d of adjusted) {
    if (d.r > best.r) best = d;
    if (d.r < worst.r) worst = d;
  }

  const endingValueSgd = last.value;
  const xirr = computeXIRR(buildXirrFlows(cashTransactions, endingValueSgd, last.date));

  const brokers = [...new Set(holdings.map((h) => h.broker).filter(Boolean))];
  const xirrByBroker = brokers.map((broker) => {
    const brokerHoldingsValue = toNetPositions(
      holdings.filter((h) => h.broker === broker),
    ).reduce((s, h) => s + h.valueSGD, 0);
    const brokerCashSgd = cashTransactions
      .filter((t) => t.broker === broker)
      .reduce((s, t) => s + t.amount * t.fxRate, 0);
    const flows = buildXirrFlows(
      cashTransactions,
      brokerHoldingsValue + brokerCashSgd,
      last.date,
      { broker },
    );
    return { broker, xirr: computeXIRR(flows) };
  });

  const sources = [...new Set(holdings.map((h) => h.source).filter(Boolean))];
  const xirrBySource = sources.map((source) => {
    const sourceHoldingsValue = toNetPositions(
      holdings.filter((h) => h.source === source),
    ).reduce((s, h) => s + h.valueSGD, 0);
    const sourceCashSgd = cashTransactions
      .filter((t) => t.source === source)
      .reduce((s, t) => s + t.amount * t.fxRate, 0);
    const flows = buildXirrFlows(
      cashTransactions,
      sourceHoldingsValue + sourceCashSgd,
      last.date,
      { source },
    );
    return { source, xirr: computeXIRR(flows) };
  });

  return {
    cagr,
    actualSharpe,
    annualisedVol,
    maxDrawdown: maxDrawdown * 100,
    maxDrawdownDate,
    bestDayReturn: best.r * 100,
    bestDayDate: best.date,
    worstDayReturn: worst.r * 100,
    worstDayDate: worst.date,
    days: rawSeries.length,
    series: rawSeries,
    xirr,
    xirrByBroker,
    xirrBySource,
  };
}
```

- [ ] **Step 5: Verify existing tests still pass unchanged**

Run: `npx vitest run src/lib/portfolio.test.ts`
Expected: every pre-existing `describe("computePortfolioAnalytics", ...)` assertion PASSES with NO changes to the test file yet — this is the zero-flow-equivalence property from Global Constraints, now proven by the actual suite. If ANY existing assertion fails, stop and fix `portfolio.ts` (do not edit the test to match) — the bug is in the new implementation, since the global constraint guarantees these should be unaffected.

- [ ] **Step 6: Add new flow-adjusted test coverage to `portfolio.test.ts`**

Edit `src/lib/portfolio.test.ts` — add `import type { CashTransaction } from "@/types/cash";` to the imports, add a `makeCashTx` fixture helper near the other fixture helpers:
```ts
function makeCashTx(overrides: Partial<CashTransaction> = {}): CashTransaction {
  return {
    id: "t1",
    lotId: null,
    transferGroupId: null,
    date: "2026-01-01",
    type: "deposit",
    currency: "SGD",
    amount: 1000,
    fxRate: 1,
    broker: "",
    source: "",
    note: null,
    ...overrides,
  };
}
```

Add new test cases inside (or right after) the existing `describe("computePortfolioAnalytics", ...)` block:
```ts
  it("backs a deposit out of the return so it isn't misread as a gain", () => {
    // snapshots are HOLDINGS-ONLY value (matching recordSnapshot's real
    // convention) — computeTotalValueSeries overlays cash ON TOP of these.
    // Holdings grow organically 1000 -> 1100 (+10%, no new investment); a
    // separate 500 deposit lands in cash on day 2, uninvested. The combined
    // series therefore jumps 1000 -> 1600 (naive +60%), but the deposit is a
    // flow, not a gain — the adjusted return must come out to +10%, matching
    // the real organic growth, not the naive 60%.
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 1000 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 1100 }),
    ];
    const cashTransactions = [
      makeCashTx({ date: "2026-01-02", type: "deposit", amount: 500, fxRate: 1 }),
    ];
    const result = computePortfolioAnalytics(snapshots, cashTransactions);
    expect(result.bestDayReturn).toBeCloseTo(10, 6);
  });

  it("computes portfolio-wide XIRR from deposit/withdrawal flows plus ending value", () => {
    // No pre-existing holdings (valueSgd: 0 on both snapshots) — ALL value in
    // this series comes from the single recorded deposit, so the expected
    // XIRR is unambiguous: put in 1000, still worth 1000 a year later -> 0%.
    // (If these snapshots instead used the makeSnapshot default of valueSgd:
    // 1000, the pre-existing 1000 of holdings would itself be an un-recorded
    // implicit contribution, and the correct XIRR would be 100%, not 0% — the
    // point of this test is the flow/ending-value arithmetic in isolation.)
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 0 }),
      makeSnapshot({ recordedDate: "2027-01-01", valueSgd: 0 }),
    ];
    const cashTransactions = [
      makeCashTx({ date: "2026-01-01", type: "deposit", amount: 1000, fxRate: 1 }),
    ];
    const result = computePortfolioAnalytics(snapshots, cashTransactions);
    // total value series (holdings 0 + cash 1000) is 1000 on both dates;
    // flows = [-1000 @ day1, +1000 @ day2] -> XIRR = 0%.
    expect(result.xirr).toBeCloseTo(0, 3);
  });

  it("returns empty xirrByBroker/xirrBySource when no holdings are supplied", () => {
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 1000 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 1100 }),
    ];
    const result = computePortfolioAnalytics(snapshots);
    expect(result.xirrByBroker).toEqual([]);
    expect(result.xirrBySource).toEqual([]);
  });

  it("computes a per-broker XIRR bucket when holdings/cash are tagged with a broker", () => {
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 1000 }),
      makeSnapshot({ recordedDate: "2027-01-01", valueSgd: 1000 }),
    ];
    const holdings = [makeRow({ id: "h1", broker: "IBKR", valueSGD: 500, costSGD: 500 })];
    const cashTransactions = [
      makeCashTx({ date: "2026-01-01", type: "deposit", amount: 500, fxRate: 1, broker: "IBKR" }),
    ];
    const result = computePortfolioAnalytics(snapshots, cashTransactions, holdings);
    expect(result.xirrByBroker).toHaveLength(1);
    expect(result.xirrByBroker[0].broker).toBe("IBKR");
  });
```

- [ ] **Step 7: Run the full new test set**

Run: `npx vitest run src/lib/portfolio.test.ts`
Expected: PASS — all pre-existing assertions plus the 4 new ones.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/app/api/portfolio/analytics/route.ts` (still calling the 1-arg `computePortfolioAnalytics(snapshots)`, which still compiles fine since the new params are optional — so actually expect NO errors at all; confirm this explicitly rather than assuming).

- [ ] **Step 9: Commit**

```bash
git add src/lib/portfolio.ts src/types/portfolio.ts src/lib/portfolio.test.ts
git commit -m "feat(portfolio): compute flow-adjusted TWR/Sharpe/drawdown and per-scope XIRR"
```

---

### Task 3: API route — fetch cash transactions + holdings for analytics

**Files:**
- Modify: `src/app/api/portfolio/analytics/route.ts`

**Interfaces:**
- Consumes: `fetchCashTransactions` (T7, `@/lib/supabase/data`), `fetchHoldings` (existing).

- [ ] **Step 1: Update the route**

Edit `src/app/api/portfolio/analytics/route.ts` — replace the whole file:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchSnapshots, fetchCashTransactions, fetchHoldings } from "@/lib/supabase/data";
import { computePortfolioAnalytics } from "@/lib/portfolio";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const [snapshots, cashTransactions, holdings] = await Promise.all([
    fetchSnapshots(user.id),
    fetchCashTransactions(user.id),
    fetchHoldings(user.id),
  ]);
  const analytics = computePortfolioAnalytics(snapshots, cashTransactions, holdings);
  return NextResponse.json(analytics);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. If a live session/migration is reachable in this environment, hit `/api/portfolio/analytics` while authenticated and confirm the response includes `xirr`/`xirrByBroker`/`xirrBySource` fields. If not reachable (the pattern every prior UI/API task in T6/T7 has hit), verify via code tracing and say so clearly.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/portfolio/analytics/route.ts
git commit -m "feat(api): fetch cash transactions and holdings for portfolio analytics"
```

---

### Task 4: UI — Charts page CAGR→TWR relabel + new XIRR card

**Files:**
- Modify: `src/app/(dashboard)/charts/page.tsx`

**Interfaces:**
- Consumes: `PortfolioAnalytics.xirr` (Task 2).

- [ ] **Step 1: Relabel the CAGR card and add an XIRR card**

Edit `src/app/(dashboard)/charts/page.tsx` — in `AnalyticsCards`, replace:
```tsx
      <MetricCard
        label="CAGR"
        value={pct(a.cagr)}
        color={gl(a.cagr)}
        sub="annualised growth"
        tip="Compound annual growth rate of portfolio value over the full recorded span."
      />
```
with:
```tsx
      <MetricCard
        label="TWR"
        value={pct(a.cagr)}
        color={gl(a.cagr)}
        sub="annualised, flow-adjusted"
        tip="Time-weighted return: annualised growth with deposits and withdrawals backed out, so it reflects investment performance rather than how much capital you've added."
      />
      <MetricCard
        label="XIRR"
        value={pct(a.xirr)}
        color={gl(a.xirr)}
        sub="money-weighted"
        tip="Money-weighted return (XIRR) across all your deposits and withdrawals — reflects your actual dollar-weighted experience, including the timing of your contributions."
      />
```

Update the grid to accommodate the extra card — replace:
```tsx
    <div className="grid grid-cols-5 gap-3.5 animate-reveal max-bp1080:grid-cols-3 max-bp600:grid-cols-2">
```
with:
```tsx
    <div className="grid grid-cols-6 gap-3.5 animate-reveal max-bp1080:grid-cols-3 max-bp600:grid-cols-2">
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Browser verification**

Run: `npm run dev`, open `/charts` if a session is reachable; otherwise verify via the compiled build (`npm run build`) and code tracing, noting clearly what couldn't be visually confirmed.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/charts/page.tsx"
git commit -m "feat(charts): relabel CAGR card to TWR, add XIRR card"
```

---

## Post-implementation checklist

- [ ] Every task's `npx tsc --noEmit` is clean with zero errors repo-wide.
- [ ] `npm test` (Vitest) is green for `returns.test.ts` and the full existing suite, with every pre-existing `computePortfolioAnalytics` assertion in `portfolio.test.ts` passing UNCHANGED (the zero-flow-equivalence property).
- [ ] `npm run lint` shows no new errors beyond pre-existing debt.
- [ ] Full manual walkthrough (once a live session is available): view `/charts` with a portfolio that has both a snapshot history and a recent deposit — confirm the TWR/XIRR numbers look plausible and the deposit doesn't spike the "best day" card.
