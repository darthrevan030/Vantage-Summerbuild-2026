import {
  fetchHoldings,
  upsertTickerQuote,
  updateFxRate,
  recordSnapshot,
} from "@/lib/supabase/data";
import {
  fetchLivePrices,
  fetchLiveFxRates,
  fetchCryptoSparks,
  fetchEquitySparks,
} from "@/lib/prices";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";
import { getProviderFlags } from "@/lib/supabase/app-config";

const STALE_MS = 5 * 60 * 1000; // 5 minutes

function isStale(priceRefreshedAt: string | null): boolean {
  if (!priceRefreshedAt) return true;
  return Date.now() - new Date(priceRefreshedAt).getTime() > STALE_MS;
}

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const limited = await enforceRateLimit("refresh", 12, 60);
  if (limited) return limited;

  const holdings = await fetchHoldings(user.id);

  // Dedupe to one entry per symbol — quotes are now shared across lots/users,
  // so a symbol is refreshed once regardless of how many lots reference it.
  const bySymbol = new Map<string, (typeof holdings)[number]>();
  for (const h of holdings) {
    if (h.ticker !== "—" && !bySymbol.has(h.ticker)) bySymbol.set(h.ticker, h);
  }
  const symbols = [...bySymbol.values()];
  const staleSymbols = symbols.filter((h) => isStale(h.priceRefreshedAt));

  if (staleSymbols.length === 0) {
    // Prices still fresh — but always snapshot so the charts have today's data point
    await recordSnapshot(user.id, holdings);
    return Response.json({ refreshed: 0, skipped: symbols.length });
  }

  const tickers = staleSymbols.map((h) => h.ticker);
  const tickerCurrency = Object.fromEntries(
    staleSymbols.map((h) => [h.ticker, h.currency]),
  );
  // Currencies whose FX rate we should refresh (non-SGD, across all holdings)
  const currencies = [
    ...new Set(holdings.map((h) => h.currency).filter((c) => c !== "SGD")),
  ];

  const providers = await getProviderFlags();

  const [livePrices, liveFxRates, cryptoSparks, equitySparks] =
    await Promise.all([
      fetchLivePrices(tickers, tickerCurrency, providers),
      providers.frankfurter
        ? fetchLiveFxRates()
        : Promise.resolve({} as Record<string, number>),
      providers.coingecko
        ? fetchCryptoSparks(tickers)
        : Promise.resolve({} as Record<string, number[]>),
      providers.finnhub
        ? fetchEquitySparks(tickers, tickerCurrency)
        : Promise.resolve({} as Record<string, number[]>),
    ]);

  // 1. Update the shared price cache — one write per symbol
  await Promise.all(
    staleSymbols.map((h) => {
      const priceResult = livePrices[h.ticker];
      const newPrice = priceResult?.price;
      const sparkData = cryptoSparks[h.ticker] ?? equitySparks[h.ticker];
      return upsertTickerQuote(h.ticker, {
        currentPrice: newPrice && newPrice > 0 ? newPrice : h.currentPrice,
        prevPrice: priceResult?.prevPrice,
        prevPriceSource: priceResult?.prevPriceSource,
        sparkData,
      });
    }),
  );

  // 2. Update FX rates — one write per non-SGD currency
  await Promise.all(
    currencies.map((ccy) => {
      const rate = liveFxRates[ccy];
      return rate && rate > 0 ? updateFxRate(ccy, rate) : Promise.resolve();
    }),
  );

  // Re-fetch after updates to get fresh derived values, then snapshot
  const fresh = await fetchHoldings(user.id);
  await recordSnapshot(user.id, fresh);

  return Response.json({
    refreshed: staleSymbols.length,
    skipped: symbols.length - staleSymbols.length,
  });
}
