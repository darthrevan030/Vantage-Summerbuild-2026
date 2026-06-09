"use client";

import { createContext, useContext, useState, useCallback } from "react";
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
import { ccyFmt, ccySigned } from "@/lib/formatters";

interface PortfolioContextValue {
  holdings: HoldingRow[];
  hero: HeroStats;
  assetAllocation: AllocationSlice[];
  geoAllocation: AllocationSlice[];
  movers: { gainers: MoverItem[]; losers: MoverItem[] };
  currencyCards: CurrencyCard[];
  waterfallData: WaterfallItem[];
  portfolioSeries: PortfolioSeriesPoint[];
  portfolioSeriesDaily: PortfolioSeriesPoint[];
  fxSeries: FxSeriesPoint[];
  fxLabels: string[];
  fxColors: Record<string, string>;
  baseFxRates: Record<string, number>;
  // user settings — mutable
  displayName: string;
  baseCurrency: string;
  role: string;
  setDisplayName: (v: string) => void;
  setBaseCurrency: (v: string) => void;
  // derived converters
  toBase: (sgdVal: number) => number;
  fmtVal: (sgdVal: number) => string;
  fmtSigned: (sgdVal: number) => string;
}

interface ProviderProps {
  value: Omit<PortfolioContextValue, "displayName" | "baseCurrency" | "role" | "setDisplayName" | "setBaseCurrency" | "toBase" | "fmtVal" | "fmtSigned"> & {
    initialDisplayName: string;
    initialBaseCurrency: string;
    initialRole: string;
  };
  children: React.ReactNode;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ value, children }: ProviderProps) {
  const [displayName, setDisplayName] = useState(value.initialDisplayName);
  const [baseCurrency, setBaseCurrency] = useState(value.initialBaseCurrency);
  const role = value.initialRole;

  const toBase = useCallback(
    (sgdVal: number) => {
      const rate = value.baseFxRates[baseCurrency] ?? 1;
      return sgdVal / rate;
    },
    [baseCurrency, value.baseFxRates]
  );

  const fmtVal = useCallback(
    (sgdVal: number) => ccyFmt(toBase(sgdVal), baseCurrency),
    [toBase, baseCurrency]
  );

  const fmtSigned = useCallback(
    (sgdVal: number) => ccySigned(toBase(sgdVal), baseCurrency),
    [toBase, baseCurrency]
  );

  const ctx: PortfolioContextValue = {
    ...value,
    displayName,
    baseCurrency,
    role,
    setDisplayName,
    setBaseCurrency,
    toBase,
    fmtVal,
    fmtSigned,
  };

  return <PortfolioContext.Provider value={ctx}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio must be used within PortfolioProvider");
  return ctx;
}
