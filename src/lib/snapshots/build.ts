import { NON_GROUPABLE } from "@/lib/positions";
import { computeSnapshotAsOf, type LotLite } from "@/lib/history";

export interface SnapshotRowOut {
  user_id: string;
  recorded_date: string;
  value_sgd: number;
  cost_sgd: number;
  fx_impact_sgd: number;
  fx_by_currency: Record<string, number>;
}

// Inclusive UTC-stepped calendar range (the strings are timezone-agnostic keys).
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// Carry last known value across gaps (weekends, holidays); seed the front.
export function fillForward(
  dates: string[],
  sparse: Record<string, number>,
  seed: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let last = seed;
  for (const d of dates) {
    if (sparse[d] !== undefined) last = sparse[d];
    out[d] = last;
  }
  return out;
}

// Assemble one snapshot row per date from a user's lots and sparse price/FX
// maps. Fill-forward is applied here so callers pass raw provider output.
export function buildSnapshotRows(params: {
  userId: string;
  lots: LotLite[];
  dates: string[];
  rawPrices: Record<string, Record<string, number>>;
  rawFx: Record<string, Record<string, number>>;
  priceFallback: (ticker: string) => number;
  fxFallback: (ccy: string) => number;
}): SnapshotRowOut[] {
  const { userId, lots, dates, rawPrices, rawFx, priceFallback, fxFallback } =
    params;

  const tickers = [
    ...new Set(lots.map((l) => l.ticker).filter((t) => !NON_GROUPABLE.has(t))),
  ];
  const currencies = [
    ...new Set(lots.map((l) => l.currency).filter((c) => c !== "SGD")),
  ];

  const prices: Record<string, Record<string, number>> = {};
  for (const t of tickers) {
    prices[t] = fillForward(dates, rawPrices[t] ?? {}, priceFallback(t));
  }
  const fx: Record<string, Record<string, number>> = {};
  for (const c of currencies) {
    fx[c] = fillForward(dates, rawFx[c] ?? {}, fxFallback(c));
  }

  const priceOf = (ticker: string, date: string) =>
    prices[ticker]?.[date] ?? priceFallback(ticker);
  const fxOf = (ccy: string, date: string) => fx[ccy]?.[date] ?? fxFallback(ccy);

  const rows: SnapshotRowOut[] = [];
  for (const date of dates) {
    const agg = computeSnapshotAsOf(lots, date, priceOf, fxOf);
    rows.push({
      user_id: userId,
      recorded_date: date,
      value_sgd: Math.round(agg.valueSgd),
      cost_sgd: Math.round(agg.costSgd),
      fx_impact_sgd: Math.round(agg.fxImpactSgd),
      fx_by_currency: agg.fxByCurrency,
    });
  }
  return rows;
}
