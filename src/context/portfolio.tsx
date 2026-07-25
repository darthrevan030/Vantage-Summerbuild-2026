"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { HoldingRow } from "@/types/holding";
import type { ClosedPosition } from "@/types/realized";
import type { CostBasisMethod } from "@/types/settings";
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
  closedPositions: ClosedPosition[];
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
  costBasisMethod: CostBasisMethod;
  trackCash: boolean;
  setDisplayName: (v: string) => void;
  setBaseCurrency: (v: string) => void;
  setCostBasisMethod: (v: CostBasisMethod) => void;
  setTrackCash: (v: boolean) => void;
  // derived converters
  toBase: (sgdVal: number) => number;
  fmtVal: (sgdVal: number) => string;
  fmtSigned: (sgdVal: number) => string;
}

interface ProviderProps {
  value: Omit<
    PortfolioContextValue,
    | "displayName"
    | "baseCurrency"
    | "role"
    | "costBasisMethod"
    | "trackCash"
    | "setDisplayName"
    | "setBaseCurrency"
    | "setCostBasisMethod"
    | "setTrackCash"
    | "toBase"
    | "fmtVal"
    | "fmtSigned"
  > & {
    initialDisplayName: string;
    initialBaseCurrency: string;
    initialRole: string;
    initialCostBasisMethod: CostBasisMethod;
    initialTrackCash: boolean;
  };
  children: React.ReactNode;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ value, children }: ProviderProps) {
  const [displayName, setDisplayName] = useState(value.initialDisplayName);
  const [baseCurrency, setBaseCurrency] = useState(value.initialBaseCurrency);
  const [costBasisMethod, setCostBasisMethod] = useState(
    value.initialCostBasisMethod,
  );
  const [trackCash, setTrackCash] = useState(value.initialTrackCash);
  const role = value.initialRole;

  const toBase = useCallback(
    (sgdVal: number) => {
      const rate = value.baseFxRates[baseCurrency] ?? 1;
      return sgdVal / rate;
    },
    [baseCurrency, value.baseFxRates],
  );

  const fmtVal = useCallback(
    (sgdVal: number) => ccyFmt(toBase(sgdVal), baseCurrency),
    [toBase, baseCurrency],
  );

  const fmtSigned = useCallback(
    (sgdVal: number) => ccySigned(toBase(sgdVal), baseCurrency),
    [toBase, baseCurrency],
  );

  const ctx: PortfolioContextValue = {
    ...value,
    displayName,
    baseCurrency,
    role,
    costBasisMethod,
    trackCash,
    setDisplayName,
    setBaseCurrency,
    setCostBasisMethod,
    setTrackCash,
    toBase,
    fmtVal,
    fmtSigned,
  };

  return (
    <PortfolioContext.Provider value={ctx}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext);
  if (!ctx)
    throw new Error("usePortfolio must be used within PortfolioProvider");
  return ctx;
}
