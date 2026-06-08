import { fetchHoldings, fetchUserSettings, fetchSnapshots } from "@/lib/supabase/data";
import {
  computeHeroStats,
  computeAllocationByAsset,
  computeAllocationByGeo,
  computeMovers,
  computeCurrencyCards,
  computeWaterfall,
  generatePortfolioSeries,
  generateFxSeries,
  buildFxColors,
  buildBaseFxRates,
} from "@/lib/portfolio";
import { DashboardShell } from "@/components/DashboardShell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [holdings, userSettings, snapshots] = await Promise.all([
    fetchHoldings(user?.id),
    user ? fetchUserSettings(user.id) : Promise.resolve({ displayName: "", baseCurrency: "SGD", role: "user" }),
    user ? fetchSnapshots(user.id) : Promise.resolve([]),
  ]);

  const hero = computeHeroStats(holdings, snapshots);
  const assetAllocation = computeAllocationByAsset(holdings);
  const geoAllocation = computeAllocationByGeo(holdings);
  const movers = computeMovers(holdings);
  const currencyCards = computeCurrencyCards(holdings);
  const waterfallData = computeWaterfall(currencyCards);
  const portfolioSeries = generatePortfolioSeries(snapshots, holdings);
  const { series: fxSeries, fxLabels } = generateFxSeries(snapshots, currencyCards, holdings);
  const fxColors = buildFxColors(currencyCards);
  const baseFxRates = buildBaseFxRates(currencyCards);

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
      fxLabels={fxLabels}
      fxColors={fxColors}
      baseFxRates={baseFxRates}
      initialDisplayName={userSettings.displayName}
      initialBaseCurrency={userSettings.baseCurrency}
      initialRole={userSettings.role}
    >
      {children}
    </DashboardShell>
  );
}
