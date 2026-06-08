const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin",
  SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin",
};
const GOLD_TICKERS = new Set(["GOLD", "XAU", "GLD"]);

/** 30-day daily closes for crypto tickers via CoinGecko market_chart. Returns {} on any failure. */
export async function fetchCryptoSparks(
  tickers: string[]
): Promise<Record<string, number[]>> {
  const crypto = tickers.filter((t) => CRYPTO_IDS[t]);
  if (crypto.length === 0) return {};

  const results: Record<string, number[]> = {};
  await Promise.all(
    crypto.map(async (ticker) => {
      try {
        const id = CRYPTO_IDS[ticker];
        const res = await fetch(
          `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`
        );
        if (!res.ok) return;
        const json = await res.json();
        const closes = (json.prices as [number, number][]).map(([, p]) => p);
        if (closes.length >= 2) results[ticker] = closes;
      } catch {}
    })
  );
  return results;
}

export async function fetchLivePrices(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  if (tickers.length === 0) return prices;

  const crypto   = tickers.filter((t) => CRYPTO_IDS[t]);
  const gold     = tickers.filter((t) => GOLD_TICKERS.has(t));
  const equities = tickers.filter((t) => !CRYPTO_IDS[t] && !GOLD_TICKERS.has(t));

  await Promise.all([
    crypto.length > 0 && (async () => {
      const ids = crypto.map((t) => CRYPTO_IDS[t]).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
      );
      if (res.ok) {
        const json = await res.json();
        for (const t of crypto) {
          const p = json[CRYPTO_IDS[t]]?.usd;
          if (p) prices[t] = p;
        }
      }
    })(),

    gold.length > 0 && process.env.GOLDAPI_KEY && (async () => {
      const res = await fetch("https://www.goldapi.io/api/XAU/USD", {
        headers: { "x-access-token": process.env.GOLDAPI_KEY! },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.price) for (const t of gold) prices[t] = json.price;
      }
    })(),

    equities.length > 0 && process.env.EODHD_API_KEY && (async () => {
      await Promise.all(
        equities.map(async (ticker) => {
          const res = await fetch(
            `https://eodhd.com/api/real-time/${ticker}.US?api_token=${process.env.EODHD_API_KEY}&fmt=json`
          );
          if (res.ok) {
            const json = await res.json();
            if (json.close) prices[ticker] = json.close;
          }
        })
      );
    })(),
  ]);

  return prices;
}

/** 30-day daily closes for equity tickers via Finnhub stock/candle. Returns {} on any failure or missing key. */
export async function fetchEquitySparks(
  tickers: string[]
): Promise<Record<string, number[]>> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return {};

  const equities = tickers.filter((t) => !CRYPTO_IDS[t] && !GOLD_TICKERS.has(t));
  if (equities.length === 0) return {};

  const now = Math.floor(Date.now() / 1000);
  const from = now - 30 * 24 * 3600;

  const results: Record<string, number[]> = {};
  await Promise.all(
    equities.map(async (ticker) => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${now}&token=${key}`
        );
        if (!res.ok) return;
        const json = await res.json();
        if (json.s !== "ok" || !Array.isArray(json.c) || json.c.length < 2) return;
        results[ticker] = json.c as number[];
      } catch {}
    })
  );
  return results;
}

/** Frankfurter.app — free, no key, SGD-based rates. Returns {} on failure. */
export async function fetchLiveFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?base=SGD", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return {};
    const json = await res.json();
    return json.rates as Record<string, number>;
  } catch {
    return {};
  }
}
