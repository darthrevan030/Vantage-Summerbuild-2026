export const dynamic = "force-dynamic";

import {
  fetchHoldings,
  fetchUserSettings,
  fetchSnapshots,
  fetchRealizedLots,
} from "@/lib/supabase/data";
import { reconcileRealizedLots } from "@/lib/reconcile-realized";
import { reconcileCashLedger } from "@/lib/reconcile-cash";
import {
  computeHeroStats,
  computeAllocationByAsset,
  computeAllocationByGeo,
  computeMovers,
  computeCurrencyCards,
  computeWaterfall,
  computeRealizedSummary,
  generatePortfolioSeries,
  generatePortfolioSeriesDaily,
  generateFxSeries,
  buildFxColors,
  buildBaseFxRates,
} from "@/lib/portfolio";
import { DashboardShell } from "@/components/DashboardShell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [holdings, userSettings, snapshots] = await Promise.all([
    user ? fetchHoldings(user.id) : Promise.resolve([]),
    user
      ? fetchUserSettings(user.id)
      : Promise.resolve({
          displayName: "",
          baseCurrency: "SGD",
          role: "user",
          costBasisMethod: "fifo" as const,
          trackCash: true,
        }),
    user ? fetchSnapshots(user.id) : Promise.resolve([]),
  ]);

  if (user) {
    const { warnings } = await reconcileRealizedLots(
      user.id,
      userSettings.costBasisMethod,
    );
    for (const w of warnings) console.warn("[reconcileRealizedLots]", w);
  }
  if (user) {
    await reconcileCashLedger(user.id, userSettings.trackCash, holdings);
  }
  const realizedLots = user ? await fetchRealizedLots(user.id) : [];

  const hero = computeHeroStats(holdings, snapshots, realizedLots);
  const closedPositions = computeRealizedSummary(holdings, realizedLots);
  const assetAllocation = computeAllocationByAsset(holdings);
  const geoAllocation = computeAllocationByGeo(holdings);
  const movers = computeMovers(holdings);
  const currencyCards = computeCurrencyCards(holdings);
  const waterfallData = computeWaterfall(currencyCards);
  const portfolioSeries = generatePortfolioSeries(snapshots, holdings);
  const portfolioSeriesDaily = generatePortfolioSeriesDaily(
    snapshots,
    holdings,
  );
  const { series: fxSeries, fxLabels } = generateFxSeries(
    snapshots,
    currencyCards,
    holdings,
  );
  const fxColors = buildFxColors(currencyCards);
  const baseFxRates = buildBaseFxRates(currencyCards);

  return (
    <DashboardShell
      holdings={holdings}
      hero={hero}
      closedPositions={closedPositions}
      assetAllocation={assetAllocation}
      geoAllocation={geoAllocation}
      movers={movers}
      currencyCards={currencyCards}
      waterfallData={waterfallData}
      portfolioSeries={portfolioSeries}
      portfolioSeriesDaily={portfolioSeriesDaily}
      fxSeries={fxSeries}
      fxLabels={fxLabels}
      fxColors={fxColors}
      baseFxRates={baseFxRates}
      initialDisplayName={userSettings.displayName}
      initialBaseCurrency={userSettings.baseCurrency}
      initialRole={userSettings.role}
      initialCostBasisMethod={userSettings.costBasisMethod}
      initialTrackCash={userSettings.trackCash}
    >
      {children}
    </DashboardShell>
  );
}
