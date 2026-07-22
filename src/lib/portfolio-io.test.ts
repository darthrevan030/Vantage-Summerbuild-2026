import { describe, it, expect } from "vitest";
import {
  parseCsv,
  toCsv,
  parseCsvNumber,
  holdingsToImportCsv,
  CSV_FIELD_MAP,
  csvHeaderKey,
} from "./portfolio-io";
import type { Holding } from "@/types/holding";

const holding = (over: Partial<Holding>): Holding =>
  ({
    id: "1",
    userId: "u",
    ticker: "VWRA",
    name: "Vanguard, All-World",
    assetType: "ETF",
    exchangeCode: "LSE",
    broker: "IBKR",
    strategy: "long_term",
    units: 10,
    currency: "USD",
    flag: "🇺🇸",
    icon: "briefcase",
    buyPrice: 100,
    buyDate: "2024-01-02",
    buyFxRate: 1.35,
    currentPrice: 110,
    currentFxRate: 1.34,
    sparkData: [],
    createdAt: "",
    updatedAt: "",
    priceRefreshedAt: null,
    source: "",
    dividendYield: null,
    dividendYieldAuto: null,
    prevPrice: null,
    prevPriceSource: null,
    maturityDate: null,
    parValue: null,
    couponRate: null,
    transactionType: "buy",
    fees: 0,
    ...over,
  }) as Holding;

describe("parseCsvNumber", () => {
  it("strips thousands separators", () => {
    expect(parseCsvNumber("1,234.5")).toBe(1234.5);
  });
});

describe("toCsv / parseCsv round-trip", () => {
  it("survives commas and quotes in a field", () => {
    const csv = toCsv([
      ["Name", "Units"],
      ['Vanguard, "All-World"', 10],
    ]);
    const { rows } = parseCsv(csv);
    expect(rows[0]["Name"]).toBe('Vanguard, "All-World"');
    expect(rows[0]["Units"]).toBe("10");
  });
});

describe("holdingsToImportCsv", () => {
  it("emits importer-mappable headers and re-parses to the original name", () => {
    const csv = holdingsToImportCsv([holding({})]);
    const { headers, rows } = parseCsv(csv);
    for (const h of headers) expect(CSV_FIELD_MAP[csvHeaderKey(h)]).toBeDefined();
    const nameHeader = headers.find((h) => csvHeaderKey(h) === "name")!;
    expect(rows[0][nameHeader]).toBe("Vanguard, All-World");
  });
  it("excludes sell lots", () => {
    const csv = holdingsToImportCsv([holding({ transactionType: "sell" })]);
    expect(parseCsv(csv).rows).toHaveLength(0);
  });
});
