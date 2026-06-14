import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchHoldings, fetchSnapshots } from "@/lib/supabase/data";
import { ensureFxHistory } from "@/lib/providers/fx";
import type { FxSeriesPoint } from "@/types/portfolio";

export const maxDuration = 30;

const CCY_RE = /^[A-Z]{3}$/;

// Walk a sorted [date, rate] list across `dates`, carrying the last known rate
// forward across gaps (weekends/holidays). Returns date → rate.
function rateSeries(
  sorted: [string, number][],
  dates: string[],
  fallback: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let pi = 0;
  let cur = fallback;
  for (const date of dates) {
    while (pi < sorted.length && sorted[pi][0] <= date) {
      cur = sorted[pi][1];
      pi++;
    }
    out[date] = cur;
  }
  return out;
}

function rateAt(sorted: [string, number][], date: string, fallback: number): number {
  let v = fallback;
  for (const [d, r] of sorted) {
    if (d <= date) v = r;
    else break;
  }
  return v;
}

/**
 * FX impact series recomputed relative to a chosen base currency (not SGD).
 * For each holding in currency C, impact in base B is
 *   units × buyPrice × ( r(C→B, date) − r(C→B, buyDate) )
 * where r(C→B) = r(C→SGD) / r(B→SGD). Holdings already in B have zero impact.
 * Values are returned IN THE BASE CURRENCY (no further conversion needed).
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const base = (new URL(req.url).searchParams.get("base") || "SGD").toUpperCase();
  if (!CCY_RE.test(base))
    return NextResponse.json({ error: "invalid base" }, { status: 400 });

  const [holdings, snapshots] = await Promise.all([
    fetchHoldings(user.id),
    fetchSnapshots(user.id),
  ]);

  const fxHoldings = holdings.filter((h) => h.currency !== base);
  const dates = [...new Set(snapshots.map((s) => s.recordedDate))].sort();
  if (fxHoldings.length === 0 || dates.length === 0)
    return NextResponse.json({ series: [], labels: [], keys: [] });

  const currencies = [...new Set(fxHoldings.map((h) => h.currency))];

  // Ensure rate history exists for every currency we cross — the held currencies
  // AND the base (which the user may not even hold, e.g. EUR). Missing histories
  // are fetched from Frankfurter and cached.
  const today = new Date().toISOString().slice(0, 10);
  const earliestBuy = fxHoldings.reduce(
    (m, h) => (h.buyDate < m ? h.buyDate : m),
    fxHoldings[0].buyDate,
  );
  const from = earliestBuy < dates[0] ? earliestBuy : dates[0];
  const needed = [...currencies, ...(base === "SGD" ? [] : [base])];
  const fxHist = await ensureFxHistory(needed, from, today);

  // Pre-sort each currency's C→SGD history (SGD is constant 1).
  const sorted: Record<string, [string, number][]> = {};
  const getSorted = (ccy: string): [string, number][] => {
    if (ccy === "SGD") return [];
    if (!sorted[ccy])
      sorted[ccy] = (
        Object.entries(fxHist[ccy] ?? {}) as [string, number][]
      ).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted[ccy];
  };

  // Daily r(X→SGD) across the grid, fill-forward.
  const rByDate: Record<string, Record<string, number>> = {};
  for (const ccy of [...currencies, base]) {
    rByDate[ccy] =
      ccy === "SGD"
        ? Object.fromEntries(dates.map((d) => [d, 1]))
        : rateSeries(getSorted(ccy), dates, 1);
  }

  const series: FxSeriesPoint[] = dates.map((date, i) => {
    const point: FxSeriesPoint = { i };
    const rBaseNow = base === "SGD" ? 1 : rByDate[base][date];
    for (const C of currencies) {
      const rCNow = C === "SGD" ? 1 : rByDate[C][date];
      let impact = 0;
      for (const h of fxHoldings) {
        if (h.currency !== C || h.buyDate > date) continue;
        const rCBuy = h.buyFxRate || rateAt(getSorted(C), h.buyDate, 1);
        const rBaseBuy = base === "SGD" ? 1 : rateAt(getSorted(base), h.buyDate, 1);
        const crossNow = rCNow / rBaseNow;
        const crossBuy = rCBuy / rBaseBuy;
        impact += h.units * h.buyPrice * (crossNow - crossBuy);
      }
      point[C.toLowerCase()] = Math.round(impact);
    }
    return point;
  });

  return NextResponse.json({
    series,
    labels: dates,
    keys: currencies.map((c) => c.toLowerCase()),
  });
}
