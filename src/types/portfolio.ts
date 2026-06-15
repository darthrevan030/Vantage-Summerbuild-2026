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
  portfolioYield: number;
  annualIncome: number;
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
  date: string; // "YYYY-MM" (monthly) or "YYYY-MM-DD" (daily) — used for date-range filtering
  v: number;
}

export interface FxSeriesPoint {
  [key: string]: number;
  i: number;
}

export interface AllocationBySource {
  source: string;
  valueSGD: number;
  costSGD: number;
  pnl: number;
  count: number;
}

export interface PortfolioAnalytics {
  cagr: number;
  actualSharpe: number;
  annualisedVol: number;
  maxDrawdown: number;
  maxDrawdownDate: string;
  bestDayReturn: number;
  bestDayDate: string;
  worstDayReturn: number;
  worstDayDate: string;
  days: number;
  series: { date: string; value: number; cost: number }[];
}

export interface CashBalance {
  currency: string;
  amount: number;
}

export interface CpfBalance {
  oa: number;
  sa: number;
  ma: number;
  ra: number;
  asAtDate: string;
}

export interface SourceYield {
  source: string;
  yieldPct: number;
  annualIncome: number;
  cagr5yr: number | null;
}
