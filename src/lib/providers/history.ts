import YahooFinanceClass from "yahoo-finance2";
import { toYahooSymbol } from "@/lib/prices";

const yahooFinance = new YahooFinanceClass();

export interface TickerHistory {
  dailyCloses: number[]; // ~1 year of daily closes (for Sharpe)
  monthlyCloses: number[]; // ~5 years of month-end closes (for CAGR)
}

function yearsAgo(n: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
}

/**
 * 1yr daily + 5yr monthly close history for one symbol via Yahoo `chart`.
 * Returns empty arrays on failure so callers degrade gracefully.
 */
export async function fetchTickerHistory(
  ticker: string,
  currency: string,
): Promise<TickerHistory> {
  const sym = toYahooSymbol(ticker, currency);
  try {
    const [daily, monthly] = await Promise.all([
      yahooFinance.chart(sym, { period1: yearsAgo(1), interval: "1d" }),
      yahooFinance.chart(sym, { period1: yearsAgo(5), interval: "1mo" }),
    ]);
    const closes = (q: { close: number | null }[]) =>
      q.map((p) => p.close).filter((c): c is number => typeof c === "number" && c > 0);
    return {
      dailyCloses: closes(daily.quotes ?? []),
      monthlyCloses: closes(monthly.quotes ?? []),
    };
  } catch (e) {
    console.warn(`[fetchTickerHistory] Yahoo error for ${ticker}:`, e);
    return { dailyCloses: [], monthlyCloses: [] };
  }
}

/**
 * Daily close history for a date range via Yahoo `chart`, as a { "YYYY-MM-DD":
 * close } map — the same shape the EODHD historical fetch returns, so the
 * backfill route can use it as a drop-in fallback. Empty object on failure.
 */
export async function fetchDailyCloses(
  ticker: string,
  currency: string,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const sym = toYahooSymbol(ticker, currency);
  try {
    const res = await yahooFinance.chart(sym, {
      period1: from,
      period2: to,
      interval: "1d",
    });
    const out: Record<string, number> = {};
    for (const q of res.quotes ?? []) {
      if (q.date && typeof q.close === "number" && q.close > 0) {
        const d = (q.date instanceof Date ? q.date : new Date(q.date))
          .toISOString()
          .slice(0, 10);
        out[d] = q.close;
      }
    }
    return out;
  } catch (e) {
    console.warn(`[fetchDailyCloses] Yahoo error for ${ticker}:`, e);
    return {};
  }
}

/** Period-over-period simple returns from a close series. */
export function returnsFromCloses(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1);
  }
  return r;
}
