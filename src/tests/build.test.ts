import { describe, it, expect } from "vitest";
import { dateRange, fillForward, buildSnapshotRows } from "@/lib/snapshots/build";
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

  it("fill-forwards a sparse FX series and rounds fractional SGD values", () => {
    // One USD lot; the FX series is sparse (only the first date), so 01-02 and
    // 01-03 must fill-forward the last known rate. On 01-03 the price ticks to
    // 101, yielding 3 x 101 x 1.35 = 409.05, which must round to 409.
    const lots = [
      lot({
        id: "u1",
        ticker: "USX",
        units: 3,
        buyPrice: 100,
        buyFxRate: 1.3,
        currency: "USD",
        buyDate: "2026-01-01",
      }),
    ];
    const rows = buildSnapshotRows({
      userId: "u1",
      lots,
      dates: dateRange("2026-01-01", "2026-01-03"),
      rawPrices: { USX: { "2026-01-01": 100, "2026-01-03": 101 } },
      rawFx: { USD: { "2026-01-01": 1.35 } }, // sparse: 01-02 & 01-03 fill forward
      priceFallback: () => 100,
      fxFallback: () => 1.3,
    });
    // 01-01: 3 x 100 x 1.35 = 405
    expect(rows[0].value_sgd).toBe(405);
    expect(rows[0].cost_sgd).toBe(390); // 3 x 100 x 1.3
    expect(rows[0].fx_by_currency.usd).toBeCloseTo(15, 6); // 3 x 100 x (1.35 - 1.3)
    // 01-02: price + FX both fill-forward → still 405
    expect(rows[1].value_sgd).toBe(405);
    // 01-03: price 101, FX still 1.35 → 409.05 → rounds to 409
    expect(rows[2].value_sgd).toBe(409);
  });

  it("fills forward from a real close before the write window, not the buyPrice seed", () => {
    // Fill window spans 01-01..01-05 and contains a real close on 01-02 (100).
    // The write window starts AFTER that close (01-04..01-05), which have no bars.
    // Regression (the #1 bug) would seed from buyPrice (50) → value 500, not 1000.
    const lots = [
      lot({ id: "a", ticker: "AAA", units: 10, buyPrice: 50, buyDate: "2026-01-01", currency: "SGD" }),
    ];
    const rows = buildSnapshotRows({
      userId: "u1",
      lots,
      dates: dateRange("2026-01-01", "2026-01-05"),
      writeDates: ["2026-01-04", "2026-01-05"],
      rawPrices: { AAA: { "2026-01-02": 100 } },
      rawFx: {},
      priceFallback: () => 50, // buyPrice seed — must NOT be used for the written dates
      fxFallback: () => 1,
    });
    expect(rows.map((r) => r.recorded_date)).toEqual(["2026-01-04", "2026-01-05"]);
    expect(rows[0].value_sgd).toBe(1000); // 10 x 100 (carried forward from 01-02)
    expect(rows[1].value_sgd).toBe(1000);
  });
});
