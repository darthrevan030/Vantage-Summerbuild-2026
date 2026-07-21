export type CostBasisMethod = "fifo" | "average" | "specific";

export interface UserSettings {
  displayName: string;
  baseCurrency: string;
  role: string;
  costBasisMethod: CostBasisMethod;
}
