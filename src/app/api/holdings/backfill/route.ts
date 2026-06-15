import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/guards";
import {
  fetchHoldings,
  fetchSnapshots,
  fetchFxRateHistory,
  upsertFxHistory,
} from "@/lib/supabase/data";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { fetchDailyCloses } from "@/lib/providers/history";

export const maxDuration = 60;

const EODHD_KEY = process.env.EODHD_API_KEY ?? "";

const EODHD_CODE_REMAP: Record<string, string> = {
  SG: "SI",
  HKEX: "HK",
  ASX: "AU",
  MI: "MI",
};

function normalizeEohdTicker(ticker: string): string {
  if (!ticker.includes(".")) return ticker;
  const [sym, exc] = ticker.split(".");
  return `${sym}.${EODHD_CODE_REMAP[exc] ?? exc}`;
}

async function fetchEohdHistory(
  symbol: string,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  if (!EODHD_KEY || EODHD_KEY.startsWith("YOUR_") || EODHD_KEY === "demo")
    return {};
  const url = `https://eodhd.com/api/eod/${symbol}?from=${from}&to=${to}&fmt=json&api_token=${EODHD_KEY}`;
  try {
    const r = await fetch(url, { next: { revalidate: 0 } });
    if (!r.ok) return {};
    const data: { date: string; adjusted_close: number }[] = await r.json();
    return Object.fromEntries(data.map((d) => [d.date, d.adjusted_close]));
  } catch {
    return {};
  }
}

async function fetchFxHistory(
  currencies: string[],
  from: string,
  to: string,
): Promise<Record<string, Record<string, number>>> {
  const foreign = currencies.filter((c) => c !== "SGD");
  if (foreign.length === 0) return {};
  try {
    const r = await fetch(
      `https://api.frankfurter.app/${from}..${to}?from=SGD&to=${foreign.join(",")}`,
      { next: { revalidate: 0 } },
    );
    if (!r.ok) return {};
    const data = await r.json();
    // Frankfurter returns foreign-per-SGD; invert to get SGD-per-foreign
    const result: Record<string, Record<string, number>> = {};
    for (const [date, rates] of Object.entries(
      data.rates as Record<string, Record<string, number>>,
    )) {
      result[date] = {};
      for (const [ccy, rate] of Object.entries(rates)) {
        result[date][ccy] = 1 / (rate as number);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// Fill forward: carry last known value across gaps (weekends, holidays)
function fillForward(
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

export async function POST() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const holdings = await fetchHoldings(user.id);
  if (holdings.length === 0)
    return NextResponse.json({ inserted: 0, skipped: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const from = holdings.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    holdings[0].buyDate,
  );
  const allDates = dateRange(from, today);

  // Skip dates that already have snapshots — use the paginated fetch so the
  // PostgREST 1000-row cap doesn't hide existing dates and trigger re-fetches
  const existingSnapshots = await fetchSnapshots(user.id);
  const existingDates = new Set(existingSnapshots.map((s) => s.recordedDate));

  // Recompute the FULL date range (not just missing dates) so newly added
  // back-dated lots are reflected in history from their actual trade date.
  // existingDates is retained only for the response's "skipped" count.

  // Unique exchange-listed tickers (not physical "—")
  const equityTickers = [
    ...new Set(holdings.filter((h) => h.ticker !== "—").map((h) => h.ticker)),
  ];
  const tickerCurrency = Object.fromEntries(
    holdings.filter((h) => h.ticker !== "—").map((h) => [h.ticker, h.currency]),
  );
  const currencies = [
    ...new Set(holdings.map((h) => h.currency).filter((c) => c !== "SGD")),
  ];

  const providers = await getProviderFlags();

  // Historical prices use the same provider chain as live: EODHD first…
  // FX comes from the fx_history cache, fetching only dates we don't already have.
  const [eodhdPrices, fxCache] = await Promise.all([
    providers.eodhd
      ? Promise.all(
          equityTickers.map(
            async (t) =>
              [
                t,
                await fetchEohdHistory(normalizeEohdTicker(t), from, today),
              ] as const,
          ),
        ).then(Object.fromEntries)
      : Promise.resolve(Object.fromEntries(equityTickers.map((t) => [t, {}]))),
    providers.frankfurter
      ? fetchFxRateHistory()
      : Promise.resolve({} as Record<string, Record<string, number>>),
  ]);

  const rawPrices: Record<string, Record<string, number>> = { ...eodhdPrices };

  // FX cache → only fetch the window not already cached. Historical rates are
  // immutable, so a warm cache means we just top up recent (and any older) dates.
  const fxByCcy: Record<string, Record<string, number>> = {};
  for (const ccy of currencies) fxByCcy[ccy] = { ...(fxCache[ccy] ?? {}) };

  if (providers.frankfurter && currencies.length > 0) {
    let fetchFrom = today; // always refresh today (its rate is still "live")
    let fullRefetch = false;
    for (const ccy of currencies) {
      const dates = Object.keys(fxByCcy[ccy]);
      if (dates.length === 0) {
        fullRefetch = true;
        break;
      }
      let cmin = dates[0];
      let cmax = dates[0];
      for (const d of dates) {
        if (d < cmin) cmin = d;
        if (d > cmax) cmax = d;
      }
      if (cmin > from) {
        fullRefetch = true; // older history missing (e.g. a new back-dated lot)
        break;
      }
      if (cmax < fetchFrom) fetchFrom = cmax; // need the tail since last cache
    }
    if (fullRefetch) fetchFrom = from;

    const fetched = await fetchFxHistory(currencies, fetchFrom, today);
    const touched = new Set<string>();
    for (const [date, rates] of Object.entries(fetched)) {
      for (const ccy of currencies) {
        if (rates[ccy] !== undefined) {
          fxByCcy[ccy][date] = rates[ccy];
          touched.add(ccy);
        }
      }
    }
    // Persist the freshly merged history so the next rebuild fetches even less
    await Promise.all(
      [...touched].map((ccy) => upsertFxHistory(ccy, fxByCcy[ccy])),
    );
  }

  // …then Yahoo as a fallback for tickers EODHD missed (or when EODHD is off).
  if (providers.yahoo ?? true) {
    const needYahoo = equityTickers.filter(
      (t) => Object.keys(rawPrices[t] ?? {}).length === 0,
    );
    if (needYahoo.length > 0) {
      const yahooResults = await Promise.all(
        needYahoo.map(
          async (t) =>
            [
              t,
              await fetchDailyCloses(t, tickerCurrency[t] ?? "USD", from, today),
            ] as const,
        ),
      );
      for (const [t, m] of yahooResults) rawPrices[t] = m;
    }
  }

  // Build fill-forward price maps per ticker
  const prices: Record<string, Record<string, number>> = {};
  for (const ticker of equityTickers) {
    const fallback = holdings.find((h) => h.ticker === ticker)?.buyPrice ?? 0;
    prices[ticker] = fillForward(allDates, rawPrices[ticker] ?? {}, fallback);
  }

  // Build fill-forward FX map: date → { USD: 1.35, GBP: 1.70, ... }
  const fx: Record<string, Record<string, number>> = {};
  for (const ccy of currencies) {
    const fallbackFx = holdings.find((h) => h.currency === ccy)?.buyFxRate ?? 1;
    const filled = fillForward(allDates, fxByCcy[ccy] ?? {}, fallbackFx);
    for (const [date, rate] of Object.entries(filled)) {
      if (!fx[date]) fx[date] = {};
      fx[date][ccy] = rate;
    }
  }

  // Build a snapshot row for every date in range (full rebuild). The upsert
  // overwrites existing rows, so back-dated lots get folded into history.
  type SnapshotRow = {
    user_id: string;
    recorded_date: string;
    value_sgd: number;
    cost_sgd: number;
    fx_impact_sgd: number;
    fx_by_currency: Record<string, number>;
  };

  const rows: SnapshotRow[] = [];

  for (const date of allDates) {
    const active = holdings.filter((h) => h.buyDate <= date);
    if (active.length === 0) continue;

    let valueSgd = 0,
      costSgd = 0,
      fxImpactSgd = 0;
    const fxByCurrency: Record<string, number> = {};

    for (const h of active) {
      const histPrice =
        h.ticker === "—"
          ? h.buyPrice
          : (prices[h.ticker]?.[date] ?? h.buyPrice);
      const histFxRate =
        h.currency === "SGD" ? 1 : (fx[date]?.[h.currency] ?? h.buyFxRate);

      valueSgd += h.units * histPrice * histFxRate;
      costSgd += h.units * h.buyPrice * h.buyFxRate;

      if (h.currency !== "SGD") {
        const impact = h.units * h.buyPrice * (histFxRate - h.buyFxRate);
        fxImpactSgd += impact;
        const k = h.currency.toLowerCase();
        fxByCurrency[k] = (fxByCurrency[k] ?? 0) + impact;
      }
    }

    rows.push({
      user_id: user.id,
      recorded_date: date,
      value_sgd: Math.round(valueSgd),
      cost_sgd: Math.round(costSgd),
      fx_impact_sgd: Math.round(fxImpactSgd),
      fx_by_currency: fxByCurrency,
    });
  }

  if (rows.length === 0)
    return NextResponse.json({ inserted: 0, skipped: existingDates.size });

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_snapshots")
    .upsert(rows, { onConflict: "user_id,recorded_date" });

  if (error) {
    console.error("[holdings/backfill] DB error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    inserted: rows.length,
    skipped: existingDates.size,
  });
}
