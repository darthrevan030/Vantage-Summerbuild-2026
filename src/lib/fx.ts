import type { Holding } from "@/types/holding";

export function computeCurrentValueSGD(h: Holding): number {
  return h.units * h.currentPrice * h.currentFxRate;
}

export function computeCostBasisSGD(h: Holding): number {
  return h.units * h.buyPrice * h.buyFxRate;
}

export function computeAssetGainSGD(h: Holding): number {
  return h.units * (h.currentPrice - h.buyPrice) * h.currentFxRate;
}

export function computeFxGainSGD(h: Holding): number {
  return h.units * h.buyPrice * (h.currentFxRate - h.buyFxRate);
}

export function computeTotalGainSGD(h: Holding): number {
  return computeCurrentValueSGD(h) - computeCostBasisSGD(h);
}
