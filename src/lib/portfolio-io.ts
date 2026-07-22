import type { Holding } from "@/types/holding";

// ── CSV import mapping (moved from add/page.tsx) ─────────────────────────────
export interface CsvRow {
  [key: string]: string;
}

// Lowercased keys — headers are normalized (trim + toLowerCase) before lookup.
export const CSV_FIELD_MAP: Record<string, string> = {
  "name": "name",
  "asset name": "name",
  "stock name": "name",
  "ticker": "ticker",
  "symbol": "ticker",
  "asset type": "asset_type",
  "type": "asset_type",
  "strategy": "strategy",
  "broker": "broker",
  "units": "units",
  "qty": "units",
  "quantity": "units",
  "shares": "units",
  "no. of shares": "units",
  "nominal": "units",
  "currency": "currency",
  "ccy": "currency",
  "purchase price": "buy_price",
  "buy price": "buy_price",
  "price": "buy_price",
  "avg price": "buy_price",
  "cost basis": "buy_price",
  "purchase date": "buy_date",
  "date bought": "buy_date",
  "date": "buy_date",
  "buy date": "buy_date",
  "trade date": "buy_date",
  "fx rate": "buy_fx_rate",
  "purchase fx rate": "buy_fx_rate",
};

export const csvHeaderKey = (h: string) => h.trim().toLowerCase();

// parseFloat("1,000") stops at the comma → silent data loss. Strip non-numeric
// characters before parsing.
export function parseCsvNumber(v: string | undefined): number {
  if (v == null) return NaN;
  const cleaned = String(v).replace(/[^\d.\-eE+]/g, "");
  return cleaned === "" ? NaN : parseFloat(cleaned);
}

// Quote-aware, RFC-4180-ish parser: quoted fields may contain commas, newlines,
// and "" escaped quotes. Replaces the old split(",") which broke on those.
export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((vals) =>
      Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()])),
    );
  return { headers, rows };
}

// ── CSV export (round-trippable through the importer above) ──────────────────
function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => csvEscape(String(c))).join(",")).join("\n");
}

// Headers chosen so csvHeaderKey(header) is a key in CSV_FIELD_MAP → the export
// re-imports without manual column mapping.
export const CSV_EXPORT_COLUMNS: {
  header: string;
  get: (h: Holding) => string | number;
}[] = [
  { header: "Name", get: (h) => h.name },
  { header: "Ticker", get: (h) => h.ticker },
  { header: "Asset Type", get: (h) => h.assetType },
  { header: "Strategy", get: (h) => h.strategy },
  { header: "Broker", get: (h) => h.broker },
  { header: "Units", get: (h) => h.units },
  { header: "Currency", get: (h) => h.currency },
  { header: "Buy Price", get: (h) => h.buyPrice },
  { header: "Buy Date", get: (h) => h.buyDate },
  { header: "FX Rate", get: (h) => h.buyFxRate },
];

// Buy lots only — the importer has no concept of sells/matching (that's JSON's
// job), so exporting sells here would silently re-import them as buys.
export function holdingsToImportCsv(holdings: Holding[]): string {
  const buys = holdings.filter((h) => h.transactionType !== "sell");
  const header = CSV_EXPORT_COLUMNS.map((c) => c.header);
  const body = buys.map((h) => CSV_EXPORT_COLUMNS.map((c) => c.get(h)));
  return toCsv([header, ...body]);
}
