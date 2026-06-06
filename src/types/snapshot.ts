export interface PortfolioSnapshot {
  id: string;
  userId: string;
  snapshotDate: string;
  totalValueSGD: number;
  totalCostSGD: number;
  totalGainSGD: number;
  totalGainPct: number;
  fxImpactSGD: number;
  fxImpactPct: number;
  dayChangeSGD: number;
  dayChangePct: number;
  createdAt: string;
}
