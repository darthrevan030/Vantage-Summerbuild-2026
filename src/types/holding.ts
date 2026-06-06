export interface HoldingDetail {
  buyUnits: number;
  buyPx: number;
  buyDate: string;
  buyFx: number;
  curPx: number;
  curFx: number;
  ccy: string;
}

export interface Holding {
  id: string;
  userId: string;
  ticker: string;
  name: string;
  assetType: string;
  broker: string;
  strategy: string;
  units: number;
  currency: string;
  flag: string;
  icon: string;
  buyPrice: number;
  buyDate: string;
  buyFxRate: number;
  currentPrice: number;
  currentFxRate: number;
  sparkData: number[];
  createdAt: string;
  updatedAt: string;
}

export interface HoldingRow extends Holding {
  costSGD: number;
  valueSGD: number;
  assetGain: number;
  fxGain: number;
  totalPct: number;
  detail: HoldingDetail;
}
