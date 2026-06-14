import { fetchHoldings, updateHoldingPrice, recordSnapshot } from "@/lib/supabase/data";
import { fetchLivePrices, fetchLiveFxRates, fetchCryptoSparks, fetchEquitySparks } from "@/lib/prices";
import { requireAuth } from "@/lib/supabase/guards";
import { enforceRateLimit } from "@/lib/supabase/rate-limit";

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
  const stale = holdings.filter((h) => isStale(h.priceRefreshedAt));

  if (stale.length === 0) {
    // Prices still fresh — but always snapshot so the charts have today's data point
    await recordSnapshot(user.id, holdings);
    return Response.json({ refreshed: 0, skipped: holdings.length });
  }

  // Unique non-placeholder tickers + their currencies for exchange resolution
  const tickers = [...new Set(stale.map((h) => h.ticker).filter((t) => t !== "—"))];
  const tickerCurrency = Object.fromEntries(
    stale.filter((h) => h.ticker !== "—").map((h) => [h.ticker, h.currency])
  );

  const [livePrices, liveFxRates, cryptoSparks, equitySparks] = await Promise.all([
    fetchLivePrices(tickers, tickerCurrency),
    fetchLiveFxRates(),
    fetchCryptoSparks(tickers),
    fetchEquitySparks(tickers, tickerCurrency),
  ]);

  await Promise.all(
    stale.map((h) => {
      const newPrice = livePrices[h.ticker];
      const newFx    = h.currency === "SGD" ? 1 : liveFxRates[h.currency];
      const sparkData = cryptoSparks[h.ticker] ?? equitySparks[h.ticker];
      return updateHoldingPrice(
        h.id,
        newPrice && newPrice > 0 ? newPrice : h.currentPrice,
        newFx    && newFx    > 0 ? newFx    : h.currentFxRate,
        user.id,
        sparkData,
      );
    })
  );

  // Re-fetch after updates to get fresh derived values, then snapshot
  const fresh = await fetchHoldings(user.id);
  await recordSnapshot(user.id, fresh);

  return Response.json({ refreshed: stale.length, skipped: holdings.length - stale.length });
}
