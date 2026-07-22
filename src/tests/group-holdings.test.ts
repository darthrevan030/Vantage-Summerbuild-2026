import { describe, it, expect } from "vitest";
import { groupHoldings, toNetPositions } from "@/lib/group-holdings";
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

describe("bucketing by position", () => {
  it("merges multiple lots that share a ticker into one group", () => {
    const lot1 = makeRow({ id: "b1", ticker: "AAPL", units: 10 });
    const lot2 = makeRow({ id: "b2", ticker: "AAPL", units: 20 });
    const groups = groupHoldings([lot1, lot2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lots).toHaveLength(2);
    expect(groups[0].totalUnits).toBeCloseTo(30, 6);
  });

  it("keeps distinct tickers in separate groups", () => {
    const aapl = makeRow({ id: "b1", ticker: "AAPL", units: 10 });
    const msft = makeRow({ id: "b2", ticker: "MSFT", units: 5 });
    const groups = groupHoldings([aapl, msft]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.ticker).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it.each(["—", "-", ""])(
    "never merges NON_GROUPABLE ticker %j lots, even with identical ticker text",
    (ticker) => {
      const gold1 = makeRow({ id: "g1", ticker, name: "Gold bar 1", units: 1 });
      const gold2 = makeRow({ id: "g2", ticker, name: "Gold bar 2", units: 1 });
      const groups = groupHoldings([gold1, gold2]);
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name).sort()).toEqual([
        "Gold bar 1",
        "Gold bar 2",
      ]);
    },
  );

  it("carries identity fields from the first lot into the grouped view", () => {
    const lot1 = makeRow({
      id: "b1",
      ticker: "VWRA",
      name: "Vanguard All-World",
      assetType: "ETF",
      currency: "USD",
      flag: "🇺🇸",
      icon: "chart",
      source: "Cash",
      dividendYield: 1.8,
    });
    const [group] = groupHoldings([lot1]);
    expect(group.ticker).toBe("VWRA");
    expect(group.name).toBe("Vanguard All-World");
    expect(group.assetType).toBe("ETF");
    expect(group.currency).toBe("USD");
    expect(group.source).toBe("Cash");
    expect(group.dividendYield).toBe(1.8);
  });
});

describe("netAggregate sell-only bucket (no open buys)", () => {
  it("groupHoldings reports a zero position, falling back to the lot's own prices", () => {
    const sellOnly = makeRow({
      id: "s1",
      transactionType: "sell",
      units: 5,
      buyPrice: 999,
      buyFxRate: 1.5,
      currentPrice: 120,
      currentFxRate: 1.35,
    });
    const [group] = groupHoldings([sellOnly]);
    expect(group.totalUnits).toBe(0);
    expect(group.costSGD).toBe(0);
    expect(group.valueSGD).toBe(0);
    expect(group.assetGain).toBe(0);
    expect(group.fxGain).toBe(0);
    expect(group.totalPct).toBe(0);
    expect(group.avgBuyPrice).toBe(999);
    expect(group.currentPrice).toBe(120);
  });

  it("toNetPositions drops a bucket with only sell lots", () => {
    const sellOnly = makeRow({ id: "s1", transactionType: "sell", units: 5 });
    expect(toNetPositions([sellOnly])).toHaveLength(0);
  });
});

describe("toNetPositions multi-lot averaging", () => {
  it("value-weights the average buy price and FX rate across buy lots", () => {
    const lot1 = makeRow({
      id: "b1",
      units: 10,
      buyPrice: 100,
      buyFxRate: 1.3,
      fees: 0,
    });
    const lot2 = makeRow({
      id: "b2",
      units: 30,
      buyPrice: 120,
      buyFxRate: 1.4,
      fees: 0,
    });
    const [pos] = toNetPositions([lot1, lot2]);
    // (10*100 + 30*120) / 40 = 115 ; (10*1.3 + 30*1.4) / 40 = 1.375
    expect(pos.buyPrice).toBeCloseTo(115, 6);
    expect(pos.buyFxRate).toBeCloseTo(1.375, 6);
    expect(pos.units).toBeCloseTo(40, 6);
  });

  it("forces transactionType to buy and refreshes the detail block", () => {
    const lot1 = makeRow({ id: "b1", units: 10, buyPrice: 100, buyFxRate: 1.3 });
    const [pos] = toNetPositions([lot1]);
    expect(pos.transactionType).toBe("buy");
    expect(pos.detail.buyUnits).toBeCloseTo(10, 6);
    expect(pos.detail.buyPx).toBeCloseTo(100, 6);
    expect(pos.detail.buyFx).toBeCloseTo(1.3, 6);
    expect(pos.detail.curPx).toBe(pos.currentPrice);
    expect(pos.detail.curFx).toBe(pos.currentFxRate);
  });

  it("nets a partial sell down to the correct remaining units across two buy lots", () => {
    const lot1 = makeRow({ id: "b1", units: 10, buyPrice: 100, transactionType: "buy" });
    const lot2 = makeRow({ id: "b2", units: 10, buyPrice: 120, transactionType: "buy" });
    const sell = makeRow({ id: "s1", units: 5, transactionType: "sell" });
    const [pos] = toNetPositions([lot1, lot2, sell]);
    expect(pos.units).toBeCloseTo(15, 6);
  });
});
