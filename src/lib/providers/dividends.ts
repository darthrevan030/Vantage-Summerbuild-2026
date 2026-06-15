import YahooFinanceClass from "yahoo-finance2";
import { toYahooSymbol } from "@/lib/prices";

const yahooFinance = new YahooFinanceClass();

export interface DividendResult {
  yieldTtm: number; // trailing-twelve-month yield in percentage points
  source: string;
}

/**
 * Trailing dividend yield per ticker via Yahoo `quote`.
 * `trailingAnnualDividendYield` is a fraction (0.025 → 2.5%); only positive
 * values are returned, so non-dividend payers are simply absent from the map.
 */
export async function fetchDividendYields(
  tickers: string[],
  tickerCurrency: Record<string, string> = {},
): Promise<Record<string, DividendResult>> {
  const out: Record<string, DividendResult> = {};
  if (tickers.length === 0) return out;

  const symbolToTicker: Record<string, string> = {};
  const symbols: string[] = [];
  for (const t of tickers) {
    const sym = toYahooSymbol(t, tickerCurrency[t] ?? "USD");
    symbolToTicker[sym] = t;
    symbols.push(sym);
  }

  try {
    const quotes = await yahooFinance.quote(symbols, {}, { validateResult: false });
    const arr = Array.isArray(quotes) ? quotes : [quotes];
    for (const q of arr) {
      const ticker = symbolToTicker[q.symbol];
      if (!ticker) continue;
      const y =
        typeof q.trailingAnnualDividendYield === "number"
          ? q.trailingAnnualDividendYield
          : null;
      if (y != null && y > 0) {
        out[ticker] = { yieldTtm: y * 100, source: "Yahoo TTM" };
      }
    }
  } catch (e) {
    console.warn("[fetchDividendYields] Yahoo error:", e);
  }
  return out;
}
