"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { NerveBar } from "@/components/NerveBar";
import { TabBar } from "@/components/TabBar";
import { SummaryRail } from "@/components/SummaryRail";
import { TweaksPanel } from "@/components/TweaksPanel";
import { PortfolioProvider } from "@/context/portfolio";
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

interface DashboardShellProps {
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
  children: React.ReactNode;
}

export function DashboardShell({
  holdings, hero, assetAllocation, geoAllocation,
  movers, currencyCards, waterfallData,
  portfolioSeries, fxSeries, fxColors,
  children,
}: DashboardShellProps) {
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const pathname = usePathname();
  const showSidebar = pathname !== "/overview";

  return (
    <PortfolioProvider value={{
      holdings, hero, assetAllocation, geoAllocation,
      movers, currencyCards, waterfallData,
      portfolioSeries, fxSeries, fxColors,
    }}>
      <div className="app">
        <NerveBar hero={hero} animate onTweaksToggle={() => setTweaksOpen((o) => !o)} />
        <TabBar />
        <div className="body">
          {showSidebar && <SummaryRail />}
          <main className={"content" + (showSidebar ? "" : " nosb")} key={pathname}>
            {children}
          </main>
        </div>
        <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} />
      </div>
    </PortfolioProvider>
  );
}
