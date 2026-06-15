import type { ParsedTrade, ParseResult } from "./types";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "12 Jun 2026" or "12-JUN-2026"
function parseDate(day: string, mon: string, year: string): string {
  const m = MONTHS[mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase()] ?? "01";
  return `${year}-${m}-${day.padStart(2, "0")}`;
}

// Extract year from "Daily Statement & Tax Invoice for 12 JUN 2026"
function extractStatementYear(text: string): string {
  const m = text.match(/Daily Statement.*?(\d{4})/i);
  return m?.[1] ?? new Date().getFullYear().toString();
}

// ── Contract note rows (trades) ───────────────────────────────────────────────
// DBS Vickers contract notes have rows like:
// "Buy 200 MSFT NASDAQ 12 Jun USD 415.20 USD 83,040.00 ..."
// This handles them if present in a daily statement.
function parseTradeRows(text: string, year: string): ParsedTrade[] {
  const trades: ParsedTrade[] = [];
  // Pattern: action units ticker exchange day mon price amount
  const ROW_RE =
    /\b(Buy|Sell)\b\s+([\d,]+)\s+([A-Z0-9.\-]+)\s+([A-Z]+)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b[^\n]*\b(USD|SGD|HKD|GBP|EUR|AUD)\s+([\d,]+\.?\d*)/gi;

  for (const m of text.matchAll(ROW_RE)) {
    const [, action, unitsStr, ticker, rawExchange, day, mon, currency, priceStr] = m;
    const units = parseFloat(unitsStr.replace(/,/g, ""));
    const price = parseFloat(priceStr.replace(/,/g, ""));
    if (!units || !price) continue;

    const EXCHANGE_MAP: Record<string, string> = {
      NASDAQ: "US", NYSE: "US", SGX: "SI", LSE: "LSE", HKEX: "HK", ASX: "AU",
    };
    const exchange = EXCHANGE_MAP[rawExchange.toUpperCase()] ?? rawExchange;
    const fxRate = currency === "SGD" ? 1 : 0; // 0 = needs lookup

    trades.push({
      name: ticker,
      ticker,
      exchange,
      asset_type: "Equity",
      broker: "DBS Vickers",
      units,
      currency,
      buy_price: price,
      buy_date: parseDate(day, mon, year),
      buy_fx_rate: fxRate,
      fees: 0,
      source: "Cash",
      // mark transaction type hint in name for sell
      ...(action.toLowerCase() === "sell" ? { name: `[SELL] ${ticker}` } : {}),
    });
  }
  return trades;
}

export function parseDbsVickers(text: string): ParseResult {
  const warnings: string[] = [];
  const year = extractStatementYear(text);

  const trades = parseTradeRows(text, year);

  // Check if this is a dividend-only daily statement (no trades)
  const hasDividend = /\bDIV\b/.test(text);
  if (trades.length === 0) {
    if (hasDividend) {
      warnings.push(
        "This DBS Vickers statement contains only dividend/cash entries — no holdings to import.",
      );
    } else {
      warnings.push("No trades found in DBS Vickers statement.");
    }
  }

  return { broker: "DBS Vickers", docType: "daily-statement", trades, warnings };
}
