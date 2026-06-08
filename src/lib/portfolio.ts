import type { HoldingRow } from "@/types/holding";
import type { SnapshotRow } from "@/lib/supabase/data";
import type {
  HeroStats,
  MoverItem,
  CurrencyCard,
  WaterfallItem,
  AllocationSlice,
  PortfolioSeriesPoint,
  FxSeriesPoint,
} from "@/types/portfolio";
import {
  computeCurrentValueSGD,
  computeCostBasisSGD,
  computeAssetGainSGD,
  computeFxGainSGD,
} from "./fx";

const PAL = ["#b79cff", "#5fd0c6", "#6fb0ff", "#f4a6cf", "#8b8bff", "#f0bd8a"];

const FX_COLOR_PALETTE = ["#6fb0ff", "#46d8a0", "#f0bd8a", "#b79cff", "#f4a6cf", "#8b8bff"];

const FALLBACK_FX_RATES: Record<string, number> = {
  SGD: 1, USD: 1.36, EUR: 1.51, GBP: 1.72,
  AUD: 0.88, JPY: 0.0091, INR: 0.016, HKD: 0.174,
};

export function buildFxColors(cards: CurrencyCard[]): Record<string, string> {
  const result: Record<string, string> = {};
  cards.forEach((c, i) => {
    result[c.code.toLowerCase()] = FX_COLOR_PALETTE[i % FX_COLOR_PALETTE.length];
  });
  return result;
}

/** Returns SGD-per-unit rates. Portfolio rates take priority; static fallbacks fill the gaps. */
export function buildBaseFxRates(cards: CurrencyCard[]): Record<string, number> {
  const rates: Record<string, number> = { ...FALLBACK_FX_RATES };
  for (const c of cards) {
    if (c.cur > 0) rates[c.code] = c.cur;
  }
  return rates;
}

export function computeHeroStats(holdings: HoldingRow[], snapshots: SnapshotRow[] = []): HeroStats {
  const total = holdings.reduce((s, h) => s + h.valueSGD, 0);
  const cost = holdings.reduce((s, h) => s + h.costSGD, 0);
  const totalGain = total - cost;
  const totalGainPct = cost > 0 ? (totalGain / cost) * 100 : 0;
  const fxImpact = holdings.reduce((s, h) => s + h.fxGain, 0);
  const fxPct = cost > 0 ? (fxImpact / cost) * 100 : 0;
  const neutral = total - fxImpact;

  // Day change from the most recent two distinct-date snapshots
  const today = new Date().toISOString().slice(0, 10);
  const prevSnap = [...snapshots].reverse().find((s) => s.recordedDate < today);
  const dayChange = prevSnap ? total - prevSnap.valueSgd : 0;
  const dayPct = prevSnap && prevSnap.valueSgd > 0 ? (dayChange / prevSnap.valueSgd) * 100 : 0;

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
  };
}

export function computeAllocationByAsset(holdings: HoldingRow[]): AllocationSlice[] {
  const totals: Record<string, number> = {};
  const grandTotal = holdings.reduce((s, h) => s + h.valueSGD, 0);
  for (const h of holdings) {
    totals[h.assetType] = (totals[h.assetType] ?? 0) + h.valueSGD;
  }
  return Object.entries(totals).map(([label, value], i) => ({
    label,
    value: Math.round((value / grandTotal) * 100),
    color: PAL[i % PAL.length],
  }));
}

export function computeAllocationByGeo(holdings: HoldingRow[]): AllocationSlice[] {
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
  };
  const totals: Record<string, number> = {};
  const grandTotal = holdings.reduce((s, h) => s + h.valueSGD, 0);
  for (const h of holdings) {
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
  const items: MoverItem[] = holdings.map((h) => {
    const cost = computeCostBasisSGD(h);
    const asset = cost > 0 ? (computeAssetGainSGD(h) / cost) * 100 : 0;
    const fx = cost > 0 ? (computeFxGainSGD(h) / cost) * 100 : 0;
    return { name: h.name, ticker: h.ticker, asset, fx };
  });
  const sorted = [...items].sort((a, b) => (b.asset + b.fx) - (a.asset + a.fx));
  return {
    gainers: sorted.filter((m) => m.asset + m.fx >= 0),
    losers: sorted.filter((m) => m.asset + m.fx < 0).reverse(),
  };
}

export function computeCurrencyCards(holdings: HoldingRow[]): CurrencyCard[] {
  const groups: Record<string, HoldingRow[]> = {};
  for (const h of holdings) {
    if (h.currency === "SGD") continue;
    (groups[h.currency] ??= []).push(h);
  }
  const flags: Record<string, string> = {
    USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", AUD: "🇦🇺", INR: "🇮🇳", JPY: "🇯🇵", HKD: "🇭🇰",
  };
  const grandTotal = holdings.reduce((s, h) => s + h.valueSGD, 0);

  return Object.entries(groups).map(([code, hs]) => {
    const exposure = hs.reduce((s, h) => s + h.valueSGD, 0);
    const avgFx = hs.reduce((s, h) => s + h.buyFxRate * h.valueSGD, 0) / exposure;
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

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ymLabel(ym: string): string {
  const yr = parseInt(ym.slice(0, 4));
  const mo = parseInt(ym.slice(5, 7)) - 1;
  return `${MON[mo]} ${String(yr).slice(2)}`;
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
  holdings: HoldingRow[] = []
): PortfolioSeriesPoint[] {
  if (snapshots.length > 0) {
    return Array.from(snapshotsByMonth(snapshots).entries()).map(([ym, s]) => ({
      label: ymLabel(ym),
      date: ym,
      v: Math.round(s.valueSgd),
    }));
  }

  // Fallback: 2-point seed from current holdings (cost at buy date → value today)
  if (holdings.length === 0) return [];
  const earliest = holdings.reduce((min, h) => (h.buyDate < min ? h.buyDate : min), holdings[0].buyDate);
  const startYm = earliest.slice(0, 7);
  const todayYm = new Date().toISOString().slice(0, 7);
  const totalCost = Math.round(holdings.reduce((s, h) => s + h.costSGD, 0));
  const totalValue = Math.round(holdings.reduce((s, h) => s + h.valueSGD, 0));

  if (startYm === todayYm) {
    return [{ label: ymLabel(startYm), date: startYm, v: totalValue }];
  }
  return [
    { label: ymLabel(startYm), date: startYm, v: totalCost },
    { label: ymLabel(todayYm), date: todayYm, v: totalValue },
  ];
}

/** Builds per-currency FX impact series from real snapshots, falling back to a
 *  2-point seed (0 at earliest buy date → current impact today) when no snapshots exist. */
export function generateFxSeries(
  snapshots: SnapshotRow[],
  currencyCards: CurrencyCard[],
  holdings: HoldingRow[] = []
): { series: FxSeriesPoint[]; fxLabels: string[] } {
  if (currencyCards.length === 0) return { series: [], fxLabels: [] };
  const activeCurrencies = currencyCards.map((c) => c.code.toLowerCase());

  if (snapshots.length > 0) {
    const byMonth = snapshotsByMonth(snapshots);
    const fxLabels: string[] = [];
    const series: FxSeriesPoint[] = [];
    let i = 0;
    for (const [ym, s] of byMonth.entries()) {
      fxLabels.push(ym);
      const point: FxSeriesPoint = { i };
      for (const ccy of activeCurrencies) point[ccy] = Math.round(s.fxByCurrency[ccy] ?? 0);
      series.push(point);
      i++;
    }
    return { series, fxLabels };
  }

  // Fallback: 2-point seed — FX impact was 0 at earliest buy, is current value today
  const fxHoldings = holdings.filter((h) => h.currency !== "SGD");
  if (fxHoldings.length === 0) return { series: [], fxLabels: [] };

  const earliest = fxHoldings.reduce((min, h) => (h.buyDate < min ? h.buyDate : min), fxHoldings[0].buyDate);
  const startYm = earliest.slice(0, 7);
  const todayYm = new Date().toISOString().slice(0, 7);

  const currentImpact: Record<string, number> = {};
  for (const c of currencyCards) currentImpact[c.code.toLowerCase()] = Math.round(c.impact);

  const zeroPoint: FxSeriesPoint = { i: 0 };
  const nowPoint: FxSeriesPoint = { i: 1 };
  for (const ccy of activeCurrencies) {
    zeroPoint[ccy] = 0;
    nowPoint[ccy] = currentImpact[ccy] ?? 0;
  }

  if (startYm === todayYm) {
    return { series: [nowPoint], fxLabels: [todayYm] };
  }
  return { series: [zeroPoint, nowPoint], fxLabels: [startYm, todayYm] };
}
