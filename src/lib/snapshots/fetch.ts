import { type SupabaseClient } from "@supabase/supabase-js";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { fetchDailyCloses } from "@/lib/providers/history";
import { fetchFxRateHistory, upsertFxHistory } from "@/lib/supabase/data";

export type ProviderFlags = Awaited<ReturnType<typeof getProviderFlags>>;

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

// RAW close (not adjusted_close) so history, live value, and cost share one scale.
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
    const data: { date: string; close: number }[] = await r.json();
    return Object.fromEntries(data.map((d) => [d.date, d.close]));
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

// EODHD first, Yahoo fallback for tickers EODHD missed (or when EODHD is off).
export async function fetchWindowPrices(params: {
  tickers: string[];
  tickerCurrency: Record<string, string>;
  from: string;
  to: string;
  providers: ProviderFlags;
}): Promise<Record<string, Record<string, number>>> {
  const { tickers, tickerCurrency, from, to, providers } = params;

  const eodhdPrices = providers.eodhd
    ? Object.fromEntries(
        await Promise.all(
          tickers.map(
            async (t) =>
              [t, await fetchEohdHistory(normalizeEohdTicker(t), from, to)] as const,
          ),
        ),
      )
    : Object.fromEntries(tickers.map((t) => [t, {}]));

  const rawPrices: Record<string, Record<string, number>> = { ...eodhdPrices };

  if (providers.yahoo ?? true) {
    const needYahoo = tickers.filter(
      (t) => Object.keys(rawPrices[t] ?? {}).length === 0,
    );
    if (needYahoo.length > 0) {
      const yahooResults = await Promise.all(
        needYahoo.map(
          async (t) =>
            [
              t,
              await fetchDailyCloses(t, tickerCurrency[t] ?? "USD", from, to),
            ] as const,
        ),
      );
      for (const [t, m] of yahooResults) rawPrices[t] = m;
    }
  }

  return rawPrices;
}

// FX from the fx_history cache, fetching only the window not already cached,
// then persisting the merged history. Returns ccy → date → SGD-per-ccy.
export async function fetchWindowFx(params: {
  currencies: string[];
  from: string;
  to: string;
  providers: ProviderFlags;
  client?: SupabaseClient;
}): Promise<Record<string, Record<string, number>>> {
  const { currencies, from, to, providers, client } = params;
  const foreign = currencies.filter((c) => c !== "SGD");
  const fxByCcy: Record<string, Record<string, number>> = {};
  if (foreign.length === 0 || !providers.frankfurter) return fxByCcy;

  const fxCache = await fetchFxRateHistory(client);
  for (const ccy of foreign) fxByCcy[ccy] = { ...(fxCache[ccy] ?? {}) };

  let fetchFrom = to; // always refresh `to` (its rate is still "live")
  let fullRefetch = false;
  for (const ccy of foreign) {
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
      fullRefetch = true;
      break;
    }
    if (cmax < fetchFrom) fetchFrom = cmax;
  }
  if (fullRefetch) fetchFrom = from;

  const fetched = await fetchFxHistory(foreign, fetchFrom, to);
  const touched = new Set<string>();
  for (const [date, rates] of Object.entries(fetched)) {
    for (const ccy of foreign) {
      if (rates[ccy] !== undefined) {
        fxByCcy[ccy][date] = rates[ccy];
        touched.add(ccy);
      }
    }
  }
  await Promise.all([...touched].map((ccy) => upsertFxHistory(ccy, fxByCcy[ccy])));

  return fxByCcy;
}
