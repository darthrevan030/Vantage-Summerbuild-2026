import type { HoldingRow } from "@/types/holding";

/**
 * A Position is one *security*, aggregating one or more lots (individual
 * HoldingRow buys of the same ticker). Single-lot positions pass through
 * transparently (isGroup=false); multi-lot positions expose blended stats.
 *
 * The table renders Positions; the inspector still operates on the underlying
 * HoldingRow lots, so editing/deleting stays lot-level.
 */
export interface Position {
  key: string;
  isGroup: boolean;
  lots: HoldingRow[];

  // display identity
  name: string;
  ticker: string;
  assetType: string;
  broker: string;
  strategy: string;
  currency: string;
  flag: string;
  icon: string;

  // aggregate metrics (SGD sums add linearly — already in a common currency)
  units: number;
  costSGD: number;
  valueSGD: number;
  assetGain: number;
  fxGain: number;
  totalPct: number;

  // blended native-currency prices for the net detail
  avgBuyPrice: number;
  currentPrice: number;
}

// Tickers that represent unique physical assets (gold, real estate) — never merge these.
const NON_GROUPABLE = new Set(["—", "-", ""]);

const sum = (lots: HoldingRow[], get: (l: HoldingRow) => number) =>
  lots.reduce((s, l) => s + get(l), 0);

/** Pick the lot whose price was refreshed/updated most recently. */
function mostRecent(lots: HoldingRow[]): HoldingRow {
  return lots.reduce((a, b) => {
    const ta = a.priceRefreshedAt ?? a.updatedAt ?? a.buyDate;
    const tb = b.priceRefreshedAt ?? b.updatedAt ?? b.buyDate;
    return tb > ta ? b : a;
  });
}

/** Project a single lot's fields onto the flat Position shape. */
function passthrough(h: HoldingRow) {
  return {
    name: h.name, ticker: h.ticker, assetType: h.assetType, broker: h.broker,
    strategy: h.strategy, currency: h.currency, flag: h.flag, icon: h.icon,
    units: h.units, costSGD: h.costSGD, valueSGD: h.valueSGD,
    assetGain: h.assetGain, fxGain: h.fxGain, totalPct: h.totalPct,
    avgBuyPrice: h.buyPrice, currentPrice: h.currentPrice,
  };
}

function aggregate(key: string, lots: HoldingRow[]): Position {
  const first = lots[0];

  if (lots.length === 1) {
    return { key, isGroup: false, lots, ...passthrough(first) };
  }

  const units    = sum(lots, (l) => l.units);
  const costSGD  = sum(lots, (l) => l.costSGD);
  const valueSGD = sum(lots, (l) => l.valueSGD);
  const assetGain = sum(lots, (l) => l.assetGain);
  const fxGain    = sum(lots, (l) => l.fxGain);
  const totalPct  = costSGD > 0 ? ((valueSGD - costSGD) / costSGD) * 100 : 0;

  // Cost-weighted average entry price — each lot weighted by its unit count.
  const avgBuyPrice = units > 0 ? sum(lots, (l) => l.buyPrice * l.units) / units : 0;
  // Same security across lots → use the freshest current price.
  const currentPrice = mostRecent(lots).currentPrice;

  const allSame = <T,>(get: (l: HoldingRow) => T) => lots.every((l) => get(l) === get(first));

  return {
    key,
    isGroup: true,
    lots,
    name: first.name,
    ticker: first.ticker,
    assetType: first.assetType,
    broker: allSame((l) => l.broker) ? first.broker : "Multiple",
    strategy: allSame((l) => l.strategy) ? first.strategy : "mixed",
    currency: first.currency,
    flag: first.flag,
    icon: first.icon,
    units, costSGD, valueSGD, assetGain, fxGain, totalPct,
    avgBuyPrice, currentPrice,
  };
}

/**
 * Group holdings into positions, merging lots that share a real ticker.
 * Insertion order is preserved (Map keeps first-seen order).
 */
export function groupIntoPositions(holdings: HoldingRow[]): Position[] {
  const groups = new Map<string, HoldingRow[]>();
  for (const h of holdings) {
    const k = NON_GROUPABLE.has(h.ticker) ? `solo:${h.id}` : `tkr:${h.ticker}`;
    const arr = groups.get(k);
    if (arr) arr.push(h);
    else groups.set(k, [h]);
  }
  return Array.from(groups.entries()).map(([key, lots]) => aggregate(key, lots));
}
