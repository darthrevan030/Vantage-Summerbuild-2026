import type { CostBasisMethod } from "@/types/settings";

export interface RealizedLot {
  id: string;
  instrumentId: string;
  ticker: string;
  name: string;
  assetType: string;
  currency: string;
  flag: string;
  icon: string;
  sellLotId: string;
  buyLotId: string;
  method: CostBasisMethod;
  matchedQuantity: number;
  matchedBuyPrice: number;
  matchedBuyFx: number;
  sellPrice: number;
  sellFx: number;
  assetGainSgd: number;
  fxGainSgd: number;
  realizedDate: string;
}

export interface ClosedPosition {
  ticker: string;
  name: string;
  assetType: string;
  currency: string;
  flag: string;
  icon: string;
  totalQuantitySold: number;
  realizedGainSgd: number;
  assetGainSgd: number;
  fxGainSgd: number;
  lastSaleDate: string;
}
