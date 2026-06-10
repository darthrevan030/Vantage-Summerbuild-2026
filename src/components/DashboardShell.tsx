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
      <div className="flex min-h-screen flex-col">
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
        <div className="flex min-w-0 flex-1 items-start">
          {showSidebar && <SummaryRail />}
          <main
            className={
              "min-w-0 flex-1 px-[30px] pb-20 pt-[26px] " +
              "max-bp900:px-[22px] max-bp900:pb-[60px] max-bp900:pt-5 " +
              "max-bp768:px-4 max-bp768:pt-4 max-bp600:px-3 max-bp600:pt-3 max-bp380:px-2 max-bp380:pt-2 " +
              (showSidebar ? "" : "[&>*]:mx-auto [&>*]:max-w-[1600px]")
            }
            key={pathname}
          >
            {children}
          </main>
        </div>
        <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} />
      </div>
    </PortfolioProvider>
  );
}
