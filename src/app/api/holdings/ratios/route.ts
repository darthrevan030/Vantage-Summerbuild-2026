import { fetchHoldings, upsertTickerHistory } from "@/lib/supabase/data";
import { fetchTickerHistory, returnsFromCloses } from "@/lib/providers/history";
import { computeSharpeRatio, computeCAGR } from "@/lib/portfolio";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { getProviderFlags } from "@/lib/supabase/app-config";

export const maxDuration = 60;

interface RatioResult {
  ticker: string;
  sharpe: number;
  cagr5yr: number | null;
}

// Per-ticker risk/return ratios: fetches 1yr daily + 5yr monthly closes, caches
// them in ticker_history, and returns Sharpe (daily) + 5yr CAGR (monthly).
export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("ratios", 4, 60);
  if (limited) return limited;

  const providers = await getProviderFlags();
  if (!(providers.yahoo ?? true)) return Response.json({ ratios: [] });

  const holdings = await fetchHoldings(user.id);
  const bySymbol = new Map<string, string>();
  for (const h of holdings) if (h.ticker !== "—") bySymbol.set(h.ticker, h.currency);

  const tickers = [...bySymbol.keys()];
  if (tickers.length === 0) return Response.json({ ratios: [] });

  const ratios = await Promise.all(
    tickers.map(async (ticker): Promise<RatioResult> => {
      const { dailyCloses, monthlyCloses } = await fetchTickerHistory(
        ticker,
        bySymbol.get(ticker) ?? "USD",
      );
      if (dailyCloses.length >= 2 || monthlyCloses.length >= 2) {
        await upsertTickerHistory(ticker, dailyCloses, monthlyCloses);
      }
      const sharpe = computeSharpeRatio(returnsFromCloses(dailyCloses));
      const cagr5yr =
        monthlyCloses.length >= 2
          ? computeCAGR(
              monthlyCloses[0],
              monthlyCloses[monthlyCloses.length - 1],
              monthlyCloses.length / 12,
            )
          : null;
      return { ticker, sharpe, cagr5yr };
    }),
  );

  return Response.json({ ratios });
}
