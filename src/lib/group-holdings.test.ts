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
