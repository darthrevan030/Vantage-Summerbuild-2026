import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin"; // match Task 7's name
import {
  fetchActiveUserIds,
  fetchHoldings,
  fetchSnapshots,
} from "@/lib/supabase/data";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { NON_GROUPABLE } from "@/lib/positions";
import { sgtDate } from "@/lib/dates";
import { dateRange, buildSnapshotRows } from "@/lib/snapshots/build";
import { fetchWindowPrices, fetchWindowFx } from "@/lib/snapshots/fetch";
import { authorizeCron } from "@/lib/snapshots/cron-auth";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = sgtDate();
  const userIds = await fetchActiveUserIds();
  if (userIds.length === 0) return NextResponse.json({ users: 0, rows: 0 });

  // Per user: holdings + their missing-day window start.
  const perUser = await Promise.all(
    userIds.map(async (id) => {
      const holdings = await fetchHoldings(id);
      if (holdings.length === 0) return null;
      const snaps = await fetchSnapshots(id);
      const earliest = holdings.reduce(
        (min, h) => (h.buyDate < min ? h.buyDate : min),
        holdings[0].buyDate,
      );
      const lastSnap = snaps.length ? snaps[snaps.length - 1].recordedDate : null;
      const start = lastSnap ? nextDay(lastSnap) : earliest;
      return { id, holdings, start: start > today ? null : start };
    }),
  );
  const active = perUser.filter(
    (u): u is NonNullable<typeof u> => u !== null && u.start !== null,
  );
  if (active.length === 0) return NextResponse.json({ users: 0, rows: 0 });

  // Global window = earliest per-user start … today; fetch each instrument once.
  const globalFrom = active.reduce(
    (min, u) => (u.start! < min ? u.start! : min),
    today,
  );
  const allHoldings = active.flatMap((u) => u.holdings);
  const tickers = [
    ...new Set(
      allHoldings.filter((h) => !NON_GROUPABLE.has(h.ticker)).map((h) => h.ticker),
    ),
  ];
  const tickerCurrency = Object.fromEntries(
    allHoldings
      .filter((h) => !NON_GROUPABLE.has(h.ticker))
      .map((h) => [h.ticker, h.currency]),
  );
  const currencies = [
    ...new Set(allHoldings.map((h) => h.currency).filter((c) => c !== "SGD")),
  ];

  const providers = await getProviderFlags();
  const [rawPrices, rawFx] = await Promise.all([
    fetchWindowPrices({ tickers, tickerCurrency, from: globalFrom, to: today, providers }),
    fetchWindowFx({ currencies, from: globalFrom, to: today, providers }),
  ]);

  const admin = createAdminClient();
  let totalRows = 0;
  for (const u of active) {
    const dates = dateRange(u.start!, today);
    const priceFallback = (ticker: string) =>
      u.holdings.find((h) => h.ticker === ticker)?.buyPrice ?? 0;
    const fxFallback = (ccy: string) =>
      u.holdings.find((h) => h.currency === ccy)?.buyFxRate ?? 1;
    const rows = buildSnapshotRows({
      userId: u.id,
      lots: u.holdings,
      dates,
      rawPrices,
      rawFx,
      priceFallback,
      fxFallback,
    });
    if (rows.length === 0) continue;
    const { error } = await admin
      .from("portfolio_snapshots")
      .upsert(rows, { onConflict: "user_id,recorded_date" });
    if (error) {
      console.error("[snapshot-all]", u.id, error.message);
      continue;
    }
    totalRows += rows.length;
  }

  return NextResponse.json({ users: active.length, rows: totalRows });
}

// Next calendar day for a YYYY-MM-DD string.
function nextDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
