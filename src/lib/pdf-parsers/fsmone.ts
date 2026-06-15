import type { ParsedTrade, ParseResult } from "./types";

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  Jun: "06", Jul: "07", Aug: "08", Sep: "09",
  Oct: "10", Nov: "11", Dec: "12",
};

// "09 Jun 2026" or "25-May-2026"
function parseDate(s: string): string {
  const m1 = s.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m1) {
    const mon = MONTHS[m1[2]] ?? MONTHS[m1[2].substring(0, 3)] ?? "01";
    return `${m1[3]}-${mon}-${m1[1].padStart(2, "0")}`;
  }
  const m2 = s.match(/(\d{1,2})-(\w+)-(\d{4})/);
  if (m2) {
    const mon = MONTHS[m2[2]] ?? MONTHS[m2[2].substring(0, 3)] ?? "01";
    return `${m2[3]}-${mon}-${m2[1].padStart(2, "0")}`;
  }
  return "";
}

// Map PDF exchange labels → app exchange codes
const EXCHANGE_MAP: Record<string, string> = {
  LSE: "LSE",
  SGX: "SI",
  NYSE: "US",
  NASDAQ: "US",
  HKEX: "HK",
  HK: "HK",
  ASX: "AU",
  TSE: "TSE",
  XETRA: "XETRA",
  BURSA: "",
};

const EXCHANGE_PATTERN = /\b(LSE|SGX|NYSE|NASDAQ|HKEX|ASX|TSE|XETRA|HK|BURSA)\b/;

function normalizeAssetType(raw: string): string {
  const t = raw.toUpperCase().trim();
  if (t === "ETF") return "ETF";
  if (t.includes("REIT")) return "REIT";
  if (t.includes("BOND")) return "Bond";
  if (t.includes("T-BILL") || t.includes("TBILL")) return "T-Bill";
  return "Equity";
}

// ── ETF / Stock Confirmation Note ────────────────────────────────────────────

function parseEtfConfirmationNote(text: string): ParseResult {
  const warnings: string[] = [];

  // Contract number is the key anchor (BSTK…, SSTK…, etc.)
  const contractMatch = text.match(/\b([A-Z]{3,}\d{10,})\b/);
  if (!contractMatch) {
    warnings.push("No contract number found in confirmation note.");
    return { broker: "FSMOne", docType: "etf-confirmation", trades: [], warnings };
  }

  const contractNo = contractMatch[1];
  const startIdx = text.indexOf(contractNo);

  // Date appears just before the contract number in the linearized text
  const pre = text.substring(Math.max(0, startIdx - 300), startIdx);
  const dateMatch = pre.match(/(\d{2} \w{3} \d{4})\s*\n?\s*$/);
  const buyDate = dateMatch ? parseDate(dateMatch[1]) : "";
  if (!buyDate) warnings.push("Could not parse transaction date.");

  // All text after the contract number
  const post = text.substring(startIdx + contractNo.length);

  // Exchange code
  const exchMatch = EXCHANGE_PATTERN.exec(post);
  const rawExchange = exchMatch?.[1] ?? "";
  const exchange = rawExchange ? (EXCHANGE_MAP[rawExchange] ?? rawExchange) : "";
  if (!rawExchange) warnings.push("Could not detect exchange.");

  // Security name block: between exchange code and "RSP" / "Cash Account"
  const afterExchange = rawExchange
    ? post.substring(post.indexOf(rawExchange) + rawExchange.length)
    : post;
  const payIdx = afterExchange.search(/\bRSP\b|Cash Account/);
  const secBlock = afterExchange.substring(0, payIdx > 0 ? payIdx : 300);

  // Ticker is the last (SYMBOL) in the block, e.g. "(SPYL)"
  const tickerMatches = [...secBlock.matchAll(/\(([A-Z0-9]{2,6})\)/g)];
  const ticker = tickerMatches.length > 0
    ? tickerMatches[tickerMatches.length - 1][1]
    : "";

  // Clean name: remove ticker paren, normalize whitespace
  const name = secBlock
    .replace(/\([A-Z0-9]{2,6}\)\s*$/, "")
    .replace(/[\n\r]+/g, " ")
    .trim()
    || ticker
    || "Unknown";

  // After payment method, parse quantities / prices / FX rate
  const afterPayment = payIdx > 0 ? afterExchange.substring(payIdx) : afterExchange;

  // All currency+amount occurrences: "USD 18.365287", "SGD 980.96"
  const ccyAmounts = [...afterPayment.matchAll(
    /\b(USD|SGD|EUR|GBP|HKD|AUD)\s+([\d,]+\.?\d*)/g,
  )];

  let currency = "SGD";
  let price = 0;
  let fxRate = 1;

  if (ccyAmounts.length > 0) {
    // First non-SGD amount = transacted price in asset currency
    const priceEntry = ccyAmounts.find((m) => m[1] !== "SGD") ?? ccyAmounts[0];
    currency = priceEntry[1];
    price = parseFloat(priceEntry[2].replace(/,/g, ""));
  }

  // Quantity: standalone decimal just before the first currency+amount
  const firstCcyIdx = ccyAmounts.length > 0
    ? afterPayment.indexOf(ccyAmounts[0][0])
    : afterPayment.length;
  const beforeFirst = afterPayment.substring(0, firstCcyIdx);
  const qtyMatch = beforeFirst.match(/\b(\d+\.?\d*)\s*$/);
  const units = qtyMatch ? parseFloat(qtyMatch[1]) : 0;
  if (units <= 0) warnings.push("Could not parse quantity.");

  // FX rate: small decimal after the SGD settlement amount
  // FSMOne shows it as SGD/XXX rate (e.g. 0.774384 = how many USD per 1 SGD)
  if (currency !== "SGD") {
    const sgdAmounts = ccyAmounts.filter((m) => m[1] === "SGD");
    if (sgdAmounts.length > 0) {
      const lastSgd = sgdAmounts[sgdAmounts.length - 1][0];
      const afterSgd = afterPayment.substring(
        afterPayment.lastIndexOf(lastSgd) + lastSgd.length,
      );
      const fxMatch = afterSgd.match(/\b(\d+\.\d{4,8})\b/);
      if (fxMatch) {
        const candidate = parseFloat(fxMatch[1]);
        // Typical SGD-based FX rates are 0.1–5; convert to buy_fx_rate (SGD per CCY)
        if (candidate > 0.05 && candidate < 10) {
          fxRate = 1 / candidate;
        }
      }
    }
    if (fxRate === 1) {
      warnings.push("Could not parse FX rate — defaulting to 1. Please correct before importing.");
    }
  }

  if (price <= 0) warnings.push("Could not parse transacted price.");

  const trade: ParsedTrade = {
    name,
    ticker,
    exchange,
    asset_type: "ETF",
    broker: "FSMOne",
    units,
    currency,
    buy_price: price,
    buy_date: buyDate,
    buy_fx_rate: fxRate,
    fees: 0,
    source: "Cash",
  };

  return { broker: "FSMOne", docType: "etf-confirmation", trades: [trade], warnings };
}

// ── Consolidated Monthly Statement ───────────────────────────────────────────

// Build a ticker/exchange lookup from the Cash Account section
// Remarks like "RSP: G3B Amova STI ETF S$D (SGX)" give us ticker + exchange
function buildTickerLookup(text: string): Map<string, { ticker: string; exchange: string }> {
  const map = new Map<string, { ticker: string; exchange: string }>();
  const pattern = /RSP:\s*([A-Z0-9]{2,6})\s+(.+?)\s+\((\w+)\)/g;
  for (const m of text.matchAll(pattern)) {
    const ticker = m[1];
    const productName = m[2].trim().toLowerCase();
    const rawExchange = m[3].toUpperCase();
    const exchange = EXCHANGE_MAP[rawExchange] ?? rawExchange;
    map.set(productName, { ticker, exchange });
  }
  return map;
}

// Extract FX reference rates from the statement (e.g. USD/SGD 1.275300)
function buildFxLookup(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const pattern = /([A-Z]{3})\/SGD\s+([\d.]+)/g;
  for (const m of text.matchAll(pattern)) {
    map.set(m[1], parseFloat(m[2])); // e.g. "USD" → 1.2753
  }
  return map;
}

function parseConsolidatedStatement(text: string): ParseResult {
  const warnings: string[] = [];
  const trades: ParsedTrade[] = [];

  const tickerLookup = buildTickerLookup(text);
  const fxLookup = buildFxLookup(text);

  // Find the transactions section
  const txnIdx = text.indexOf("TRANSACTIONS MADE IN THE MONTH");
  if (txnIdx < 0) {
    warnings.push("Could not find 'TRANSACTIONS MADE IN THE MONTH' section.");
    return { broker: "FSMOne", docType: "consolidated-statement", trades, warnings };
  }

  const txnSection = text.substring(txnIdx);

  // Process each sub-section that might have trades: Stock & ETF, Unit Trust
  const SECTIONS: { marker: string; assetType: string }[] = [
    { marker: "Stock & ETF", assetType: "ETF" },
    { marker: "Unit Trust", assetType: "Equity" },
  ];

  for (const { marker, assetType } of SECTIONS) {
    const secIdx = txnSection.indexOf(marker);
    if (secIdx < 0) continue;

    // Extract section text: from marker until next major section or "Managed Portfolio"
    const nextSec = ["Bond", "Unit Trust", "Stock & ETF", "Managed Portfolio", "iFAST Financial"]
      .map((s) => {
        const i = txnSection.indexOf(s, secIdx + marker.length);
        return i > 0 ? i : Infinity;
      })
      .filter((i) => i > secIdx + marker.length)
      .sort((a, b) => a - b)[0];

    const sectionText = txnSection.substring(
      secIdx + marker.length,
      isFinite(nextSec) ? nextSec : undefined,
    );

    if (/you have no transactions/i.test(sectionText)) continue;

    // Find each transaction by date pattern "25-May-2026"
    const datePattern = /(\d{2}-\w{3}-\d{4})/g;
    const dateMatches = [...sectionText.matchAll(datePattern)];

    for (let di = 0; di < dateMatches.length; di++) {
      const dateStr = dateMatches[di][1];
      const blockStart = dateMatches[di].index!;
      const blockEnd = di + 1 < dateMatches.length
        ? dateMatches[di + 1].index!
        : sectionText.length;
      const block = sectionText.substring(blockStart, blockEnd);

      const trade = parseConsolidatedTxnBlock(
        block, dateStr, assetType, tickerLookup, fxLookup,
      );
      if (trade) {
        trades.push(trade);
      } else {
        warnings.push(`Could not parse transaction starting on ${dateStr}.`);
      }
    }
  }

  if (trades.length === 0 && warnings.length === 0) {
    warnings.push("No trades found in consolidated statement.");
  }

  return { broker: "FSMOne", docType: "consolidated-statement", trades, warnings };
}

function parseConsolidatedTxnBlock(
  block: string,
  dateStr: string,
  defaultAssetType: string,
  tickerLookup: Map<string, { ticker: string; exchange: string }>,
  fxLookup: Map<string, number>,
): ParsedTrade | null {
  const buyDate = parseDate(dateStr);
  if (!buyDate) return null;

  // Remove the date from the start and split into lines
  const lines = block
    .substring(dateStr.length)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 3) return null;

  // Collect product name lines until we hit a line starting with a currency code
  // E.g. "SGD ETF RSP Cash SGD" starts with "SGD"
  const CCY_SET = new Set(["USD", "SGD", "EUR", "GBP", "HKD", "AUD"]);
  const ccyLineIdx = lines.findIndex((l) => CCY_SET.has(l.split(/\s/)[0]));
  if (ccyLineIdx < 0) return null;

  // Product name: everything before the CCY line (first line may be on date line)
  const nameLines = lines.slice(0, ccyLineIdx);
  const name = nameLines.join(" ").trim();
  if (!name) return null;

  // CCY line: "SGD ETF RSP Cash SGD" → first token = asset currency
  const ccyLine = lines[ccyLineIdx];
  const ccyTokens = ccyLine.split(/\s+/);
  const currency = ccyTokens[0] ?? "SGD";

  // Asset type from CCY line (2nd token if it's ETF / Unit Trust etc.)
  const assetTypeTok = ccyTokens.find((t) =>
    ["ETF", "REIT", "BOND"].includes(t.toUpperCase()),
  );
  const asset_type = assetTypeTok
    ? normalizeAssetType(assetTypeTok)
    : defaultAssetType;

  // Data lines after CCY line: amounts, quantity, price, status
  const dataLines = lines.slice(ccyLineIdx + 1);

  // Pull all numeric values from remaining lines
  // "998.53" → amount; "188 SGD" → qty; "5.305" → price; "complete" → status
  let quantity = 0;
  let price = 0;

  // Look for "NNN [CCY]" pattern = quantity line
  const qtyCcyIdx = dataLines.findIndex((l) => /^\d+\s+(USD|SGD|EUR|GBP|HKD|AUD)$/.test(l));
  if (qtyCcyIdx >= 0) {
    const qtyMatch = dataLines[qtyCcyIdx].match(/^(\d+)/);
    if (qtyMatch) quantity = parseFloat(qtyMatch[1]);
    // Price is on the next line
    if (qtyCcyIdx + 1 < dataLines.length) {
      const priceCandidate = parseFloat(dataLines[qtyCcyIdx + 1]);
      if (!isNaN(priceCandidate) && priceCandidate > 0) price = priceCandidate;
    }
  } else {
    // Fallback: collect all numeric-only lines and take the last two
    const nums = dataLines
      .filter((l) => /^[\d,.]+$/.test(l))
      .map((l) => parseFloat(l.replace(/,/g, "")))
      .filter((n) => !isNaN(n) && n > 0);
    if (nums.length >= 2) {
      quantity = nums[nums.length - 2];
      price = nums[nums.length - 1];
    }
  }

  if (quantity <= 0 || price <= 0) return null;

  // FX rate
  const fxRate = currency === "SGD" ? 1 : (fxLookup.get(currency) ?? 1);

  // Ticker + exchange from cash account lookup
  const nameLower = name.toLowerCase();
  let ticker = "";
  let exchange = currency === "SGD" ? "SI" : "US";
  for (const [key, val] of tickerLookup) {
    if (nameLower.includes(key)) {
      ticker = val.ticker;
      exchange = val.exchange || exchange;
      break;
    }
  }

  return {
    name,
    ticker,
    exchange,
    asset_type,
    broker: "FSMOne",
    units: quantity,
    currency,
    buy_price: price,
    buy_date: buyDate,
    buy_fx_rate: fxRate,
    fees: 0,
    source: "Cash",
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export function parseFsmone(text: string): ParseResult {
  const isConfirmation = /Confirmation Note/i.test(text) && /FUNDSUPERMART|iFAST/i.test(text);
  const isEtf = /Exchange Traded Funds/i.test(text);
  const isConsolidated = /CONSOLIDATED FINANCIAL POSITIONS/i.test(text);
  const isUnitTrust = /Unit Trust \/ Cash Solutions/i.test(text);

  if (isConfirmation && isEtf) {
    return parseEtfConfirmationNote(text);
  }
  if (isConsolidated) {
    return parseConsolidatedStatement(text);
  }
  if (isConfirmation && isUnitTrust) {
    if (/Cash Account Transfer/i.test(text)) {
      return {
        broker: "FSMOne",
        docType: "cash-transfer",
        trades: [],
        warnings: ["Cash transfer confirmation — no trades to import."],
      };
    }
    return {
      broker: "FSMOne",
      docType: "unit-trust-confirmation",
      trades: [],
      warnings: ["Unit trust confirmation parsing is not yet supported."],
    };
  }
  return {
    broker: "FSMOne",
    docType: "unknown",
    trades: [],
    warnings: ["Unrecognised FSMOne document type."],
  };
}
