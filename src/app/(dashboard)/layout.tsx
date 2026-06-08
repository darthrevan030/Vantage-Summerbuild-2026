import { fetchHoldings } from "@/lib/supabase/data";
import {
  computeHeroStats,
  computeAllocationByAsset,
  computeAllocationByGeo,
  computeMovers,
  computeCurrencyCards,
  computeWaterfall,
  generatePortfolioSeries,
  generateFxSeries,
} from "@/lib/portfolio";
import { DashboardShell } from "@/components/DashboardShell";
import { FX_COLORS } from "@/context/portfolio";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const holdings = await fetchHoldings();

  const hero = computeHeroStats(holdings);
  const assetAllocation = computeAllocationByAsset(holdings);
  const geoAllocation = computeAllocationByGeo(holdings);
  const movers = computeMovers(holdings);
  const currencyCards = computeCurrencyCards(holdings);
  const waterfallData = computeWaterfall(currencyCards);
  const portfolioSeries = generatePortfolioSeries(hero.total);
  const fxSeries = generateFxSeries(currencyCards);

  return (
    <DashboardShell
      holdings={holdings}
      hero={hero}
      assetAllocation={assetAllocation}
      geoAllocation={geoAllocation}
      movers={movers}
      currencyCards={currencyCards}
      waterfallData={waterfallData}
      portfolioSeries={portfolioSeries}
      fxSeries={fxSeries}
      fxColors={FX_COLORS}
    >
      {children}
    </DashboardShell>
  );
}
