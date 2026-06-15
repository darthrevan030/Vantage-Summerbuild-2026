import { fetchHoldings, upsertTickerDividend } from "@/lib/supabase/data";
import { fetchDividendYields } from "@/lib/providers/dividends";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { getProviderFlags } from "@/lib/supabase/app-config";

// Refresh trailing-twelve-month dividend yields for the user's symbols into the
// shared ticker_dividends cache.
export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("dividends", 6, 60);
  if (limited) return limited;

  const providers = await getProviderFlags();
  if (!(providers.yahoo ?? true)) return Response.json({ updated: 0 });

  const holdings = await fetchHoldings(user.id);
  const bySymbol = new Map<string, string>();
  for (const h of holdings) if (h.ticker !== "—") bySymbol.set(h.ticker, h.currency);

  const tickers = [...bySymbol.keys()];
  if (tickers.length === 0) return Response.json({ updated: 0 });

  const yields = await fetchDividendYields(tickers, Object.fromEntries(bySymbol));
  await Promise.all(
    Object.entries(yields).map(([sym, r]) =>
      upsertTickerDividend(sym, r.yieldTtm, r.source),
    ),
  );

  return Response.json({ updated: Object.keys(yields).length });
}
