import { describe, it, expect } from "vitest";
import {
  computeCurrentValueSGD,
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "@/lib/fx";
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
