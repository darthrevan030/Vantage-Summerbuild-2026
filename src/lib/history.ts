import { NON_GROUPABLE } from "@/lib/positions";

export interface LotLite {
  id: string;
  ticker: string;
  transactionType: "buy" | "sell";
  units: number;
  buyDate: string;
  buyPrice: number;
  buyFxRate: number;
  fees: number;
  currency: string;
}

export interface SnapshotAgg {
  valueSgd: number;
  costSgd: number;
  fxImpactSgd: number;
  fxByCurrency: Record<string, number>;
}

// Net held quantity of a single position as of `date`: buys minus sells whose
// trade date is on or before `date`, floored at zero.
export function netUnitsAsOf(lots: LotLite[], date: string): number {
  let n = 0;
  for (const l of lots) {
    if (l.buyDate > date) continue;
    n += l.transactionType === "sell" ? -l.units : l.units;
  }
  return Math.max(n, 0);
}

// The time-sliced, re-priced analogue of netAggregate (group-holdings.ts):
// one net position per instrument as of `date`, valued at the raw price/FX for
// that date, cost at the weighted-average of the BUY lots only.
export function computeSnapshotAsOf(
  lots: LotLite[],
  date: string,
  priceOf: (ticker: string, date: string) => number,
  fxOf: (ccy: string, date: string) => number,
): SnapshotAgg {
  // Same grouping key as bucketByPosition: named tickers merge; untickered
  // physical assets (Gold/RE) stay separate by lot id.
  const groups = new Map<string, LotLite[]>();
  for (const l of lots) {
    if (l.buyDate > date) continue;
    const k = NON_GROUPABLE.has(l.ticker) ? l.id : l.ticker;
    const arr = groups.get(k);
    if (arr) arr.push(l);
    else groups.set(k, [l]);
  }

  let valueSgd = 0;
  let costSgd = 0;
  let fxImpactSgd = 0;
  const fxByCurrency: Record<string, number> = {};

  for (const g of groups.values()) {
    const netUnits = netUnitsAsOf(g, date);
    if (netUnits <= 0) continue;

    let buyUnits = 0;
    let pxWeighted = 0;
    let fxWeighted = 0;
    let feesTotal = 0;
    for (const l of g) {
      if (l.transactionType === "sell") continue;
      buyUnits += l.units;
      pxWeighted += l.units * l.buyPrice;
      fxWeighted += l.units * l.buyFxRate;
      feesTotal += l.fees;
    }
    if (buyUnits === 0) continue;

    const avgBuyPx = pxWeighted / buyUnits;
    const avgBuyFx = fxWeighted / buyUnits;
    const avgFeePerUnit = feesTotal / buyUnits;

    const first = g[0];
    const isSgd = first.currency === "SGD";
    // Untickered physical assets have no market feed → valued at their own cost.
    const px = NON_GROUPABLE.has(first.ticker)
      ? avgBuyPx
      : priceOf(first.ticker, date);
    const fx = isSgd ? 1 : fxOf(first.currency, date);

    valueSgd += netUnits * px * fx;
    costSgd += netUnits * (avgBuyPx + avgFeePerUnit) * avgBuyFx;

    if (!isSgd) {
      const impact = netUnits * avgBuyPx * (fx - avgBuyFx);
      fxImpactSgd += impact;
      const key = first.currency.toLowerCase();
      fxByCurrency[key] = (fxByCurrency[key] ?? 0) + impact;
    }
  }

  return { valueSgd, costSgd, fxImpactSgd, fxByCurrency };
}
