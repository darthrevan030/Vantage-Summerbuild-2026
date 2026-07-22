import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildFxColors,
  buildBaseFxRates,
  computeHeroStats,
  computeRealizedSummary,
  computeAllocationBySource,
  computeSharpeRatio,
  computeCAGR,
  computePortfolioAnalytics,
  computeAllocationByAsset,
  computeAllocationByGeo,
  computeMovers,
  computeCurrencyCards,
  computeWaterfall,
  generatePortfolioSeriesDaily,
  generatePortfolioSeries,
  generateFxSeries,
} from "@/lib/portfolio";
import type { HoldingRow } from "@/types/holding";
import type { SnapshotRow } from "@/lib/supabase/data";
import type { CurrencyCard } from "@/types/portfolio";
import type { RealizedLot } from "@/types/realized";
import type { CashTransaction } from "@/types/cash";

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
    costSGD: 1300,
    valueSGD: 1620,
    assetGain: 270,
    fxGain: 50,
    totalPct: 24.6,
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

function makeCard(overrides: Partial<CurrencyCard> = {}): CurrencyCard {
  return {
    code: "USD",
    flag: "🇺🇸",
    exposure: 1000,
    exposurePct: 50,
    avg: 1.3,
    cur: 1.35,
    deltaPct: 3.8,
    impact: 50,
    dir: "pos",
    spark: [],
    ...overrides,
  };
}

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

function makeRealizedLot(overrides: Partial<RealizedLot> = {}): RealizedLot {
  return {
    id: "r1",
    instrumentId: "i1",
    ticker: "AAPL",
    name: "Apple",
    assetType: "Equity",
    currency: "USD",
    flag: "🇺🇸",
    icon: "briefcase",
    sellLotId: "s1",
    buyLotId: "b1",
    method: "fifo",
    matchedQuantity: 5,
    matchedBuyPrice: 100,
    matchedBuyFx: 1.3,
    sellPrice: 130,
    sellFx: 1.35,
    assetGainSgd: 200,
    fxGainSgd: 10,
    realizedDate: "2026-06-01",
    ...overrides,
  };
}

describe("buildFxColors", () => {
  it("maps each card's lowercased code to a palette color", () => {
    const cards = [makeCard({ code: "USD" }), makeCard({ code: "EUR" })];
    const colors = buildFxColors(cards);
    expect(Object.keys(colors)).toEqual(["usd", "eur"]);
    expect(colors.usd).not.toBe(colors.eur);
  });

  it("cycles the 6-color palette for a 7th card", () => {
    const codes = ["A", "B", "C", "D", "E", "F", "G"];
    const cards = codes.map((code) => makeCard({ code }));
    const colors = buildFxColors(cards);
    expect(colors.a).toBe(colors.g);
  });

  it("returns an empty map for no cards", () => {
    expect(buildFxColors([])).toEqual({});
  });
});

describe("buildBaseFxRates", () => {
  it("starts from the static fallback rates", () => {
    const rates = buildBaseFxRates([]);
    expect(rates.SGD).toBe(1);
    expect(rates.USD).toBe(1.36);
  });

  it("overrides a fallback with the portfolio's live rate", () => {
    const rates = buildBaseFxRates([makeCard({ code: "USD", cur: 1.5 })]);
    expect(rates.USD).toBe(1.5);
  });

  it("ignores a card whose live rate is not positive", () => {
    const rates = buildBaseFxRates([makeCard({ code: "USD", cur: 0 })]);
    expect(rates.USD).toBe(1.36);
  });

  it("adds a rate for a currency with no static fallback", () => {
    const rates = buildBaseFxRates([makeCard({ code: "THB", cur: 0.04 })]);
    expect(rates.THB).toBe(0.04);
  });
});

describe("computeHeroStats", () => {
  it("sums netted positions into total/cost/gain figures", () => {
    const holdings = [
      makeRow({ id: "b1", costSGD: 1300, valueSGD: 1620, fxGain: 50 }),
    ];
    const stats = computeHeroStats(holdings, []);
    expect(stats.total).toBeCloseTo(1620, 6);
    expect(stats.unrealizedGain).toBeCloseTo(320, 6);
    expect(stats.unrealizedGainPct).toBeCloseTo((320 / 1300) * 100, 6);
    expect(stats.fxImpact).toBeCloseTo(50, 6);
    expect(stats.fxPct).toBeCloseTo((50 / 1300) * 100, 6);
    expect(stats.neutral).toBeCloseTo(1620 - 50, 6);
  });

  it("returns all-zero figures for an empty portfolio", () => {
    const stats = computeHeroStats([], []);
    expect(stats.total).toBe(0);
    expect(stats.unrealizedGain).toBe(0);
    expect(stats.unrealizedGainPct).toBe(0);
    expect(stats.fxPct).toBe(0);
    expect(stats.portfolioYield).toBe(0);
    expect(stats.annualIncome).toBe(0);
  });

  it("computes day change from the most recent snapshot before today", () => {
    const holdings = [makeRow({ id: "b1", valueSGD: 1620, costSGD: 1300 })];
    const snapshots = [
      makeSnapshot({ recordedDate: "2026-07-19", valueSgd: 1500 }),
      makeSnapshot({ recordedDate: "2026-07-20", valueSgd: 1550 }),
    ];
    const stats = computeHeroStats(holdings, snapshots);
    expect(stats.dayChange).toBeCloseTo(1620 - 1550, 6);
    expect(stats.dayPct).toBeCloseTo(((1620 - 1550) / 1550) * 100, 6);
  });

  it("ignores a snapshot recorded today when computing day change", () => {
    const today = new Date().toISOString().slice(0, 10);
    const holdings = [makeRow({ id: "b1", valueSGD: 1620, costSGD: 1300 })];
    const snapshots = [makeSnapshot({ recordedDate: today, valueSgd: 1550 })];
    const stats = computeHeroStats(holdings, snapshots);
    expect(stats.dayChange).toBe(0);
    expect(stats.dayPct).toBe(0);
  });

  it("uses dividendYield over dividendYieldAuto when both are present", () => {
    const holdings = [
      makeRow({
        id: "b1",
        units: 10,
        buyPrice: 100,
        buyFxRate: 1,
        currentPrice: 100,
        currentFxRate: 1,
        fees: 0,
        dividendYield: 4,
        dividendYieldAuto: 1,
      }),
    ];
    const stats = computeHeroStats(holdings, []);
    expect(stats.annualIncome).toBeCloseTo(40, 6);
    expect(stats.portfolioYield).toBeCloseTo(4, 6);
  });

  it("falls back to dividendYieldAuto when dividendYield is null", () => {
    const holdings = [
      makeRow({
        id: "b1",
        units: 10,
        buyPrice: 100,
        buyFxRate: 1,
        currentPrice: 100,
        currentFxRate: 1,
        fees: 0,
        dividendYield: null,
        dividendYieldAuto: 2.5,
      }),
    ];
    const stats = computeHeroStats(holdings, []);
    expect(stats.annualIncome).toBeCloseTo(25, 6);
    expect(stats.portfolioYield).toBeCloseTo(2.5, 6);
  });

  it("excludes positions with no dividend yield at all from the yield calc", () => {
    const holdings = [
      makeRow({ id: "b1", dividendYield: null, dividendYieldAuto: null }),
    ];
    const stats = computeHeroStats(holdings, []);
    expect(stats.portfolioYield).toBe(0);
    expect(stats.annualIncome).toBe(0);
  });

  it("stamps an 'updated' string ending in SGT", () => {
    const stats = computeHeroStats([], []);
    expect(stats.updated.endsWith("SGT")).toBe(true);
  });
});

describe("computeHeroStats — realized gain", () => {
  it("sums realizedLots into realizedGain/realizedGainPct, independent of open positions", () => {
    const holdings = [makeRow({ id: "b1", costSGD: 1300, valueSGD: 1620, fxGain: 50 })];
    const realizedLots = [
      makeRealizedLot({ matchedQuantity: 5, matchedBuyPrice: 100, matchedBuyFx: 1.3, assetGainSgd: 200, fxGainSgd: 10 }),
    ];
    const stats = computeHeroStats(holdings, [], realizedLots);
    expect(stats.realizedGain).toBeCloseTo(210, 6);
    expect(stats.realizedGainPct).toBeCloseTo((210 / 650) * 100, 6);
  });

  it("returns zero realizedGain/realizedGainPct when no realized lots are given (regression, default param)", () => {
    const holdings = [makeRow({ id: "b1" })];
    const stats = computeHeroStats(holdings, []);
    expect(stats.realizedGain).toBe(0);
    expect(stats.realizedGainPct).toBe(0);
  });
});

describe("computeRealizedSummary", () => {
  it("excludes a ticker that still has an open position", () => {
    const holdings = [makeRow({ id: "b1", ticker: "AAPL", units: 5 })];
    const realizedLots = [makeRealizedLot({ ticker: "AAPL" })];
    const closed = computeRealizedSummary(holdings, realizedLots);
    expect(closed).toHaveLength(0);
  });

  it("includes a fully-closed ticker with aggregated totals across multiple realized lots", () => {
    const holdings: HoldingRow[] = [];
    const realizedLots = [
      makeRealizedLot({ ticker: "AAPL", matchedQuantity: 5, assetGainSgd: 200, fxGainSgd: 10, realizedDate: "2026-06-01" }),
      makeRealizedLot({ ticker: "AAPL", id: "r2", matchedQuantity: 3, assetGainSgd: 90, fxGainSgd: 5, realizedDate: "2026-06-15" }),
    ];
    const closed = computeRealizedSummary(holdings, realizedLots);
    expect(closed).toHaveLength(1);
    expect(closed[0].totalQuantitySold).toBeCloseTo(8, 6);
    expect(closed[0].realizedGainSgd).toBeCloseTo(305, 6);
    expect(closed[0].assetGainSgd).toBeCloseTo(290, 6);
    expect(closed[0].fxGainSgd).toBeCloseTo(15, 6);
    expect(closed[0].lastSaleDate).toBe("2026-06-15");
  });
});

describe("computeAllocationBySource", () => {
  it("buckets holdings by source and sorts descending by value", () => {
    const holdings = [
      makeRow({
        id: "b1",
        ticker: "CPF1",
        source: "CPF",
        units: 500,
        buyPrice: 0.8,
        currentPrice: 1,
        buyFxRate: 1,
        currentFxRate: 1,
        fees: 0,
      }),
      makeRow({
        id: "b2",
        ticker: "CASH1",
        source: "Cash",
        units: 2000,
        buyPrice: 0.9,
        currentPrice: 1,
        buyFxRate: 1,
        currentFxRate: 1,
        fees: 0,
      }),
    ];
    const result = computeAllocationBySource(holdings);
    expect(result.map((r) => r.source)).toEqual(["Cash", "CPF"]);
    expect(result[0].pnl).toBeCloseTo(200, 6);
    expect(result[0].count).toBe(1);
  });

  it("groups an empty source string under 'Untagged'", () => {
    const holdings = [makeRow({ id: "b1", source: "" })];
    const result = computeAllocationBySource(holdings);
    expect(result[0].source).toBe("Untagged");
  });

  it("merges multiple holdings from the same source into one bucket", () => {
    const holdings = [
      makeRow({
        id: "b1",
        ticker: "AAPL",
        source: "Cash",
        units: 100,
        buyPrice: 1,
        currentPrice: 1,
        buyFxRate: 1,
        currentFxRate: 1,
        fees: 0,
      }),
      makeRow({
        id: "b2",
        ticker: "MSFT",
        source: "Cash",
        units: 200,
        buyPrice: 1,
        currentPrice: 1,
        buyFxRate: 1,
        currentFxRate: 1,
        fees: 0,
      }),
    ];
    const result = computeAllocationBySource(holdings);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
    expect(result[0].valueSGD).toBeCloseTo(300, 6);
  });
});

describe("computeSharpeRatio", () => {
  it("returns 0 for fewer than 2 returns", () => {
    expect(computeSharpeRatio([])).toBe(0);
    expect(computeSharpeRatio([0.01])).toBe(0);
  });

  it("returns 0 when all returns are identical (zero stddev)", () => {
    expect(computeSharpeRatio([0.01, 0.01, 0.01])).toBe(0);
  });

  it("matches the annualised Sharpe formula for a known series", () => {
    expect(computeSharpeRatio([0.1, -0.1])).toBeCloseTo(-0.013363062095621216, 9);
  });

  it("returns 0 excess-adjusted Sharpe when rfAnnual is 0 and mean return is 0", () => {
    expect(computeSharpeRatio([0.1, -0.1], 0)).toBe(0);
  });
});

describe("computeCAGR", () => {
  it("computes compound annual growth from start/end values over years", () => {
    expect(computeCAGR(100, 200, 1)).toBeCloseTo(100, 6);
  });

  it("returns 0 for a non-positive start value", () => {
    expect(computeCAGR(0, 200, 1)).toBe(0);
    expect(computeCAGR(-10, 200, 1)).toBe(0);
  });

  it("returns 0 for a non-positive end value", () => {
    expect(computeCAGR(100, 0, 1)).toBe(0);
  });

  it("returns 0 for a non-positive year span", () => {
    expect(computeCAGR(100, 200, 0)).toBe(0);
  });
});

describe("computePortfolioAnalytics", () => {
  it("returns empty analytics (with the filtered series) when fewer than 2 valid points exist", () => {
    const result = computePortfolioAnalytics([makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 1000 })]);
    expect(result.days).toBe(0);
    expect(result.cagr).toBe(0);
    expect(result.actualSharpe).toBe(0);
    expect(result.series).toHaveLength(1);
  });

  it("dedupes multiple snapshots on the same date, keeping the last one", () => {
    const result = computePortfolioAnalytics([
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 100 }),
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 999 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 200 }),
    ]);
    expect(result.series[0].value).toBe(999);
  });

  it("filters out non-positive snapshot values", () => {
    const result = computePortfolioAnalytics([
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 0 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 100 }),
      makeSnapshot({ recordedDate: "2026-01-03", valueSgd: 110 }),
    ]);
    expect(result.series).toHaveLength(2);
  });

  it("derives Sharpe, volatility, drawdown, and best/worst day from a 3-point series", () => {
    const result = computePortfolioAnalytics([
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 1000, costSgd: 900 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 1100, costSgd: 900 }),
      makeSnapshot({ recordedDate: "2026-01-03", valueSgd: 990, costSgd: 900 }),
    ]);
    expect(result.days).toBe(3);
    expect(result.actualSharpe).toBeCloseTo(-0.013363062095614985, 9);
    expect(result.annualisedVol).toBeCloseTo(224.49944320643658, 6);
    expect(result.maxDrawdown).toBeCloseTo(-10, 6);
    expect(result.maxDrawdownDate).toBe("2026-01-03");
    expect(result.bestDayReturn).toBeCloseTo(10, 6);
    expect(result.bestDayDate).toBe("2026-01-02");
    expect(result.worstDayReturn).toBeCloseTo(-10, 6);
    expect(result.worstDayDate).toBe("2026-01-03");
  });

  it("updates the best day when a later return exceeds the first day's return", () => {
    // whole-number values, since the series rounds valueSgd before computing returns
    // returns: +5%, -1.9%, +8.7% (new best), -0.9%
    const result = computePortfolioAnalytics([
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 100 }),
      makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 105 }),
      makeSnapshot({ recordedDate: "2026-01-03", valueSgd: 103 }),
      makeSnapshot({ recordedDate: "2026-01-04", valueSgd: 112 }),
      makeSnapshot({ recordedDate: "2026-01-05", valueSgd: 111 }),
    ]);
    expect(result.bestDayReturn).toBeCloseTo(8.737864077669899, 6);
    expect(result.bestDayDate).toBe("2026-01-04");
  });

  it("never registers a drawdown on a monotonically increasing series", () => {
    const result = computePortfolioAnalytics([
      makeSnapshot({ recordedDate: "2025-01-01", valueSgd: 100 }),
      makeSnapshot({ recordedDate: "2026-01-01", valueSgd: 200 }),
    ]);
    expect(result.maxDrawdown).toBe(0);
    expect(result.maxDrawdownDate).toBe("");
    expect(result.actualSharpe).toBe(0);
    expect(result.annualisedVol).toBe(0);
    expect(result.cagr).toBeCloseTo(100.09497421168562, 6);
  });

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
});

describe("computeAllocationByAsset", () => {
  it("splits value across asset types as rounded percentages", () => {
    const holdings = [
      makeRow({
        id: "b1",
        assetType: "Equity",
        units: 75,
        buyPrice: 1,
        currentPrice: 1,
        buyFxRate: 1,
        currentFxRate: 1,
        fees: 0,
      }),
      makeRow({
        id: "b2",
        ticker: "GLD",
        assetType: "Gold",
        units: 25,
        buyPrice: 1,
        currentPrice: 1,
        buyFxRate: 1,
        currentFxRate: 1,
        fees: 0,
      }),
    ];
    const result = computeAllocationByAsset(holdings);
    const byLabel = Object.fromEntries(result.map((r) => [r.label, r.value]));
    expect(byLabel.Equity).toBe(75);
    expect(byLabel.Gold).toBe(25);
  });

  it("cycles the 6-color palette across more than 6 asset types", () => {
    const holdings = "ABCDEFG".split("").map((c, i) =>
      makeRow({ id: `b${i}`, ticker: `T${i}`, assetType: c }),
    );
    const result = computeAllocationByAsset(holdings);
    expect(result[0].color).toBe(result[6].color);
  });

  it("returns an empty array for no holdings", () => {
    expect(computeAllocationByAsset([])).toEqual([]);
  });
});

describe("computeAllocationByGeo", () => {
  it("maps known currencies to their country", () => {
    const holdings = [makeRow({ id: "b1", currency: "USD" })];
    const result = computeAllocationByGeo(holdings);
    expect(result[0].label).toBe("United States");
  });

  it("buckets an unmapped currency under Global", () => {
    const holdings = [makeRow({ id: "b1", currency: "THB" })];
    const result = computeAllocationByGeo(holdings);
    expect(result[0].label).toBe("Global");
  });

  it("merges holdings from the same geography", () => {
    const holdings = [
      makeRow({ id: "b1", ticker: "AAPL", currency: "USD" }),
      makeRow({ id: "b2", ticker: "MSFT", currency: "USD" }),
    ];
    const result = computeAllocationByGeo(holdings);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(100);
  });
});

describe("computeMovers", () => {
  it("splits positions into gainers (sorted desc) and losers (sorted most-negative first)", () => {
    const winner = makeRow({
      id: "b1",
      ticker: "WIN",
      units: 10,
      buyPrice: 100,
      buyFxRate: 1,
      currentPrice: 150,
      currentFxRate: 1,
      fees: 0,
    });
    const loser = makeRow({
      id: "b2",
      ticker: "LOSE",
      units: 10,
      buyPrice: 100,
      buyFxRate: 1,
      currentPrice: 50,
      currentFxRate: 1,
      fees: 0,
    });
    const bigLoser = makeRow({
      id: "b3",
      ticker: "CRASH",
      units: 10,
      buyPrice: 100,
      buyFxRate: 1,
      currentPrice: 10,
      currentFxRate: 1,
      fees: 0,
    });
    const { gainers, losers } = computeMovers([winner, loser, bigLoser]);
    expect(gainers.map((g) => g.ticker)).toEqual(["WIN"]);
    expect(losers.map((l) => l.ticker)).toEqual(["CRASH", "LOSE"]);
  });

  it("treats a zero-cost position as a (non-negative) gainer", () => {
    const holdings = [
      makeRow({ id: "b1", units: 10, buyPrice: 0, buyFxRate: 1, fees: 0, currentPrice: 100, currentFxRate: 1 }),
    ];
    const { gainers, losers } = computeMovers(holdings);
    expect(gainers).toHaveLength(1);
    expect(losers).toHaveLength(0);
  });
});

describe("computeCurrencyCards", () => {
  it("excludes SGD-denominated positions", () => {
    const holdings = [makeRow({ id: "b1", currency: "SGD", valueSGD: 100, costSGD: 100 })];
    expect(computeCurrencyCards(holdings)).toEqual([]);
  });

  it("computes exposure, weighted avg FX, and current FX for a currency group", () => {
    const holdings = [
      makeRow({
        id: "b1",
        currency: "USD",
        units: 1000,
        buyPrice: 1,
        currentPrice: 1,
        buyFxRate: 1.3,
        currentFxRate: 1.35,
        fees: 0,
      }),
    ];
    const [card] = computeCurrencyCards(holdings);
    expect(card.code).toBe("USD");
    expect(card.exposure).toBeCloseTo(1350, 6);
    expect(card.avg).toBeCloseTo(1.3, 6);
    expect(card.cur).toBeCloseTo(1.35, 6);
    expect(card.dir).toBe("pos");
    expect(card.exposurePct).toBe(100);
  });

  it("marks a depreciating rate as a negative-direction card", () => {
    const holdings = [
      makeRow({ id: "b1", currency: "USD", valueSGD: 1000, costSGD: 900, buyFxRate: 1.4, currentFxRate: 1.3 }),
    ];
    const [card] = computeCurrencyCards(holdings);
    expect(card.dir).toBe("neg");
    expect(card.deltaPct).toBeLessThan(0);
  });

  it("falls back to a generic flag for an unmapped currency", () => {
    const holdings = [makeRow({ id: "b1", currency: "THB", valueSGD: 100, costSGD: 100 })];
    const [card] = computeCurrencyCards(holdings);
    expect(card.flag).toBe("🏳️");
  });

  it("treats a zero weighted-average buy FX rate as a 0% delta", () => {
    const holdings = [
      makeRow({
        id: "b1",
        currency: "USD",
        units: 100,
        buyPrice: 1,
        currentPrice: 1,
        buyFxRate: 0,
        currentFxRate: 1,
        fees: 0,
      }),
    ];
    const [card] = computeCurrencyCards(holdings);
    expect(card.avg).toBe(0);
    expect(card.deltaPct).toBe(0);
  });
});

describe("computeWaterfall", () => {
  it("maps currency cards into rounded signed waterfall items", () => {
    const cards = [makeCard({ code: "USD", impact: 123.6 }), makeCard({ code: "EUR", impact: -45.2 })];
    const result = computeWaterfall(cards);
    expect(result).toEqual([
      { code: "USD", value: 124, dir: "pos" },
      { code: "EUR", value: -45, dir: "neg" },
    ]);
  });

  it("treats zero impact as positive direction", () => {
    const [item] = computeWaterfall([makeCard({ code: "USD", impact: 0 })]);
    expect(item.dir).toBe("pos");
  });
});

describe("date-dependent series generators", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("generatePortfolioSeriesDaily", () => {
    it("returns an empty series with no holdings", () => {
      expect(generatePortfolioSeriesDaily([], [])).toEqual([]);
    });

    it("builds one point per snapshot date, sorted and rounded", () => {
      const holdings = [makeRow({ buyDate: "2026-07-01" })];
      const snapshots = [
        makeSnapshot({ recordedDate: "2026-07-10", valueSgd: 1000.4 }),
        makeSnapshot({ recordedDate: "2026-07-05", valueSgd: 900.6 }),
      ];
      const points = generatePortfolioSeriesDaily(snapshots, holdings);
      expect(points.map((p) => p.date)).toEqual(["2026-07-05", "2026-07-10"]);
      expect(points[0].v).toBe(901);
      expect(points[1].v).toBe(1000);
    });

    it("prepends a cost seed point when only one snapshot exists after the buy date", () => {
      const holdings = [makeRow({ buyDate: "2026-07-01", costSGD: 500 })];
      const snapshots = [makeSnapshot({ recordedDate: "2026-07-10", valueSgd: 1000 })];
      const points = generatePortfolioSeriesDaily(snapshots, holdings);
      expect(points).toHaveLength(2);
      expect(points[0].date).toBe("2026-07-01");
      expect(points[0].v).toBe(500);
    });

    it("does not prepend when the single snapshot is already at/before the buy date", () => {
      const holdings = [makeRow({ buyDate: "2026-07-10" })];
      const snapshots = [makeSnapshot({ recordedDate: "2026-07-10", valueSgd: 1000 })];
      const points = generatePortfolioSeriesDaily(snapshots, holdings);
      expect(points).toHaveLength(1);
    });

    it("falls back to a 2-point cost/value seed with no snapshots", () => {
      const holdings = [makeRow({ buyDate: "2026-07-01", costSGD: 500, valueSGD: 620 })];
      const points = generatePortfolioSeriesDaily([], holdings);
      expect(points).toEqual([
        { label: "Jul 1", date: "2026-07-01", v: 500 },
        { label: "Jul 21", date: "2026-07-21", v: 620 },
      ]);
    });

    it("returns an empty seed when the earliest buy date is today or later", () => {
      const holdings = [makeRow({ buyDate: "2026-07-21" })];
      expect(generatePortfolioSeriesDaily([], holdings)).toEqual([]);
    });

    it("picks the earliest buy date across multiple holdings, regardless of array order", () => {
      const holdings = [
        makeRow({ id: "b1", buyDate: "2026-07-10", costSGD: 100 }),
        makeRow({ id: "b2", buyDate: "2026-07-01", costSGD: 200 }),
      ];
      const points = generatePortfolioSeriesDaily([], holdings);
      expect(points[0].date).toBe("2026-07-01");
    });

    it("suffixes the label with the 2-digit year for a snapshot from a past year", () => {
      const holdings = [makeRow({ buyDate: "2025-01-01" })];
      const snapshots = [
        makeSnapshot({ recordedDate: "2025-12-31", valueSgd: 1000 }),
        makeSnapshot({ recordedDate: "2026-01-02", valueSgd: 1100 }),
      ];
      const points = generatePortfolioSeriesDaily(snapshots, holdings);
      expect(points[0].label).toBe("Dec 31 '25");
      expect(points[1].label).toBe("Jan 2");
    });
  });

  describe("generatePortfolioSeries (monthly)", () => {
    it("returns an empty series with no holdings", () => {
      expect(generatePortfolioSeries([], [])).toEqual([]);
    });

    it("builds one point per snapshot month", () => {
      const holdings = [makeRow({ buyDate: "2026-05-01" })];
      const snapshots = [
        makeSnapshot({ recordedDate: "2026-06-15", valueSgd: 1000 }),
        makeSnapshot({ recordedDate: "2026-07-15", valueSgd: 1100 }),
      ];
      const points = generatePortfolioSeries(snapshots, holdings);
      expect(points.map((p) => p.date)).toEqual(["2026-06", "2026-07"]);
    });

    it("falls back to a 2-point cost/value seed with no snapshots across different months", () => {
      const holdings = [makeRow({ buyDate: "2026-05-01", costSGD: 500, valueSGD: 620 })];
      const points = generatePortfolioSeries([], holdings);
      expect(points).toEqual([
        { label: "May 26", date: "2026-05", v: 500 },
        { label: "Jul 26", date: "2026-07", v: 620 },
      ]);
    });

    it("returns an empty seed when the earliest buy is in the current month", () => {
      const holdings = [makeRow({ buyDate: "2026-07-05" })];
      expect(generatePortfolioSeries([], holdings)).toEqual([]);
    });

    it("picks the earliest buy date across multiple holdings, regardless of array order", () => {
      const holdings = [
        makeRow({ id: "b1", buyDate: "2026-06-10", costSGD: 100 }),
        makeRow({ id: "b2", buyDate: "2026-05-01", costSGD: 200 }),
      ];
      const points = generatePortfolioSeries([], holdings);
      expect(points[0].date).toBe("2026-05");
    });

    it("prepends a cost seed point when only one snapshot month exists after the buy month", () => {
      const holdings = [makeRow({ buyDate: "2026-05-01", costSGD: 500 })];
      const snapshots = [makeSnapshot({ recordedDate: "2026-07-15", valueSgd: 1000 })];
      const points = generatePortfolioSeries(snapshots, holdings);
      expect(points).toHaveLength(2);
      expect(points[0]).toEqual({ label: "May 26", date: "2026-05", v: 500 });
      expect(points[1].date).toBe("2026-07");
    });
  });

  describe("generateFxSeries", () => {
    it("returns empty series/labels with no currency cards", () => {
      expect(generateFxSeries([], [], [])).toEqual({ series: [], fxLabels: [] });
    });

    it("builds a per-date point restricted to the active currencies", () => {
      const cards = [makeCard({ code: "USD" })];
      const snapshots = [
        makeSnapshot({ recordedDate: "2026-07-10", fxByCurrency: { usd: 12.3, eur: 99 } }),
        makeSnapshot({ recordedDate: "2026-07-11", fxByCurrency: { usd: 15.7 } }),
      ];
      const { series, fxLabels } = generateFxSeries(snapshots, cards, []);
      expect(fxLabels).toEqual(["2026-07-10", "2026-07-11"]);
      expect(series[0]).toEqual({ i: 0, usd: 12 });
      expect(series[1]).toEqual({ i: 1, usd: 16 });
    });

    it("defaults a snapshot missing the active currency's key to 0", () => {
      const cards = [makeCard({ code: "USD" })];
      const snapshots = [
        makeSnapshot({ recordedDate: "2026-07-10", fxByCurrency: {} }),
        makeSnapshot({ recordedDate: "2026-07-11", fxByCurrency: { usd: 20 } }),
      ];
      const { series } = generateFxSeries(snapshots, cards, []);
      expect(series[0]).toEqual({ i: 0, usd: 0 });
    });

    it("picks the earliest buy date across multiple FX-exposed holdings", () => {
      const cards = [makeCard({ code: "USD" })];
      const holdings = [
        makeRow({ id: "b1", currency: "USD", buyDate: "2026-07-10" }),
        makeRow({ id: "b2", currency: "USD", buyDate: "2026-07-01" }),
      ];
      const { fxLabels } = generateFxSeries([], cards, holdings);
      expect(fxLabels[0]).toBe("2026-07-01");
    });

    it("prepends a zero point when only one snapshot exists after the earliest FX buy date", () => {
      const cards = [makeCard({ code: "USD" })];
      const holdings = [makeRow({ currency: "USD", buyDate: "2026-07-01" })];
      const snapshots = [makeSnapshot({ recordedDate: "2026-07-10", fxByCurrency: { usd: 10 } })];
      const { series, fxLabels } = generateFxSeries(snapshots, cards, holdings);
      expect(fxLabels).toEqual(["2026-07-01", "2026-07-10"]);
      expect(series[0]).toEqual({ i: 0, usd: 0 });
      expect(series[1]).toEqual({ i: 1, usd: 10 });
    });

    it("returns empty when there are no snapshots and no FX-exposed holdings", () => {
      const cards = [makeCard({ code: "USD" })];
      const holdings = [makeRow({ currency: "SGD" })];
      expect(generateFxSeries([], cards, holdings)).toEqual({ series: [], fxLabels: [] });
    });

    it("falls back to a 2-point zero/current-impact seed with no snapshots", () => {
      const cards = [makeCard({ code: "USD", impact: 42.4 })];
      const holdings = [makeRow({ currency: "USD", buyDate: "2026-07-01" })];
      const { series, fxLabels } = generateFxSeries([], cards, holdings);
      expect(fxLabels).toEqual(["2026-07-01", "2026-07-21"]);
      expect(series).toEqual([
        { i: 0, usd: 0 },
        { i: 1, usd: 42 },
      ]);
    });

    it("returns empty when the earliest FX buy date is today or later and there are no snapshots", () => {
      const cards = [makeCard({ code: "USD" })];
      const holdings = [makeRow({ currency: "USD", buyDate: "2026-07-21" })];
      expect(generateFxSeries([], cards, holdings)).toEqual({ series: [], fxLabels: [] });
    });
  });
});
