import { createTableListGET } from "@/lib/api/list-route";

export interface ExchangeRow {
  code: string;
  label: string;
  region: string;
  active: boolean;
  display_order: number;
}

const FALLBACK: ExchangeRow[] = [
  { code: "US",    label: "US · NYSE / NASDAQ",              region: "Americas",           active: true, display_order: 10 },
  { code: "LSE",   label: "LSE · London Stock Exchange",     region: "Europe",             active: true, display_order: 20 },
  { code: "XETRA", label: "XETRA · Deutsche Börse",         region: "Europe",             active: true, display_order: 21 },
  { code: "HK",    label: "HKEX · Hong Kong Exchange",       region: "Asia-Pacific",       active: true, display_order: 40 },
  { code: "TSE",   label: "TSE · Tokyo Stock Exchange",      region: "Asia-Pacific",       active: true, display_order: 41 },
  { code: "SI",    label: "SGX · Singapore Exchange",        region: "Asia-Pacific",       active: true, display_order: 42 },
  { code: "AU",    label: "ASX · Australian Securities Exchange", region: "Asia-Pacific",  active: true, display_order: 43 },
  { code: "NSE",   label: "NSE · National Stock Exchange India", region: "Asia-Pacific",   active: true, display_order: 44 },
  { code: "SHG",   label: "SSE · Shanghai Stock Exchange",   region: "Asia-Pacific",       active: true, display_order: 52 },
  { code: "SHE",   label: "SZSE · Shenzhen Stock Exchange",  region: "Asia-Pacific",       active: true, display_order: 53 },
];

export const GET = createTableListGET<ExchangeRow>(
  "exchanges",
  "code, label, region, active, display_order",
  FALLBACK
);
