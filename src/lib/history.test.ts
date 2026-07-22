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
