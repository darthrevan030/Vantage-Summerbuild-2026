export interface ParsedTrade {
  name: string;
  ticker: string;      // raw symbol, no exchange suffix
  exchange: string;    // app exchange code: "SI", "LSE", "US", etc.
  asset_type: string;
  broker: string;
  units: number;
  currency: string;
  buy_price: number;
  buy_date: string;    // YYYY-MM-DD
  buy_fx_rate: number; // SGD per 1 unit of asset currency (1 for SGD assets)
  fees: number;
  source: string;      // "" | "Cash" | "CPF" | "SRS"
}

export interface ParseResult {
  broker: string;
  docType: string;
  trades: ParsedTrade[];
  warnings: string[];
}
