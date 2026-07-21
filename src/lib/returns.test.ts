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
