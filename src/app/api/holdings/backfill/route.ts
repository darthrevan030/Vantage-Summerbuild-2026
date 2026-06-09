import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchHoldings } from "@/lib/supabase/data";

export const maxDuration = 60;

const EODHD_KEY = process.env.EODHD_API_KEY ?? "";

async function fetchEohdHistory(symbol: string, from: string, to: string): Promise<Record<string, number>> {
  if (!EODHD_KEY || EODHD_KEY.startsWith("YOUR_") || EODHD_KEY === "demo") return {};
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
  to: string
): Promise<Record<string, Record<string, number>>> {
  const foreign = currencies.filter((c) => c !== "SGD");
  if (foreign.length === 0) return {};
  try {
    const r = await fetch(
      `https://api.frankfurter.app/${from}..${to}?from=SGD&to=${foreign.join(",")}`,
      { next: { revalidate: 0 } }
    );
    if (!r.ok) return {};
    const data = await r.json();
    // Frankfurter returns foreign-per-SGD; invert to get SGD-per-foreign
    const result: Record<string, Record<string, number>> = {};
    for (const [date, rates] of Object.entries(data.rates as Record<string, Record<string, number>>)) {
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
function fillForward(dates: string[], sparse: Record<string, number>, seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  let last = seed;
  for (const d of dates) {
    if (sparse[d] !== undefined) last = sparse[d];
    out[d] = last;
  }
  return out;
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const holdings = await fetchHoldings(user.id);
  if (holdings.length === 0) return NextResponse.json({ inserted: 0, skipped: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const from = holdings.reduce((min, h) => (h.buyDate < min ? h.buyDate : min), holdings[0].buyDate);
  const allDates = dateRange(from, today);

  // Skip dates that already have snapshots
  const { data: existing } = await supabase
    .from("portfolio_snapshots")
    .select("recorded_date")
    .eq("user_id", user.id);
  const existingDates = new Set((existing ?? []).map((r: { recorded_date: string }) => r.recorded_date as string));

  const missingDates = allDates.filter((d) => !existingDates.has(d));
  if (missingDates.length === 0) return NextResponse.json({ inserted: 0, skipped: existingDates.size });

  // Unique exchange-listed tickers (not physical "—")
  const equityTickers = [...new Set(
    holdings.filter((h) => h.ticker !== "—").map((h) => h.ticker)
  )];
  const currencies = [...new Set(holdings.map((h) => h.currency).filter((c) => c !== "SGD"))];

  // Fetch all historical prices in parallel (one call per ticker)
  const [rawPrices, rawFx] = await Promise.all([
    Promise.all(equityTickers.map(async (t) => [t, await fetchEohdHistory(t, from, today)] as const)).then(Object.fromEntries),
    fetchFxHistory(currencies, from, today),
  ]);

  // Build fill-forward price maps per ticker
  const prices: Record<string, Record<string, number>> = {};
  for (const ticker of equityTickers) {
    const fallback = holdings.find((h) => h.ticker === ticker)?.buyPrice ?? 0;
    prices[ticker] = fillForward(allDates, rawPrices[ticker] ?? {}, fallback);
  }

  // Build fill-forward FX map: date → { USD: 1.35, GBP: 1.70, ... }
  const fx: Record<string, Record<string, number>> = {};
  for (const ccy of currencies) {
    const sparseCcy: Record<string, number> = {};
    for (const [date, rates] of Object.entries(rawFx)) {
      if (rates[ccy] !== undefined) sparseCcy[date] = rates[ccy];
    }
    const fallbackFx = holdings.find((h) => h.currency === ccy)?.buyFxRate ?? 1;
    const filled = fillForward(allDates, sparseCcy, fallbackFx);
    for (const [date, rate] of Object.entries(filled)) {
      if (!fx[date]) fx[date] = {};
      fx[date][ccy] = rate;
    }
  }

  // Build snapshot rows for each missing date
  type SnapshotRow = {
    user_id: string;
    recorded_date: string;
    value_sgd: number;
    cost_sgd: number;
    fx_impact_sgd: number;
    fx_by_currency: Record<string, number>;
  };

  const rows: SnapshotRow[] = [];

  for (const date of missingDates) {
    const active = holdings.filter((h) => h.buyDate <= date);
    if (active.length === 0) continue;

    let valueSgd = 0, costSgd = 0, fxImpactSgd = 0;
    const fxByCurrency: Record<string, number> = {};

    for (const h of active) {
      const histPrice = h.ticker === "—"
        ? h.buyPrice
        : (prices[h.ticker]?.[date] ?? h.buyPrice);
      const histFxRate = h.currency === "SGD" ? 1 : (fx[date]?.[h.currency] ?? h.buyFxRate);

      valueSgd  += h.units * histPrice * histFxRate;
      costSgd   += h.units * h.buyPrice * h.buyFxRate;

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

  if (rows.length === 0) return NextResponse.json({ inserted: 0, skipped: existingDates.size });

  const { error } = await supabase
    .from("portfolio_snapshots")
    .upsert(rows, { onConflict: "user_id,recorded_date" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: rows.length, skipped: existingDates.size });
}
