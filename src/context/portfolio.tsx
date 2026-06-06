"use client";

import { createContext, useContext } from "react";
import type { HoldingRow } from "@/types/holding";
import type { HeroStats, AllocationSlice } from "@/types/portfolio";

interface PortfolioContextValue {
  holdings: HoldingRow[];
  hero: HeroStats;
  assetAllocation: AllocationSlice[];
  geoAllocation: AllocationSlice[];
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
