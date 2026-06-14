import type { HoldingRow, GroupedHolding } from "@/types/holding";
import { NON_GROUPABLE } from "@/lib/positions";

export function groupHoldings(rows: HoldingRow[]): GroupedHolding[] {
  const map = new Map<string, HoldingRow[]>();
  for (const row of rows) {
    // untickered assets (Gold, RE) each get their own group; named tickers merge
    const k = NON_GROUPABLE.has(row.ticker) ? row.id : row.ticker;
    const bucket = map.get(k) ?? [];
    bucket.push(row);
    map.set(k, bucket);
  }
  return Array.from(map.values()).map((lots) => {
    const first = lots[0];
    const valueSGD = lots.reduce((s, l) => s + l.valueSGD, 0);
    const costSGD = lots.reduce((s, l) => s + l.costSGD, 0);
    const assetGain = lots.reduce((s, l) => s + l.assetGain, 0);
    const fxGain = lots.reduce((s, l) => s + l.fxGain, 0);
    return {
      ticker: first.ticker,
      name: first.name,
      assetType: first.assetType,
      currency: first.currency,
      flag: first.flag,
      icon: first.icon,
      lots,
      totalUnits: lots.reduce((s, l) => s + l.units, 0),
      valueSGD,
      costSGD,
      assetGain,
      fxGain,
      totalPct: costSGD > 0 ? ((valueSGD - costSGD) / costSGD) * 100 : 0,
      currentPrice: first.currentPrice,
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
