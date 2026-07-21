import type { Holding } from "@/types/holding";

export function computeCurrentValueSGD(h: Holding): number {
  return h.units * h.currentPrice * h.currentFxRate;
}

// Cost basis includes the buy-side fee, converted to SGD at the buy's own FX
// rate — a fee is a fixed historical outlay, valued once at the rate in force
// when it was paid.
export function computeCostBasisSGD(h: Holding): number {
  return (h.units * h.buyPrice + h.fees) * h.buyFxRate;
}

// Fee is subtracted here (not from fxGain) and valued at buyFxRate, matching
// computeCostBasisSGD, so assetGain + fxGain telescopes exactly to
// computeCurrentValueSGD(h) - computeCostBasisSGD(h).
export function computeAssetGainSGD(h: Holding): number {
  return (
    h.units * (h.currentPrice - h.buyPrice) * h.currentFxRate -
    h.fees * h.buyFxRate
  );
}

export function computeFxGainSGD(h: Holding): number {
  return h.units * h.buyPrice * (h.currentFxRate - h.buyFxRate);
}
