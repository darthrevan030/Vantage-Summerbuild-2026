import { describe, it, expect } from "vitest";
import {
  parseCsv,
  toCsv,
  parseCsvNumber,
  holdingsToImportCsv,
  CSV_FIELD_MAP,
  csvHeaderKey,
  buildBackupEnvelope,
  parseBackup,
  orderLotsForRestore,
  remapAllocations,
  backupLotToCommitInput,
  BACKUP_SCHEMA,
} from "@/lib/portfolio-io";
import type { Holding } from "@/types/holding";
import type { RealizedLot } from "@/types/realized";

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

describe("buildBackupEnvelope", () => {
  it("groups realized rows into per-sell allocations", () => {
    const realized = [
      { sellLotId: "s1", buyLotId: "b1", method: "specific", matchedQuantity: 4 },
      { sellLotId: "s1", buyLotId: "b2", method: "specific", matchedQuantity: 6 },
    ] as RealizedLot[];
    const env = buildBackupEnvelope([holding({ id: "b1" })], realized, "2026-07-22T00:00:00Z");
    expect(env.schema).toBe(BACKUP_SCHEMA);
    expect(env.sells["s1"].method).toBe("specific");
    expect(env.sells["s1"].allocations).toEqual([
      { buyLotId: "b1", qty: 4 },
      { buyLotId: "b2", qty: 6 },
    ]);
  });
});

describe("parseBackup", () => {
  it("rejects a non-backup file", () => {
    expect(() => parseBackup(JSON.stringify([{ ticker: "x" }]))).toThrow();
  });
  it("rejects an unknown version", () => {
    expect(() =>
      parseBackup(JSON.stringify({ schema: BACKUP_SCHEMA, version: 999, lots: [] })),
    ).toThrow(/version/i);
  });
  it("accepts a valid envelope", () => {
    const env = buildBackupEnvelope([holding({})], [], "t");
    expect(parseBackup(JSON.stringify(env)).lots).toHaveLength(1);
  });
});

describe("orderLotsForRestore", () => {
  it("splits buys/sells and sorts each by date", () => {
    const lots = [
      holding({ id: "a", transactionType: "sell", buyDate: "2024-03-01" }),
      holding({ id: "b", transactionType: "buy", buyDate: "2024-02-01" }),
      holding({ id: "c", transactionType: "buy", buyDate: "2024-01-01" }),
    ];
    const { buys, sells } = orderLotsForRestore(lots);
    expect(buys.map((l) => l.id)).toEqual(["c", "b"]);
    expect(sells.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("remapAllocations", () => {
  it("translates old ids and throws on an unmapped id", () => {
    expect(remapAllocations([{ buyLotId: "old", qty: 2 }], { old: "new" })).toEqual([
      { buyLotId: "new", qty: 2 },
    ]);
    expect(() => remapAllocations([{ buyLotId: "x", qty: 1 }], {})).toThrow();
  });
});

describe("backupLotToCommitInput", () => {
  it("maps camelCase to snake_case and carries exchange_code", () => {
    const input = backupLotToCommitInput(holding({ exchangeCode: "LSE" }));
    expect(input.asset_type).toBe("ETF");
    expect(input.buy_price).toBe(100);
    expect(input.exchange_code).toBe("LSE");
    expect(input.transaction_type).toBe("buy");
  });
});
