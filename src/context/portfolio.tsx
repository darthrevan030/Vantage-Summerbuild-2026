"use client";

import { createContext, useContext } from "react";
import type { HoldingRow } from "@/types/holding";
import type {
  HeroStats,
  AllocationSlice,
  MoverItem,
  CurrencyCard,
  WaterfallItem,
  PortfolioSeriesPoint,
  FxSeriesPoint,
} from "@/types/portfolio";

export const FX_COLORS: Record<string, string> = {
  usd: "#6fb0ff",
  eur: "#46d8a0",
  aud: "#f0bd8a",
  inr: "#b79cff",
};

interface PortfolioContextValue {
  holdings: HoldingRow[];
  hero: HeroStats;
  assetAllocation: AllocationSlice[];
  geoAllocation: AllocationSlice[];
  movers: { gainers: MoverItem[]; losers: MoverItem[] };
  currencyCards: CurrencyCard[];
  waterfallData: WaterfallItem[];
  portfolioSeries: PortfolioSeriesPoint[];
  fxSeries: FxSeriesPoint[];
  fxColors: Record<string, string>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({
  value,
  children,
}: {
  value: PortfolioContextValue;
  children: React.ReactNode;
}) {
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio must be used within PortfolioProvider");
  return ctx;
}
