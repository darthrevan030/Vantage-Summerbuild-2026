export interface HeroStats {
  total: number;
  dayChange: number;
  dayPct: number;
  totalGain: number;
  totalGainPct: number;
  fxImpact: number;
  fxPct: number;
  neutral: number;
  updated: string;
}

export interface MoverItem {
  name: string;
  ticker: string;
  asset: number;
  fx: number;
}

export interface CurrencyCard {
  code: string;
  flag: string;
  exposure: number;
  exposurePct: number;
  avg: number;
  cur: number;
  deltaPct: number;
  impact: number;
  dir: "pos" | "neg";
  spark: number[];
}

export interface WaterfallItem {
  code: string;
  value: number;
  dir: "pos" | "neg";
}

export interface AllocationSlice {
  label: string;
  value: number;
  color: string;
}

export interface PortfolioSeriesPoint {
  label: string;
  v: number;
}

export interface FxSeriesPoint {
  [key: string]: number;
  i: number;
  usd: number;
  eur: number;
  aud: number;
  inr: number;
}
