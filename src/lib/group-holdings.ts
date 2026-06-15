import type { HoldingRow, GroupedHolding } from "@/types/holding";
import { NON_GROUPABLE } from "@/lib/positions";

interface NetAgg {
  netUnits: number;
  costSGD: number;
  valueSGD: number;
  assetGain: number;
  fxGain: number;
  totalPct: number;
  avgBuyPx: number;
  avgBuyFx: number;
  curPx: number;
  curFx: number;
}

/**
 * Collapse a set of lots for one instrument into a single net position using
 * average-cost accounting: sells reduce the held quantity, and the remaining
 * cost basis is the value-weighted average of the BUY lots only (a sale never
 * changes your average cost — it just removes units at that average). The
 * asset/FX gain split mirrors the per-lot formulas in fx.ts, applied to the
 * net quantity against the weighted-average buy price and FX rate.
 */
function netAggregate(lots: HoldingRow[]): NetAgg {
  let buyUnits = 0;
  let sellUnits = 0;
  let pxWeighted = 0;
  let fxWeighted = 0;
  let curPx = 0;
  let curFx = 1;

  for (const l of lots) {
    if (l.transactionType === "sell") {
      sellUnits += l.units;
    } else {
      buyUnits += l.units;
      pxWeighted += l.units * l.buyPrice;
      fxWeighted += l.units * l.buyFxRate;
      // Same instrument across the group → same live quote/FX.
      curPx = l.currentPrice;
      curFx = l.currentFxRate;
    }
  }

  // No buys (only sells, or empty) → nothing held, no basis.
  if (buyUnits === 0) {
    const f = lots[0];
    return {
      netUnits: 0,
      costSGD: 0,
      valueSGD: 0,
      assetGain: 0,
      fxGain: 0,
      totalPct: 0,
      avgBuyPx: f?.buyPrice ?? 0,
      avgBuyFx: f?.buyFxRate ?? 1,
      curPx: f?.currentPrice ?? 0,
      curFx: f?.currentFxRate ?? 1,
    };
  }

  const avgBuyPx = pxWeighted / buyUnits;
  const avgBuyFx = fxWeighted / buyUnits;
  const netUnits = Math.max(buyUnits - sellUnits, 0);
  const costSGD = netUnits * avgBuyPx * avgBuyFx;
  const valueSGD = netUnits * curPx * curFx;
  const assetGain = netUnits * (curPx - avgBuyPx) * curFx;
  const fxGain = netUnits * avgBuyPx * (curFx - avgBuyFx);
  const totalPct = costSGD > 0 ? ((valueSGD - costSGD) / costSGD) * 100 : 0;

  return {
    netUnits,
    costSGD,
    valueSGD,
    assetGain,
    fxGain,
    totalPct,
    avgBuyPx,
    avgBuyFx,
    curPx,
    curFx,
  };
}

function bucketByPosition(rows: HoldingRow[]): Map<string, HoldingRow[]> {
  const map = new Map<string, HoldingRow[]>();
  for (const row of rows) {
    // untickered assets (Gold, RE) each get their own group; named tickers merge
    const k = NON_GROUPABLE.has(row.ticker) ? row.id : row.ticker;
    const bucket = map.get(k) ?? [];
    bucket.push(row);
    map.set(k, bucket);
  }
  return map;
}

export function groupHoldings(rows: HoldingRow[]): GroupedHolding[] {
  return Array.from(bucketByPosition(rows).values()).map((lots) => {
    const first = lots[0];
    const agg = netAggregate(lots);
    return {
      ticker: first.ticker,
      name: first.name,
      assetType: first.assetType,
      currency: first.currency,
      flag: first.flag,
      icon: first.icon,
      lots,
      totalUnits: agg.netUnits,
      valueSGD: agg.valueSGD,
      costSGD: agg.costSGD,
      assetGain: agg.assetGain,
      fxGain: agg.fxGain,
      totalPct: agg.totalPct,
      currentPrice: agg.curPx,
      avgBuyPrice: agg.avgBuyPx,
      sparkData: first.sparkData,
      source: first.source,
      dividendYield: first.dividendYield,
      dividendYieldAuto: first.dividendYieldAuto,
      prevPrice: first.prevPrice,
      prevPriceSource: first.prevPriceSource,
      maturityDate: first.maturityDate,
      parValue: first.parValue,
      couponRate: first.couponRate,
    };
  });
}

/**
 * Collapse raw lots into one synthetic HoldingRow per instrument, netted for
 * sells (buys − sells) at weighted-average cost. Fully-closed positions
 * (net ≤ 0) are dropped. This is what every portfolio aggregate should sum
 * over, so a recorded sale actually reduces totals/allocations rather than
 * inflating them. The holdings table still renders raw lots for the lot view.
 */
export function toNetPositions(rows: HoldingRow[]): HoldingRow[] {
  const out: HoldingRow[] = [];
  for (const lots of bucketByPosition(rows).values()) {
    const agg = netAggregate(lots);
    if (agg.netUnits <= 0) continue;
    const tpl = lots.find((l) => l.transactionType !== "sell") ?? lots[0];
    out.push({
      ...tpl,
      units: agg.netUnits,
      buyPrice: agg.avgBuyPx,
      buyFxRate: agg.avgBuyFx,
      currentPrice: agg.curPx,
      currentFxRate: agg.curFx,
      costSGD: agg.costSGD,
      valueSGD: agg.valueSGD,
      assetGain: agg.assetGain,
      fxGain: agg.fxGain,
      totalPct: agg.totalPct,
      transactionType: "buy",
      detail: {
        ...tpl.detail,
        buyUnits: agg.netUnits,
        buyPx: agg.avgBuyPx,
        buyFx: agg.avgBuyFx,
        curPx: agg.curPx,
        curFx: agg.curFx,
      },
    });
  }
  return out;
}
