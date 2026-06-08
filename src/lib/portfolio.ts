import type { HoldingRow } from "@/types/holding";
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

export function computeHeroStats(holdings: HoldingRow[]): HeroStats {
  const total = holdings.reduce((s, h) => s + h.valueSGD, 0);
  const cost = holdings.reduce((s, h) => s + h.costSGD, 0);
  const totalGain = total - cost;
  const totalGainPct = cost > 0 ? (totalGain / cost) * 100 : 0;
  const fxImpact = holdings.reduce((s, h) => s + h.fxGain, 0);
  const fxPct = cost > 0 ? (fxImpact / cost) * 100 : 0;
  const neutral = total - fxImpact;

  return {
    total,
    dayChange: 0,
    dayPct: 0,
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
    USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", AUD: "🇦🇺", INR: "🇮🇳", JPY: "🇯🇵",
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

export function generatePortfolioSeries(total: number): PortfolioSeriesPoint[] {
  const start = total * 0.82;
  const series: PortfolioSeriesPoint[] = [];
  let yr = 2023, mo = 0;
  for (let i = 0; i < 42; i++) {
    const t = i / 41;
    const trend = start + (total - start) * (t * 0.55 + Math.pow(t, 1.7) * 0.45);
    const wob = Math.sin(i * 0.7) * (total * 0.013) + Math.sin(i * 1.9 + 1) * (total * 0.007) + Math.sin(i * 0.33) * (total * 0.009);
    const v = Math.round((trend + wob) / 100) * 100;
    series.push({ label: `${MON[mo]} ${String(yr).slice(2)}`, v });
    mo++;
    if (mo > 11) { mo = 0; yr++; }
  }
  series[series.length - 1].v = Math.round(total);
  return series;
}

export function generateFxSeries(currencyCards: CurrencyCard[]): FxSeriesPoint[] {
  const finals: Record<string, number> = { usd: 0, eur: 0, aud: 0, inr: 0 };
  for (const c of currencyCards) {
    const key = c.code.toLowerCase();
    if (key in finals) finals[key] = Math.round(c.impact);
  }

  const series: FxSeriesPoint[] = [];
  for (let i = 0; i < 42; i++) {
    const t = i / 41;
    const ease = t * t * (3 - 2 * t); // smoothstep
    const wobFor = (val: number, seed: number) =>
      Math.sin(i * 0.6 + seed) * (Math.abs(val) * 0.07);
    series.push({
      i,
      usd: Math.round(finals.usd * ease + wobFor(finals.usd, 0)),
      eur: Math.round(finals.eur * ease + wobFor(finals.eur, 1)),
      aud: Math.round(finals.aud * ease + wobFor(finals.aud, 2)),
      inr: Math.round(finals.inr * ease + wobFor(finals.inr, 3)),
    });
  }
  // pin last point to exact finals
  const last = series[series.length - 1];
  last.usd = finals.usd;
  last.eur = finals.eur;
  last.aud = finals.aud;
  last.inr = finals.inr;

  return series;
}
