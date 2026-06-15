import type { HoldingRow } from "@/types/holding";
import type { SnapshotRow } from "@/lib/supabase/data";
import type {
  HeroStats,
  MoverItem,
  CurrencyCard,
  WaterfallItem,
  AllocationSlice,
  AllocationBySource,
  PortfolioSeriesPoint,
  FxSeriesPoint,
  PortfolioAnalytics,
} from "@/types/portfolio";
import {
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "./fx";
import { toNetPositions } from "./group-holdings";

const PAL = ["#b79cff", "#5fd0c6", "#6fb0ff", "#f4a6cf", "#8b8bff", "#f0bd8a"];

const FX_COLOR_PALETTE = [
  "#6fb0ff",
  "#46d8a0",
  "#f0bd8a",
  "#b79cff",
  "#f4a6cf",
  "#8b8bff",
];

const FALLBACK_FX_RATES: Record<string, number> = {
  SGD: 1,
  USD: 1.36,
  EUR: 1.51,
  GBP: 1.72,
  AUD: 0.88,
  JPY: 0.0091,
  INR: 0.016,
  HKD: 0.174,
};

export function buildFxColors(cards: CurrencyCard[]): Record<string, string> {
  const result: Record<string, string> = {};
  cards.forEach((c, i) => {
    result[c.code.toLowerCase()] =
      FX_COLOR_PALETTE[i % FX_COLOR_PALETTE.length];
  });
  return result;
}

/** Returns SGD-per-unit rates. Portfolio rates take priority; static fallbacks fill the gaps. */
export function buildBaseFxRates(
  cards: CurrencyCard[],
): Record<string, number> {
  const rates: Record<string, number> = { ...FALLBACK_FX_RATES };
  for (const c of cards) {
    if (c.cur > 0) rates[c.code] = c.cur;
  }
  return rates;
}

export function computeHeroStats(
  holdings: HoldingRow[],
  snapshots: SnapshotRow[] = [],
): HeroStats {
  // Net out sells so totals reflect what's actually held, not gross lots.
  const positions = toNetPositions(holdings);
  const total = positions.reduce((s, h) => s + h.valueSGD, 0);
  const cost = positions.reduce((s, h) => s + h.costSGD, 0);
  const totalGain = total - cost;
  const totalGainPct = cost > 0 ? (totalGain / cost) * 100 : 0;
  const fxImpact = positions.reduce((s, h) => s + h.fxGain, 0);
  const fxPct = cost > 0 ? (fxImpact / cost) * 100 : 0;
  const neutral = total - fxImpact;

  // Day change from the most recent two distinct-date snapshots
  const today = new Date().toISOString().slice(0, 10);
  const prevSnap = [...snapshots].reverse().find((s) => s.recordedDate < today);
  const dayChange = prevSnap ? total - prevSnap.valueSgd : 0;
  const dayPct = prevSnap && prevSnap.valueSgd > 0 ? (dayChange / prevSnap.valueSgd) * 100 : 0;

  // Portfolio yield and annual income (weighted by SGD value)
  let yieldedValue = 0;
  let annualIncome = 0;
  for (const h of positions) {
    const y = h.dividendYield ?? h.dividendYieldAuto;
    if (y != null) {
      yieldedValue += h.valueSGD;
      annualIncome += (y / 100) * h.valueSGD;
    }
  }
  const portfolioYield = yieldedValue > 0 ? (annualIncome / yieldedValue) * 100 : 0;

  return {
    total,
    dayChange,
    dayPct,
    totalGain,
    totalGainPct,
    fxImpact,
    fxPct,
    neutral,
    updated: new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" }) + " SGT",
    portfolioYield,
    annualIncome,
  };
}

export function computeAllocationBySource(holdings: HoldingRow[]): AllocationBySource[] {
  const positions = toNetPositions(holdings);
  const map = new Map<string, { valueSGD: number; costSGD: number; count: number }>();
  for (const h of positions) {
    const key = h.source || "Untagged";
    const bucket = map.get(key) ?? { valueSGD: 0, costSGD: 0, count: 0 };
    bucket.valueSGD += h.valueSGD;
    bucket.costSGD += h.costSGD;
    bucket.count += 1;
    map.set(key, bucket);
  }
  return Array.from(map.entries())
    .map(([source, b]) => ({ source, valueSGD: b.valueSGD, costSGD: b.costSGD, pnl: b.valueSGD - b.costSGD, count: b.count }))
    .sort((a, b) => b.valueSGD - a.valueSGD);
}

// ── Risk / return analytics ───────────────────────────────────────────────────

const TRADING_DAYS = 252;

/** Sample standard deviation (n-1). Returns 0 for fewer than 2 observations. */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance =
    xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Annualised Sharpe ratio from a series of daily returns. rfAnnual is the
 *  annual risk-free rate (default 3%); excess return is taken per trading day. */
export function computeSharpeRatio(
  dailyReturns: number[],
  rfAnnual = 0.03,
): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const sd = stddev(dailyReturns);
  if (sd === 0) return 0;
  return ((mean - rfAnnual / TRADING_DAYS) / sd) * Math.sqrt(TRADING_DAYS);
}

/** Compound annual growth rate between two values over a span of years. */
export function computeCAGR(
  startValue: number,
  endValue: number,
  years: number,
): number {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return 0;
  return ((endValue / startValue) ** (1 / years) - 1) * 100;
}

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
};

/** Derives CAGR, Sharpe, annualised volatility, max drawdown, and best/worst
 *  single-day returns from the portfolio value snapshots. All percentages are
 *  returned in percentage points (e.g. 12.3 for 12.3%). */
export function computePortfolioAnalytics(
  snapshots: SnapshotRow[],
): PortfolioAnalytics {
  // One value per date, chronological. Skip non-positive values (pre-funding).
  const byDate = new Map<string, SnapshotRow>();
  for (const s of snapshots) byDate.set(s.recordedDate, s);
  const series = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => ({
      date,
      value: Math.round(s.valueSgd),
      cost: Math.round(s.costSgd),
    }))
    .filter((p) => p.value > 0);

  if (series.length < 2) return { ...EMPTY_ANALYTICS, series };

  // Daily returns between consecutive snapshot dates
  const dailyReturns: { date: string; r: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    if (prev > 0) dailyReturns.push({ date: series[i].date, r: series[i].value / prev - 1 });
  }

  const returns = dailyReturns.map((d) => d.r);
  const actualSharpe = computeSharpeRatio(returns);
  const annualisedVol = stddev(returns) * Math.sqrt(TRADING_DAYS) * 100;

  // CAGR over the actual elapsed span
  const first = series[0];
  const last = series[series.length - 1];
  const msPerYear = 365.25 * 24 * 3600 * 1000;
  const years =
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / msPerYear;
  const cagr = years > 0 ? computeCAGR(first.value, last.value, years) : 0;

  // Max drawdown: deepest peak-to-trough decline in value
  let peak = series[0].value;
  let maxDrawdown = 0;
  let maxDrawdownDate = "";
  for (const p of series) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? (p.value - peak) / peak : 0;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownDate = p.date;
    }
  }

  // Best / worst single-day return
  let best = dailyReturns[0];
  let worst = dailyReturns[0];
  for (const d of dailyReturns) {
    if (d.r > best.r) best = d;
    if (d.r < worst.r) worst = d;
  }

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
    days: series.length,
    series,
  };
}

export function computeAllocationByAsset(
  holdings: HoldingRow[],
): AllocationSlice[] {
  const positions = toNetPositions(holdings);
  const totals: Record<string, number> = {};
  const grandTotal = positions.reduce((s, h) => s + h.valueSGD, 0);
  for (const h of positions) {
    totals[h.assetType] = (totals[h.assetType] ?? 0) + h.valueSGD;
  }
  return Object.entries(totals).map(([label, value], i) => ({
    label,
    value: Math.round((value / grandTotal) * 100),
    color: PAL[i % PAL.length],
  }));
}

export function computeAllocationByGeo(
  holdings: HoldingRow[],
): AllocationSlice[] {
  const geoMap: Record<string, string> = {
    USD: "United States",
    SGD: "Singapore",
    EUR: "Europe",
    AUD: "Australia",
    GBP: "United Kingdom",
    INR: "India",
    HKD: "Hong Kong",
    JPY: "Japan",
    CNY: "China",
    CNH: "China",
    KRW: "South Korea",
    TWD: "Taiwan",
    SAR: "Saudi Arabia",
    BRL: "Brazil",
    CHF: "Switzerland",
    SEK: "Sweden",
    NOK: "Norway",
    DKK: "Denmark",
  };
  const positions = toNetPositions(holdings);
  const totals: Record<string, number> = {};
  const grandTotal = positions.reduce((s, h) => s + h.valueSGD, 0);
  for (const h of positions) {
    const geo = geoMap[h.currency] ?? "Global";
    totals[geo] = (totals[geo] ?? 0) + h.valueSGD;
  }
  return Object.entries(totals).map(([label, value], i) => ({
    label,
    value: Math.round((value / grandTotal) * 100),
    color: PAL[i % PAL.length],
  }));
}

export function computeMovers(holdings: HoldingRow[]): {
  gainers: MoverItem[];
  losers: MoverItem[];
} {
  const items: MoverItem[] = toNetPositions(holdings).map((h) => {
    const cost = computeCostBasisSGD(h);
    const asset = cost > 0 ? (computeAssetGainSGD(h) / cost) * 100 : 0;
    const fx = cost > 0 ? (computeFxGainSGD(h) / cost) * 100 : 0;
    return { name: h.name, ticker: h.ticker, asset, fx };
  });
  const sorted = [...items].sort((a, b) => b.asset + b.fx - (a.asset + a.fx));
  return {
    gainers: sorted.filter((m) => m.asset + m.fx >= 0),
    losers: sorted.filter((m) => m.asset + m.fx < 0).reverse(),
  };
}

export function computeCurrencyCards(holdings: HoldingRow[]): CurrencyCard[] {
  const positions = toNetPositions(holdings);
  const groups: Record<string, HoldingRow[]> = {};
  for (const h of positions) {
    if (h.currency === "SGD") continue;
    (groups[h.currency] ??= []).push(h);
  }
  const flags: Record<string, string> = {
    USD: "🇺🇸",
    EUR: "🇪🇺",
    GBP: "🇬🇧",
    AUD: "🇦🇺",
    INR: "🇮🇳",
    JPY: "🇯🇵",
    HKD: "🇭🇰",
  };
  const grandTotal = positions.reduce((s, h) => s + h.valueSGD, 0);

  return Object.entries(groups).map(([code, hs]) => {
    const exposure = hs.reduce((s, h) => s + h.valueSGD, 0);
    const avgFx =
      hs.reduce((s, h) => s + h.buyFxRate * h.valueSGD, 0) / exposure;
    const curFx = hs[0]?.currentFxRate ?? 1;
    const deltaPct = avgFx > 0 ? ((curFx - avgFx) / avgFx) * 100 : 0;
    const impact = hs.reduce((s, h) => s + computeFxGainSGD(h), 0);
    return {
      code,
      flag: flags[code] ?? "🏳️",
      exposure,
      exposurePct: grandTotal > 0 ? (exposure / grandTotal) * 100 : 0,
      avg: avgFx,
      cur: curFx,
      deltaPct,
      impact,
      dir: deltaPct >= 0 ? "pos" : "neg",
      spark: hs[0]?.sparkData ?? [],
    };
  });
}

export function computeWaterfall(cards: CurrencyCard[]): WaterfallItem[] {
  return cards.map((c) => ({
    code: c.code,
    value: Math.round(c.impact),
    dir: c.impact >= 0 ? "pos" : "neg",
  }));
}

const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function ymLabel(ym: string): string {
  const yr = parseInt(ym.slice(0, 4));
  const mo = parseInt(ym.slice(5, 7)) - 1;
  return `${MON[mo]} ${String(yr).slice(2)}`;
}

/** Label for a daily "YYYY-MM-DD" date. Shows "Jun 3" for current year, "Jun 3 '25" for past years. */
function dateLabel(date: string): string {
  const yr = parseInt(date.slice(0, 4));
  const mo = parseInt(date.slice(5, 7)) - 1;
  const dy = parseInt(date.slice(8, 10));
  const thisYear = new Date().getFullYear();
  return yr === thisYear
    ? `${MON[mo]} ${dy}`
    : `${MON[mo]} ${dy} '${String(yr).slice(2)}`;
}

/** Builds portfolio value series with one point per daily snapshot (for 1D/1W chart granularity). */
export function generatePortfolioSeriesDaily(
  snapshots: SnapshotRow[],
  holdings: HoldingRow[] = [],
): PortfolioSeriesPoint[] {
  if (holdings.length === 0) return [];
  const earliest = holdings.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    holdings[0].buyDate,
  );
  const startDate = earliest.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const totalCost = Math.round(holdings.reduce((s, h) => s + h.costSGD, 0));
  const totalValue = Math.round(holdings.reduce((s, h) => s + h.valueSGD, 0));

  if (snapshots.length > 0) {
    const byDate = new Map<string, SnapshotRow>();
    for (const s of snapshots) byDate.set(s.recordedDate, s);
    const points = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, s]) => ({
        label: dateLabel(date),
        date,
        v: Math.round(s.valueSgd),
      }));
    if (points.length < 2 && startDate < (points[0]?.date ?? today)) {
      points.unshift({
        label: dateLabel(startDate),
        date: startDate,
        v: totalCost,
      });
    }
    return points;
  }

  if (startDate >= today) return [];
  return [
    { label: dateLabel(startDate), date: startDate, v: totalCost },
    { label: dateLabel(today), date: today, v: totalValue },
  ];
}

function snapshotsByMonth(snapshots: SnapshotRow[]): Map<string, SnapshotRow> {
  const byMonth = new Map<string, SnapshotRow>();
  for (const s of snapshots) byMonth.set(s.recordedDate.slice(0, 7), s);
  return byMonth;
}

/** Builds portfolio value series from real snapshots, falling back to a
 *  2-point seed (cost at earliest buy → current value) when no snapshots exist. */
export function generatePortfolioSeries(
  snapshots: SnapshotRow[],
  holdings: HoldingRow[] = [],
): PortfolioSeriesPoint[] {
  if (holdings.length === 0) return [];
  const earliest = holdings.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    holdings[0].buyDate,
  );
  const startYm = earliest.slice(0, 7);
  const todayYm = new Date().toISOString().slice(0, 7);
  const totalCost = Math.round(holdings.reduce((s, h) => s + h.costSGD, 0));
  const totalValue = Math.round(holdings.reduce((s, h) => s + h.valueSGD, 0));

  if (snapshots.length > 0) {
    const points = Array.from(snapshotsByMonth(snapshots).entries()).map(
      ([ym, s]) => ({
        label: ymLabel(ym),
        date: ym,
        v: Math.round(s.valueSgd),
      }),
    );
    // Only 1 snapshot month → prepend cost-at-buy-date so the chart always has ≥ 2 points
    if (points.length < 2 && startYm < points[0]?.date) {
      points.unshift({ label: ymLabel(startYm), date: startYm, v: totalCost });
    }
    return points;
  }

  // Fallback: 2-point seed (cost at earliest buy date → current value today)
  if (startYm === todayYm) return [];
  return [
    { label: ymLabel(startYm), date: startYm, v: totalCost },
    { label: ymLabel(todayYm), date: todayYm, v: totalValue },
  ];
}

/** Builds per-currency FX impact series with one point per daily snapshot
 *  (labels are "YYYY-MM-DD", enabling 1D/1W chart granularity), falling back to a
 *  2-point seed (0 at earliest buy date → current impact today) when no snapshots exist. */
export function generateFxSeries(
  snapshots: SnapshotRow[],
  currencyCards: CurrencyCard[],
  holdings: HoldingRow[] = [],
): { series: FxSeriesPoint[]; fxLabels: string[] } {
  if (currencyCards.length === 0) return { series: [], fxLabels: [] };
  const activeCurrencies = currencyCards.map((c) => c.code.toLowerCase());

  // Fallback seed data (used for both 0-snapshot and 1-snapshot cases)
  const fxHoldings = holdings.filter((h) => h.currency !== "SGD");
  const earliest =
    fxHoldings.length > 0
      ? fxHoldings.reduce(
          (min, h) => (h.buyDate < min ? h.buyDate : min),
          fxHoldings[0].buyDate,
        )
      : new Date().toISOString().slice(0, 10);
  const startDate = earliest.slice(0, 10);

  if (snapshots.length > 0) {
    const byDate = new Map<string, SnapshotRow>();
    for (const s of snapshots) byDate.set(s.recordedDate, s);
    const fxLabels: string[] = [];
    const series: FxSeriesPoint[] = [];
    let i = 0;
    for (const [date, s] of [...byDate.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      fxLabels.push(date);
      const point: FxSeriesPoint = { i };
      for (const ccy of activeCurrencies)
        point[ccy] = Math.round(s.fxByCurrency[ccy] ?? 0);
      series.push(point);
      i++;
    }
    // Only 1 snapshot → prepend zero point so the chart always has ≥ 2 points
    if (series.length < 2 && startDate < fxLabels[0]) {
      const zeroPoint: FxSeriesPoint = { i: 0 };
      for (const ccy of activeCurrencies) zeroPoint[ccy] = 0;
      series.unshift(zeroPoint);
      fxLabels.unshift(startDate);
      for (let j = 0; j < series.length; j++) series[j].i = j;
    }
    return { series, fxLabels };
  }

  // Fallback: 2-point seed — FX impact was 0 at earliest buy, is current value today
  if (fxHoldings.length === 0) return { series: [], fxLabels: [] };

  const today = new Date().toISOString().slice(0, 10);
  const currentImpact: Record<string, number> = {};
  for (const c of currencyCards)
    currentImpact[c.code.toLowerCase()] = Math.round(c.impact);

  const zeroPoint: FxSeriesPoint = { i: 0 };
  const nowPoint: FxSeriesPoint = { i: 1 };
  for (const ccy of activeCurrencies) {
    zeroPoint[ccy] = 0;
    nowPoint[ccy] = currentImpact[ccy] ?? 0;
  }

  if (startDate >= today) return { series: [], fxLabels: [] };
  return { series: [zeroPoint, nowPoint], fxLabels: [startDate, today] };
}
