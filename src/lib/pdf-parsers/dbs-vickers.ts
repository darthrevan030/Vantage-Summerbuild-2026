import type { ParsedTrade, ParseResult } from "./types";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "12 Jun 2026" or "12-JUN-2026"
function parseDate(day: string, mon: string, year: string): string {
  const m = MONTHS[mon.charAt(0).toUpperCase() + mon.slice(1, 3).toLowerCase()] ?? "01";
  return `${year}-${m}-${day.padStart(2, "0")}`;
}

// Extract year from "Daily Statement & Tax Invoice for 12 JUN 2026"
function extractStatementYear(text: string): string {
  const m = text.match(/Statement.*?(\d{4})/i);
  return m?.[1] ?? new Date().getFullYear().toString();
}

// Statement date for the holdings snapshot: prefer "as at DD Mon YYYY",
// fall back to any "DD Mon YYYY" / "DD-MON-YYYY" near "Statement Date".
function extractStatementDate(text: string): string {
  const m1 = text.match(/as at\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (m1) return parseDate(m1[1], m1[2], m1[3]);
  const m2 = text.match(/Statement Date\s*\n?\s*(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})/i);
  if (m2) return parseDate(m2[1], m2[2], m2[3]);
  const m3 = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
  return m3 ? parseDate(m3[1], m3[2], m3[3]) : "";
}

const EXCHANGE_MAP: Record<string, string> = {
  NASDAQ: "US", NYSE: "US", SGX: "SI", LSE: "LSE", HKEX: "HK", ASX: "AU",
};

// ── Contract note rows (trades) ───────────────────────────────────────────────
// DBS Vickers contract notes have rows like:
// "Buy 200 MSFT NASDAQ 12 Jun USD 415.20 USD 83,040.00 ..."
// Kept as a fallback for statements that actually carry inline trade rows.
function parseTradeRows(text: string, year: string): ParsedTrade[] {
  const trades: ParsedTrade[] = [];
  const ROW_RE =
    /\b(Buy|Sell)\b\s+([\d,]+)\s+([A-Z0-9.\-]+)\s+([A-Z]+)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b[^\n]*\b(USD|SGD|HKD|GBP|EUR|AUD)\s+([\d,]+\.?\d*)/gi;

  for (const m of text.matchAll(ROW_RE)) {
    const [, action, unitsStr, ticker, rawExchange, day, mon, currency, priceStr] = m;
    const units = parseFloat(unitsStr.replace(/,/g, ""));
    const price = parseFloat(priceStr.replace(/,/g, ""));
    if (!units || !price) continue;

    const exchange = EXCHANGE_MAP[rawExchange.toUpperCase()] ?? rawExchange;
    const fxRate = currency === "SGD" ? 1 : 0; // 0 = route fills via FX lookup

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
      ...(action.toLowerCase() === "sell" ? { name: `[SELL] ${ticker}` } : {}),
    });
  }
  return trades;
}

// ── Securities Holdings snapshot ──────────────────────────────────────────────
// The Monthly Statement's "Securities Holdings" table is the only place with the
// full position list. pdf-parse v1 glues the leading quantity columns into one
// token (e.g. "0.00000.00000.000047.000047.0000", or "0002929" for whole-share
// rows — ambiguous to split). Each row also carries Last-Done price and Market
// Value, so units = MarketValue / Price recovers quantity exactly without ever
// touching the glued block. There is no cost basis on a statement, so last-done
// price stands in as the buy price (the user edits it in the import rows).

// DBS "Mkt" column code → app exchange code (anchors each holdings row).
const MKT_MAP: Record<string, string> = {
  US: "US", SG: "SI", SI: "SI", HK: "HK", LN: "LSE", LSE: "LSE",
  AU: "AU", JP: "TSE", TH: "TH", MY: "MY", KR: "KR", CN: "CN", IN: "IN",
};

// Repeated page header/footer lines that interleave the table across page
// breaks — stripped so trailing name fragments ("500 ETF") aren't polluted.
const BOILERPLATE = [
  /^Please note:/i,
  /^Securities\.\s/i,
  /^Please refer to end of statement/i,
  /^Securities Trading Account$/i,
  /^Monthly Statement for/i,
  /^Daily Statement/i,
  /^DBS Vickers Securities \(Singapore\)/i,
  /^12 Marina Boulevard/i,
  /^www\.dbsvickers\.com/i,
  /^Customer Service Line/i,
  /^Page\s+\d+/i,
  /^Securities Holdings/i,
  /^as at\b/i,
  /^MktSecurity/i,
  /^\(1\)\(2\)/,
  /^Note:\s*Available/i,
  /^Free\s*=\s*Fully/i,
];

const CCY_RE = /^(USD|SGD|HKD|GBP|EUR|AUD|CNH|CNY|JPY)\s*([\d,]+\.\d{2})\b/;
const PRICE_RE = /^[\d,]+\.\d{2}$/;
const num = (s: string) => parseFloat(s.replace(/,/g, ""));

function buildHolding(rowLines: string[], buyDate: string): ParsedTrade | null {
  const mkt = rowLines[0].trim().toUpperCase();
  const body = rowLines.slice(1).map((l) => l.trim()).filter(Boolean);

  let price = 0;
  let currency = "";
  let marketValue = 0;
  const nameParts: string[] = [];

  for (const line of body) {
    const ccy = line.match(CCY_RE);
    if (ccy) {
      currency = ccy[1];
      marketValue = num(ccy[2]);
      continue;
    }
    if (price === 0 && PRICE_RE.test(line)) {
      price = num(line);
      continue;
    }
    if (/[A-Za-z]/.test(line)) nameParts.push(line);
  }

  const name = nameParts.join(" ").replace(/\s+/g, " ").trim();
  if (!name || price <= 0 || marketValue <= 0) return null;

  const units = Math.round((marketValue / price) * 10000) / 10000;
  const asset_type = /\bETF\b/.test(name) ? "ETF" : "Equity";

  return {
    name,
    ticker: "", // resolved from name in the parse-pdf route (best-effort)
    exchange: MKT_MAP[mkt] ?? mkt,
    asset_type,
    broker: "DBS Vickers",
    units,
    currency: currency || "USD",
    buy_price: price,
    buy_date: buyDate,
    buy_fx_rate: currency === "SGD" ? 1 : 0, // 0 = route fills via FX lookup
    fees: 0,
    source: "Cash",
  };
}

function parseSecuritiesHoldings(text: string): ParseResult {
  const warnings: string[] = [];
  const buyDate = extractStatementDate(text);

  // Isolate the holdings section.
  const start = text.indexOf("Securities Holdings");
  let section = text.substring(start);
  const endMarkers = ["Note: Available", "Securities Movement"];
  const end = endMarkers
    .map((m) => section.indexOf(m))
    .filter((i) => i > 0)
    .sort((a, b) => a - b)[0];
  if (end) section = section.substring(0, end);

  // Drop boilerplate, then group lines into rows anchored on the Mkt code.
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !BOILERPLATE.some((re) => re.test(l)));

  const rows: string[][] = [];
  for (const line of lines) {
    if (MKT_MAP[line.toUpperCase()]) {
      rows.push([line]);
    } else if (rows.length > 0) {
      rows[rows.length - 1].push(line);
    }
  }

  const trades: ParsedTrade[] = [];
  for (const row of rows) {
    const holding = buildHolding(row, buyDate);
    if (holding) trades.push(holding);
    else warnings.push(`Could not parse a holdings row (starting "${row.slice(0, 2).join(" ")}").`);
  }

  if (trades.length === 0 && warnings.length === 0) {
    warnings.push("No holdings found in DBS Vickers statement.");
  }

  return { broker: "DBS Vickers", docType: "securities-holdings", trades, warnings };
}

export function parseDbsVickers(text: string): ParseResult {
  // Monthly statement carries the Securities Holdings snapshot — the richest,
  // most importable section. Prefer it over inline transaction rows.
  if (/Securities Holdings/i.test(text)) {
    return parseSecuritiesHoldings(text);
  }

  // Daily statement / Transaction Advice: only cash/dividend entries, no holdings.
  const isDividendOrCash =
    /Transaction Advice/i.test(text) ||
    /Daily Statement/i.test(text) ||
    /\bDIV\b|\bCDN\b|Debit\/Credit Note/i.test(text);

  const year = extractStatementYear(text);
  const trades = parseTradeRows(text, year);

  if (trades.length === 0) {
    if (isDividendOrCash) {
      return {
        broker: "DBS Vickers",
        docType: "dividend-cash-advice",
        trades: [],
        warnings: ["This DBS Vickers dividend/cash advice has no holdings to import."],
      };
    }
    return {
      broker: "DBS Vickers",
      docType: "daily-statement",
      trades: [],
      warnings: ["No trades found in DBS Vickers statement."],
    };
  }

  return { broker: "DBS Vickers", docType: "daily-statement", trades, warnings: [] };
}
