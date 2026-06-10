"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { NerveBar } from "@/components/NerveBar";
import { TabBar } from "@/components/TabBar";
import { SummaryRail } from "@/components/SummaryRail";
import { TweaksPanel } from "@/components/TweaksPanel";
import { PortfolioProvider } from "@/context/portfolio";
import { ToastContainer } from "react-toastify";
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
  portfolioSeriesDaily: PortfolioSeriesPoint[];
  fxSeries: FxSeriesPoint[];
  fxLabels: string[];
  fxColors: Record<string, string>;
  baseFxRates: Record<string, number>;
  initialDisplayName: string;
  initialBaseCurrency: string;
  initialRole: string;
  children: React.ReactNode;
}

export function DashboardShell({
  holdings, hero, assetAllocation, geoAllocation,
  movers, currencyCards, waterfallData,
  portfolioSeries, portfolioSeriesDaily, fxSeries, fxLabels, fxColors, baseFxRates,
  initialDisplayName, initialBaseCurrency, initialRole,
  children,
}: DashboardShellProps) {
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const showSidebar = !["/overview", "/settings", "/admin"].includes(pathname);

  return (
    <PortfolioProvider value={{
      holdings, hero, assetAllocation, geoAllocation,
      movers, currencyCards, waterfallData,
      portfolioSeries, portfolioSeriesDaily, fxSeries, fxLabels, fxColors, baseFxRates,
      initialDisplayName, initialBaseCurrency, initialRole,
    }}>
      <div className="app">
        <NerveBar
          hero={hero}
          animate
          onTweaksToggle={() => setTweaksOpen((o) => !o)}
          onHamburger={() => setMobileNavOpen(true)}
        />
        <TabBar
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          onTweaksToggle={() => setTweaksOpen((o) => !o)}
        />
        <div className="body">
          {showSidebar && <SummaryRail />}
          <main className={"content" + (showSidebar ? "" : " nosb")} key={pathname}>
            {children}
          </main>
        </div>
        <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} />
        <ToastContainer position="bottom-right" autoClose={3500} theme="dark" newestOnTop />
      </div>
    </PortfolioProvider>
  );
}
