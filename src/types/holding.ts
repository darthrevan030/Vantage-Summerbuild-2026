export type AssetType = "Equity" | "ETF" | "REIT" | "Gold" | "RE" | "Bond" | "T-Bill";
export type FundSource = "CPF" | "SRS" | "Cash" | "";

export const ASSET_TYPES: AssetType[] = ["Equity", "ETF", "REIT", "Gold", "RE", "Bond", "T-Bill"];
export const FIXED_INCOME_TYPES = new Set<AssetType>(["Bond", "T-Bill"]);

export interface HoldingDetail {
  buyUnits: number;
  buyPx: number;
  buyDate: string;
  buyFx: number;
  curPx: number;
  curFx: number;
  ccy: string;
}

export interface Holding {
  id: string;
  userId: string;
  ticker: string;
  name: string;
  assetType: string;
  broker: string;
  strategy: string;
  units: number;
  currency: string;
  flag: string;
  icon: string;
  buyPrice: number;
  buyDate: string;
  buyFxRate: number;
  currentPrice: number;
  currentFxRate: number;
  sparkData: number[];
  createdAt: string;
  updatedAt: string;
  priceRefreshedAt: string | null;
  // SGX feature fields
  source: string;
  dividendYield: number | null;
  dividendYieldAuto: number | null;
  prevPrice: number | null;
  prevPriceSource: string | null;
  maturityDate: string | null;
  parValue: number | null;
  couponRate: number | null;
  transactionType: "buy" | "sell";
  fees: number;
}

export interface HoldingRow extends Holding {
  costSGD: number;
  valueSGD: number;
  assetGain: number;
  fxGain: number;
  totalPct: number;
  detail: HoldingDetail;
}

export interface GroupedHolding {
  ticker: string;
  name: string;
  assetType: string;
  currency: string;
  flag: string;
  icon: string;
  lots: HoldingRow[];
  totalUnits: number;
  valueSGD: number;
  costSGD: number;
  assetGain: number;
  fxGain: number;
  totalPct: number;
  currentPrice: number;
  avgBuyPrice: number;
  sparkData: number[];
  // Derived from lots (first lot wins for per-ticker fields)
  source: string;
  dividendYield: number | null;
  dividendYieldAuto: number | null;
  prevPrice: number | null;
  prevPriceSource: string | null;
  maturityDate: string | null;
  parValue: number | null;
  couponRate: number | null;
}
