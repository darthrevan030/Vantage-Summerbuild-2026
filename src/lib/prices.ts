import YahooFinanceClass from "yahoo-finance2";
import { fetchSGXPrices } from "@/lib/providers/sgx";
import type { AssetType } from "@/types/holding";
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
 * Classifies tickers as ETFs via EODHD's search API. Returns { ticker: "ETF" }
 * only for tickers EODHD confidently reports as an ETF — used to upgrade
 * broker-statement imports that lack an asset descriptor (e.g. DBS Vickers
 * contract notes) without a hardcoded ticker list. Mirrors the refresh-time
 * heal's safety rule: EODHD reports REITs as "Common Stock", so we only ever
 * detect ETFs and never downgrade toward "Equity" — a REIT/Bond/etc. is never
 * mislabelled. No-ops (returns {}) when EODHD is unconfigured or on any error,
 * leaving the parser's default in place for the refresh-time heal to fix.
 */
export async function fetchEodhdAssetTypes(
  tickers: string[],
): Promise<Record<string, AssetType>> {
  const key = process.env.EODHD_API_KEY;
  const unique = [...new Set(tickers.filter((t) => t && t !== "—"))];
  if (!key || unique.length === 0) return {};

  const out: Record<string, AssetType> = {};
  await Promise.all(
    unique.map(async (ticker) => {
      try {
        const res = await fetch(
          `https://eodhd.com/api/search/${encodeURIComponent(ticker)}` +
            `?api_token=${key}&fmt=json&limit=10`,
        );
        if (!res.ok) return;
        const hits = await res.json();
        if (!Array.isArray(hits)) return;
        // Match the exact ticker; skip if no clean match rather than guess.
        const hit = hits.find(
          (h) => String(h?.Code ?? "").toUpperCase() === ticker.toUpperCase(),
        );
        if (hit && String(hit.Type) === "ETF") out[ticker] = "ETF";
      } catch {
        // ignore — fall back to the parser default + the refresh-time heal
      }
    }),
  );
  return out;
}

// Corporate-form / share-class noise dropped before name matching, so
// "ALPHABET INC CAP STK CL C" and "Alphabet Inc." compare on {ALPHABET}.
// Distinguishing nouns (TRUST, HOLDINGS, GROUP, FUNDING…) are deliberately
// KEPT — dropping them collapses "Northern Trust" → "Northern" and matches the
// wrong company. Single letters A/B/C are share-class markers, treated as noise.
const NAME_NOISE = new Set([
  "INC", "CORP", "CORPORATION", "LTD", "LIMITED", "PLC", "CO", "COMPANY",
  "ORD", "ADR", "CL", "CLASS", "STK", "CAP", "NV", "SA", "AG", "THE",
  "ETF", "NEW", "RG", "NY", "COM", "A", "B", "C",
]);
function nameTokens(s: string): Set<string> {
  return new Set(
    s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
      .filter((t) => t && !NAME_NOISE.has(t)),
  );
}
function tokenOverlap(query: Set<string>, hit: Set<string>): number {
  if (query.size === 0) return 0;
  let n = 0;
  for (const t of query) if (hit.has(t)) n++;
  return n / query.size;
}

/**
 * Resolve company names → ticker symbols via Yahoo Finance search. Used by the
 * DBS Vickers holdings import, whose "Securities Holdings" table carries names
 * but no symbols. Conservative by design: a ticker is filled only when Yahoo
 * returns an equity/ETF match on a US (unsuffixed) listing whose name overlaps
 * the query — otherwise the name is left unresolved (blank) for the user to fill
 * in the editable import rows, rather than guessing the wrong security or share
 * class. Best-effort: returns {} on any failure. Keys are the ORIGINAL names.
 */
export async function resolveTickersFromNames(
  names: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return {};

  const out: Record<string, string> = {};
  await Promise.all(
    unique.map(async (name) => {
      try {
        // Search on the cleaned token string: share-class / listing qualifiers
        // ("CAP STK CL C", "ADR", "NV NY RG-NEW") derail Yahoo's fuzzy search,
        // so "ALPHABET INC CAP STK CL C" is queried as "ALPHABET".
        const tokens = nameTokens(name);
        const query = tokens.size > 0 ? [...tokens].join(" ") : name;
        const res = await yahooFinance.search(query, { quotesCount: 6, newsCount: 0 });
        const quotes = (res?.quotes ?? []) as Array<{
          symbol?: string; shortname?: string; longname?: string;
          quoteType?: string; isYahooFinance?: boolean;
        }>;
        for (const q of quotes) {
          if (!q.isYahooFinance || !q.symbol) continue;
          if (q.quoteType !== "EQUITY" && q.quoteType !== "ETF") continue;
          if (q.symbol.includes(".")) continue; // US listings are unsuffixed
          // Strict: every meaningful query token must appear in the matched
          // name. Rejects wrong-company hits (e.g. "Northern" → Northern Dynasty
          // when we wanted Northern Trust); blanks stay blank for manual entry.
          const hitTokens = nameTokens(`${q.longname ?? ""} ${q.shortname ?? ""}`);
          if (tokenOverlap(tokens, hitTokens) === 1) {
            out[name] = q.symbol.toUpperCase();
            break;
          }
        }
      } catch {
        // ignore — leave the name unresolved for manual entry
      }
    }),
  );

  // Drop any ticker claimed by more than one distinct name — almost always
  // share-class siblings (Alphabet "CL A" vs "CL C" both reduce to "ALPHABET"),
  // which search can't tell apart. Blank them rather than write a wrong class.
  const claimants = new Map<string, string[]>();
  for (const [n, sym] of Object.entries(out)) {
    const list = claimants.get(sym) ?? [];
    list.push(n);
    claimants.set(sym, list);
  }
  for (const [, names_] of claimants) {
    if (names_.length > 1) for (const n of names_) delete out[n];
  }

  return out;
}

/**
 * Returns the Yahoo Finance symbol for a ticker.
 * US stocks: bare ticker (no suffix). All others: ticker + exchange suffix.
 */
export function toYahooSymbol(ticker: string, currency: string): string {
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

export interface TickerMeta {
  // Authoritative listing currency, or "GBp" for pence-quoted UK lines (passed
  // through unchanged; the caller decides to ignore it — price is in pence, not
  // pounds, so it must NOT be treated as "GBP").
  currency?: string;
  // Set ONLY when Yahoo reports a heal-safe asset type (see mapYahooQuoteType).
  assetType?: AssetType;
}

/**
 * Maps Yahoo's `quoteType` to our `AssetType`, but ONLY for values that are
 * unambiguous and safe to auto-heal toward. Yahoo classifies REITs as
 * "EQUITY", and Gold/RE/Bond/T-Bill are app conventions Yahoo doesn't model —
 * so the only direction we ever trust enough to overwrite stored data is
 * "ETF". Yahoo's "ETF" is authoritative (an ETF is never a stock or REIT);
 * healing toward "Equity" would clobber a correctly-categorised REIT, so we
 * deliberately never do it. Everything else returns undefined (no heal).
 */
function mapYahooQuoteType(quoteType: unknown): AssetType | undefined {
  return quoteType === "ETF" ? "ETF" : undefined;
}

/**
 * Looks up each ticker's authoritative listing currency AND asset type via
 * Yahoo Finance in a single batched quote call. Used to detect (and later
 * repair) instruments whose stored fields were guessed/defaulted at import —
 * e.g. a USD-denominated ETF listed on the LSE wrongly tracked as GBP, or an
 * ETF defaulted to "Equity" by a broker-statement parser. Crypto and gold are
 * USD by app convention and are skipped. Returns an entry only for tickers
 * Yahoo answers for; each field is present only when Yahoo reports it.
 */
export async function fetchTickerMeta(
  tickers: string[],
  tickerCurrency: Record<string, string> = {},
): Promise<Record<string, TickerMeta>> {
  const equities = tickers.filter((t) => !CRYPTO_IDS[t] && !GOLD_TICKERS.has(t));
  if (equities.length === 0) return {};

  const symbolToTicker: Record<string, string> = {};
  const symbols: string[] = [];
  for (const ticker of equities) {
    const sym = toYahooSymbol(ticker, tickerCurrency[ticker] ?? "USD");
    symbolToTicker[sym] = ticker;
    symbols.push(sym);
  }

  const out: Record<string, TickerMeta> = {};
  try {
    const quotes = await yahooFinance.quote(
      symbols,
      {},
      { validateResult: false },
    );
    const arr = Array.isArray(quotes) ? quotes : [quotes];
    for (const q of arr) {
      const ticker = symbolToTicker[q.symbol];
      if (!ticker) continue;
      const meta: TickerMeta = {};
      if (typeof q.currency === "string" && q.currency) meta.currency = q.currency;
      const assetType = mapYahooQuoteType(q.quoteType);
      if (assetType) meta.assetType = assetType;
      out[ticker] = meta;
    }
  } catch (e) {
    console.warn("[fetchTickerMeta] Yahoo error:", e);
  }
  return out;
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
