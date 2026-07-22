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
    exchangeCode: null,
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
