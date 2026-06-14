import { fetchFxRateHistory, upsertFxHistory } from "@/lib/supabase/data";

/**
 * Daily SGD-per-foreign rates for a date range via Frankfurter.
 * Returns date → { ccy: sgd_per_foreign } (Frankfurter gives foreign-per-SGD,
 * so we invert). Empty object on any failure.
 */
export async function fetchFxHistoryRange(
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

/**
 * Guarantee the fx_history cache covers `currencies` over [from, to], fetching
 * any that are missing or under-covered from Frankfurter and persisting them.
 * Returns the merged per-currency history: { ccy: { date: sgd_per_foreign } }.
 * SGD is implicit (always 1) and never stored.
 */
export async function ensureFxHistory(
  currencies: string[],
  from: string,
  to: string,
): Promise<Record<string, Record<string, number>>> {
  const wanted = [...new Set(currencies.filter((c) => c !== "SGD"))];
  const cache = await fetchFxRateHistory();

  const missing = wanted.filter((ccy) => {
    const dates = Object.keys(cache[ccy] ?? {});
    if (dates.length === 0) return true; // never cached (e.g. an unheld base ccy)
    let cmin = dates[0];
    for (const d of dates) if (d < cmin) cmin = d;
    // Only re-fetch when OLDER history is missing. Recent-tail staleness is fine
    // here — fill-forward covers it, and the backfill/live refresh advance the
    // tail — so we don't re-pull 3 years on every call.
    return cmin > from;
  });

  if (missing.length > 0) {
    const fetched = await fetchFxHistoryRange(missing, from, to);
    const touched = new Set<string>();
    for (const [date, rates] of Object.entries(fetched)) {
      for (const ccy of missing) {
        if (rates[ccy] !== undefined) {
          (cache[ccy] ??= {})[date] = rates[ccy];
          touched.add(ccy);
        }
      }
    }
    await Promise.all(
      [...touched].map((ccy) => upsertFxHistory(ccy, cache[ccy])),
    );
  }

  return cache;
}
