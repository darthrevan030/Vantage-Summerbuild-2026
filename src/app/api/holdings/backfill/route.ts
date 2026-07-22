import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { fetchHoldings, fetchSnapshots } from "@/lib/supabase/data";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { NON_GROUPABLE } from "@/lib/positions";
import { sgtDate } from "@/lib/dates";
import { dateRange, buildSnapshotRows } from "@/lib/snapshots/build";
import { fetchWindowPrices, fetchWindowFx } from "@/lib/snapshots/fetch";

export const maxDuration = 60;

export async function POST() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const limited = await enforceRateLimit("backfill", 2, 60, { failClosed: true });
  if (limited) return limited;

  const holdings = await fetchHoldings(user.id);
  if (holdings.length === 0)
    return NextResponse.json({ inserted: 0, skipped: 0 });

  const today = sgtDate();
  const from = holdings.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    holdings[0].buyDate,
  );
  const dates = dateRange(from, today);

  const existingSnapshots = await fetchSnapshots(user.id);
  const existingDates = new Set(existingSnapshots.map((s) => s.recordedDate));

  const tickers = [
    ...new Set(holdings.filter((h) => !NON_GROUPABLE.has(h.ticker)).map((h) => h.ticker)),
  ];
  const tickerCurrency = Object.fromEntries(
    holdings
      .filter((h) => !NON_GROUPABLE.has(h.ticker))
      .map((h) => [h.ticker, h.currency]),
  );
  const currencies = [
    ...new Set(holdings.map((h) => h.currency).filter((c) => c !== "SGD")),
  ];

  const providers = await getProviderFlags();
  const [rawPrices, rawFx] = await Promise.all([
    fetchWindowPrices({ tickers, tickerCurrency, from, to: today, providers }),
    fetchWindowFx({ currencies, from, to: today, providers }),
  ]);

  const priceFallback = (ticker: string) =>
    holdings.find((h) => h.ticker === ticker)?.buyPrice ?? 0;
  const fxFallback = (ccy: string) =>
    holdings.find((h) => h.currency === ccy)?.buyFxRate ?? 1;

  const rows = buildSnapshotRows({
    userId: user.id,
    lots: holdings,
    dates,
    rawPrices,
    rawFx,
    priceFallback,
    fxFallback,
  });

  if (rows.length === 0)
    return NextResponse.json({ inserted: 0, skipped: existingDates.size });

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_snapshots")
    .upsert(rows, { onConflict: "user_id,recorded_date" });
  if (error) {
    console.error("[backfill]", error.message);
    return NextResponse.json({ error: "Failed to write snapshots" }, { status: 500 });
  }

  return NextResponse.json({
    inserted: rows.length,
    skipped: existingDates.size,
  });
}
