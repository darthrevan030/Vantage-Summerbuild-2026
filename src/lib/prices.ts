const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin",
  SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin",
};
const GOLD_TICKERS = new Set(["GOLD", "XAU", "GLD"]);

// EODHD exchange suffix by holding currency.
// If the user enters "VWRA.LSE" the dot takes precedence and this map is bypassed.
const EODHD_EXCHANGE: Record<string, string> = {
  USD: "US",
  GBP: "LSE",
  EUR: "XETRA",
  JPY: "TSE",
  INR: "NSE",
  HKD: "HK",   // EODHD uses HK, not HKEX
  SGD: "SI",   // EODHD uses SI, not SG
  AUD: "AU",   // EODHD uses AU, not ASX
  CNY: "SHG",
  CNH: "SHG",
};

// Remap old/incorrect app exchange codes → correct EODHD codes
// Handles DB entries written before codes were corrected
const EODHD_CODE_REMAP: Record<string, string> = {
  SG:   "SI",   // SGX Singapore (old app code → EODHD)
  HKEX: "HK",  // Hong Kong Exchange
  ASX:  "AU",  // Australian Securities Exchange
  MI:   "MI",  // Borsa Italiana — keep as-is, EODHD may support
};

// Finnhub uses "EXCHANGE:TICKER" for non-US. US stocks use bare ticker.
const FINNHUB_PREFIX: Record<string, string> = {
  GBP: "LSE:",
  EUR: "XETRA:",
  JPY: "TSE:",
  INR: "NSE:",
  HKD: "HKEX:",
  SGD: "SGX:",
  AUD: "ASX:",
  CNY: "SHG:",
  CNH: "SHG:",
};

/**
 * Returns the EODHD real-time symbol for a ticker.
 * If the ticker already contains a dot (e.g. "VWRA.LSE") it's used as-is.
 * Otherwise the holding's currency is used to pick the exchange suffix.
 */
function toEohdSymbol(ticker: string, currency: string): string {
  if (ticker.includes(".")) {
    const [sym, exc] = ticker.split(".");
    return `${sym}.${EODHD_CODE_REMAP[exc] ?? exc}`;
  }
  const exchange = EODHD_EXCHANGE[currency] ?? "US";
  return `${ticker}.${exchange}`;
}

/**
 * Returns the Finnhub symbol for a ticker.
 * Non-USD holdings get a "EXCHANGE:" prefix; USD/unknown get bare ticker.
 * If the ticker already has a dot (EODHD format like "VWRA.LSE"), strip the suffix
 * and apply the Finnhub prefix instead.
 */
function toFinnhubSymbol(ticker: string, currency: string): string {
  const base = ticker.includes(".") ? ticker.split(".")[0] : ticker;
  const prefix = FINNHUB_PREFIX[currency] ?? "";
  return `${prefix}${base}`;
}

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

/**
 * Fetches live prices for all tickers.
 * tickerCurrency maps ticker → holding currency so the correct exchange is used.
 */
export async function fetchLivePrices(
  tickers: string[],
  tickerCurrency: Record<string, string> = {}
): Promise<Record<string, number>> {
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
      // Build symbol → original ticker reverse map, then do one bulk call instead of N
      const symbolToTicker: Record<string, string> = {};
      const symbols = equities.map((ticker) => {
        const sym = toEohdSymbol(ticker, tickerCurrency[ticker] ?? "USD");
        symbolToTicker[sym] = ticker;
        return sym;
      });
      try {
        const [first, ...rest] = symbols;
        const extra = rest.length > 0 ? `&s=${rest.join(",")}` : "";
        const res = await fetch(
          `https://eodhd.com/api/real-time/${first}?api_token=${process.env.EODHD_API_KEY}&fmt=json${extra}`
        );
        if (!res.ok) return;
        const json = await res.json();
        // Single ticker → plain object; multiple tickers → array
        const items: { code: string; close: number }[] = Array.isArray(json) ? json : [json];
        for (const item of items) {
          const ticker = symbolToTicker[item.code];
          if (ticker && item.close) prices[ticker] = item.close;
        }
      } catch {}
    })(),
  ]);

  return prices;
}

/**
 * 30-day daily closes for equity tickers via Finnhub stock/candle.
 * tickerCurrency maps ticker → holding currency for correct exchange prefix.
 * Returns {} on any failure or missing key.
 */
export async function fetchEquitySparks(
  tickers: string[],
  tickerCurrency: Record<string, string> = {}
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
      const symbol = toFinnhubSymbol(ticker, tickerCurrency[ticker] ?? "USD");
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${key}`
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

/**
 * Frankfurter.app — free, no key. Returns SGD-per-foreign rates.
 * Frankfurter with base=SGD gives {USD: 0.777} = "1 SGD buys 0.777 USD" (foreign per SGD).
 * We invert to get "SGD per 1 foreign unit" so the formula units*price*fxRate works correctly.
 */
export async function fetchLiveFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?base=SGD", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return {};
    const json = await res.json();
    const raw = json.rates as Record<string, number>;
    return Object.fromEntries(
      Object.entries(raw).filter(([, r]) => r > 0).map(([ccy, r]) => [ccy, 1 / r])
    );
  } catch {
    return {};
  }
}
