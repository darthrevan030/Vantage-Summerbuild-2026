import YahooFinanceClass from "yahoo-finance2";
import { fetchSGXPrices } from "@/lib/providers/sgx";
// v3: default export is the class, not an instance
const yahooFinance = new YahooFinanceClass();

export interface PriceResult {
  price: number;
  prevPrice: number | null;
  prevPriceSource: string | null;
}

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
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
  HKD: "HK", // EODHD uses HK, not HKEX
  SGD: "SI", // EODHD uses SI, not SG
  AUD: "AU", // EODHD uses AU, not ASX
  CNY: "SHG",
  CNH: "SHG",
};

// Remap old/incorrect app exchange codes → correct EODHD codes
// Handles DB entries written before codes were corrected
const EODHD_CODE_REMAP: Record<string, string> = {
  SG: "SI", // SGX Singapore (old app code → EODHD)
  HKEX: "HK", // Hong Kong Exchange
  ASX: "AU", // Australian Securities Exchange
  MI: "MI", // Borsa Italiana — keep as-is, EODHD may support
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

// Yahoo Finance suffixes by app exchange code (app ticker suffix or EODHD_CODE_REMAP output).
// US stocks use no suffix. Covers all 14 exchanges the app supports.
const YAHOO_SUFFIX: Record<string, string> = {
  US: "",
  LSE: ".L",
  XETRA: ".DE",
  TSE: ".T",
  NSE: ".NS",
  BSE: ".BO",
  HK: ".HK",
  HKEX: ".HK",
  SI: ".SI", // SGX — EODHD remaps SG→SI; Yahoo also uses .SI
  SG: ".SI",
  AU: ".AX", // ASX — EODHD remaps ASX→AU; Yahoo uses .AX
  ASX: ".AX",
  SHG: ".SS",
  SHE: ".SZ",
  MI: ".MI",
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
 * Returns the Yahoo Finance symbol for a ticker.
 * US stocks: bare ticker (no suffix). All others: ticker + exchange suffix.
 */
function toYahooSymbol(ticker: string, currency: string): string {
  if (ticker.includes(".")) {
    const dot = ticker.lastIndexOf(".");
    const sym = ticker.slice(0, dot);
    const exc = ticker.slice(dot + 1).toUpperCase();
    if (exc in YAHOO_SUFFIX) {
      const suffix = YAHOO_SUFFIX[exc];
      return suffix ? `${sym}${suffix}` : sym;
    }
    return ticker; // unknown exchange — pass through as-is
  }
  // no dot — look up by currency; default to bare ticker (US)
  const exc = EODHD_EXCHANGE[currency] ?? "US";
  const suffix = YAHOO_SUFFIX[exc] ?? "";
  return suffix ? `${ticker}${suffix}` : ticker;
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
  tickers: string[],
): Promise<Record<string, number[]>> {
  const crypto = tickers.filter((t) => CRYPTO_IDS[t]);
  if (crypto.length === 0) return {};

  const results: Record<string, number[]> = {};
  await Promise.all(
    crypto.map(async (ticker) => {
      try {
        const id = CRYPTO_IDS[ticker];
        const res = await fetch(
          `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`,
        );
        if (!res.ok) return;
        const json = await res.json();
        const closes = (json.prices as [number, number][]).map(([, p]) => p);
        if (closes.length >= 2) results[ticker] = closes;
      } catch {}
    }),
  );
  return results;
}

export interface PriceProviders {
  sgx?:       boolean;
  eodhd?:     boolean;
  yahoo?:     boolean;
  coingecko?: boolean;
  goldapi?: boolean;
}

/**
 * Fetches live prices for all tickers.
 * Returns PriceResult per ticker including prevPrice and its source.
 * SGX tickers (SGD currency, non-crypto, non-gold) hit the SGX direct API first;
 * other equities use EODHD → Yahoo fallback chain.
 */
export async function fetchLivePrices(
  tickers: string[],
  tickerCurrency: Record<string, string> = {},
  providers: PriceProviders = {}
): Promise<Record<string, PriceResult>> {
  const results: Record<string, PriceResult> = {};
  if (tickers.length === 0) return results;

  const crypto   = tickers.filter((t) => CRYPTO_IDS[t]);
  const gold     = tickers.filter((t) => GOLD_TICKERS.has(t));
  const allEquities = tickers.filter((t) => !CRYPTO_IDS[t] && !GOLD_TICKERS.has(t));

  // SGX tickers: SGD-denominated equities (not crypto/gold)
  const sgxTickers = allEquities.filter((t) => (tickerCurrency[t] ?? "USD") === "SGD");
  const otherEquities = allEquities.filter((t) => (tickerCurrency[t] ?? "USD") !== "SGD");

  await Promise.all([
    crypto.length > 0 && (providers.coingecko ?? true) && (async () => {
      const ids = crypto.map((t) => CRYPTO_IDS[t]).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
      );
      if (res.ok) {
        const json = await res.json();
        for (const t of crypto) {
          const p = json[CRYPTO_IDS[t]]?.usd;
          if (p) results[t] = { price: p, prevPrice: null, prevPriceSource: null };
        }
      }
    })(),

    gold.length > 0 && (providers.goldapi ?? true) && process.env.GOLDAPI_KEY && (async () => {
      const res = await fetch("https://www.goldapi.io/api/XAU/USD", {
        headers: { "x-access-token": process.env.GOLDAPI_KEY! },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.price) for (const t of gold) results[t] = { price: json.price, prevPrice: null, prevPriceSource: null };
      }
    })(),

    // SGX direct API — highest priority for SGD equities
    sgxTickers.length > 0 && (providers.sgx ?? true) && (async () => {
      try {
        const sgxData = await fetchSGXPrices(new Set(sgxTickers));
        for (const [ticker, q] of Object.entries(sgxData)) {
          if (q.price > 0) {
            results[ticker] = { price: q.price, prevPrice: q.prevPrice, prevPriceSource: "SGX" };
          }
        }
      } catch (e) {
        console.warn("[fetchLivePrices] SGX error:", e);
      }
    })(),

    // EODHD bulk call for non-SGD equities
    otherEquities.length > 0 && (providers.eodhd ?? true) && process.env.EODHD_API_KEY && (async () => {
      const symbolToTicker: Record<string, string> = {};
      const symbols = otherEquities.map((ticker) => {
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
        if (!res.ok) {
          console.warn("[fetchLivePrices] EODHD non-ok:", res.status, symbols);
          return;
        }
        const json = await res.json();
        const items: { code: string; close: unknown; previousClose?: unknown }[] =
          Array.isArray(json) ? json : [json];
        for (const item of items) {
          const ticker = symbolToTicker[item.code];
          if (!ticker) {
            console.warn("[fetchLivePrices] unmatched EODHD code:", item.code);
          }
          const close = typeof item.close === "number" && item.close > 0 ? item.close : null;
          if (!close) {
            console.warn("[fetchLivePrices] no usable close for", item.code, "got:", item.close);
          }
          const prevClose = typeof item.previousClose === "number" && item.previousClose > 0
            ? item.previousClose : null;
          if (ticker && close) {
            results[ticker] = { price: close, prevPrice: prevClose, prevPriceSource: prevClose ? "EODHD" : null };
          }
        }
      } catch (e) {
        console.warn("[fetchLivePrices] EODHD error:", e);
      }
    })(),
  ]);

  // Yahoo fallback: SGX tickers that SGX API missed + other equities that EODHD missed
  const unpriced = allEquities.filter((t) => !results[t]);
  // Also use Yahoo for SGX tickers that got a price but no prevPrice
  const needsPrevFromYahoo = sgxTickers.filter((t) => results[t] && results[t].prevPrice === null);
  const yahooNeeded = [...new Set([...unpriced, ...needsPrevFromYahoo])];

  if (yahooNeeded.length > 0 && (providers.yahoo ?? true)) {
    const yahooSymbolToTicker: Record<string, string> = {};
    const yahooSymbols: string[] = [];
    for (const ticker of yahooNeeded) {
      const sym = toYahooSymbol(ticker, tickerCurrency[ticker] ?? "USD");
      yahooSymbolToTicker[sym] = ticker;
      yahooSymbols.push(sym);
    }
    try {
      const quotes = await yahooFinance.quote(yahooSymbols, {}, { validateResult: false });
      const arr = Array.isArray(quotes) ? quotes : [quotes];
      for (const q of arr) {
        const ticker = yahooSymbolToTicker[q.symbol];
        if (!ticker) continue;
        const price = typeof q.regularMarketPrice === "number" && q.regularMarketPrice > 0
          ? q.regularMarketPrice : null;
        const prevPrice = typeof q.regularMarketPreviousClose === "number" && q.regularMarketPreviousClose > 0
          ? q.regularMarketPreviousClose : null;
        if (!results[ticker] && price) {
          results[ticker] = { price, prevPrice, prevPriceSource: prevPrice ? "Yahoo" : null };
        } else if (results[ticker] && results[ticker].prevPrice === null && prevPrice) {
          // Supplement prevPrice for holdings that got price from SGX but lacked prevPrice
          results[ticker] = { ...results[ticker], prevPrice, prevPriceSource: "Yahoo" };
        }
      }
    } catch (e) {
      console.warn("[fetchLivePrices] Yahoo error:", e);
    }
  }

  return results;
}

/**
 * 30-day daily closes for equity tickers via Finnhub stock/candle.
 * tickerCurrency maps ticker → holding currency for correct exchange prefix.
 * Returns {} on any failure or missing key.
 */
export async function fetchEquitySparks(
  tickers: string[],
  tickerCurrency: Record<string, string> = {},
): Promise<Record<string, number[]>> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return {};

  const equities = tickers.filter(
    (t) => !CRYPTO_IDS[t] && !GOLD_TICKERS.has(t),
  );
  if (equities.length === 0) return {};

  const now = Math.floor(Date.now() / 1000);
  const from = now - 30 * 24 * 3600;

  const results: Record<string, number[]> = {};
  await Promise.all(
    equities.map(async (ticker) => {
      const symbol = toFinnhubSymbol(ticker, tickerCurrency[ticker] ?? "USD");
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${key}`,
        );
        if (!res.ok) return;
        const json = await res.json();
        if (json.s !== "ok" || !Array.isArray(json.c) || json.c.length < 2)
          return;
        results[ticker] = json.c as number[];
      } catch {}
    }),
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
      Object.entries(raw)
        .filter(([, r]) => r > 0)
        .map(([ccy, r]) => [ccy, 1 / r]),
    );
  } catch {
    return {};
  }
}
