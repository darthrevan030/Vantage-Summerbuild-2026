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
