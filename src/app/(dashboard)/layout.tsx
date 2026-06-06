import { SEED } from "@/lib/seed";
import { computeHeroStats, computeAllocationByAsset, computeAllocationByGeo } from "@/lib/portfolio";
import { DashboardShell } from "@/components/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const holdings = SEED;
  const hero = computeHeroStats(holdings);
  const assetAllocation = computeAllocationByAsset(holdings);
  const geoAllocation = computeAllocationByGeo(holdings);

  return (
    <DashboardShell
      holdings={holdings}
      hero={hero}
      assetAllocation={assetAllocation}
      geoAllocation={geoAllocation}
    >
      {children}
    </DashboardShell>
  );
}
